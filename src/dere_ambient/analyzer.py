"""Context analysis and engagement decision logic."""

from __future__ import annotations

import re
import time
from datetime import UTC
from typing import TYPE_CHECKING, Any, Literal

import httpx
from loguru import logger

from dere_shared.activitywatch import ActivityWatchService
from dere_shared.llm_client import AuthenticationError, ClaudeClient
from dere_shared.models import AmbientEngagementDecision
from dere_shared.tasks import get_task_context

from .config import AmbientConfig

_CURRENT_ACTIVITY_UNSET = object()

if TYPE_CHECKING:
    from dere_shared.personalities import PersonalityLoader


class ContextAnalyzer:
    """Analyzes user context and decides when to engage."""

    def __init__(
        self,
        config: AmbientConfig,
        personality_loader: PersonalityLoader | None = None,
    ):
        self.config = config
        self.daemon_url = config.daemon_url
        self.aw_service = ActivityWatchService.from_config(cache_ttl_seconds=5)
        self.llm_client = ClaudeClient(model="claude-haiku-4-5")
        self.personality_loader = personality_loader
        self._last_context: dict[str, Any] | None = None

    def _parse_entity_tokens(self, text: str | None) -> set[str]:
        if not text:
            return set()
        return {t.strip().lower() for t in text.split(",") if t.strip()}

    def _extract_task_ids(self, text: str | None) -> set[str]:
        if not text:
            return set()
        return set(re.findall(r"#\\d+", text))

    def _build_context_fingerprint(
        self,
        current_activity: dict[str, Any],
        entity_context: str | None,
        task_context: str | None,
    ) -> dict[str, Any]:
        return {
            "activity_app": current_activity.get("app"),
            "activity_title": current_activity.get("title"),
            "entities": self._parse_entity_tokens(entity_context),
            "tasks": self._extract_task_ids(task_context),
        }

    def _jaccard(self, a: set[str], b: set[str]) -> float:
        if not a and not b:
            return 1.0
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)

    def _context_similarity(self, prev: dict[str, Any], current: dict[str, Any]) -> float:
        activity_score = 0.0
        prev_app = prev.get("activity_app")
        curr_app = current.get("activity_app")
        prev_title = prev.get("activity_title")
        curr_title = current.get("activity_title")

        if prev_app and curr_app and prev_app == curr_app:
            activity_score = 0.5
            if prev_title and curr_title and prev_title == curr_title:
                activity_score = 1.0

        entity_score = self._jaccard(prev.get("entities", set()), current.get("entities", set()))
        task_score = self._jaccard(prev.get("tasks", set()), current.get("tasks", set()))

        return (0.5 * activity_score) + (0.3 * entity_score) + (0.2 * task_score)

    def _context_changed(self, current: dict[str, Any]) -> bool:
        threshold = self.config.context_change_threshold
        if threshold is None or threshold <= 0:
            return True
        if not self._last_context:
            return True
        similarity = self._context_similarity(self._last_context, current)
        logger.info("Ambient context similarity {:.2f} (threshold {:.2f})", similarity, threshold)
        return similarity < threshold

    def _has_overdue_tasks(self, task_context: str | None) -> bool:
        if not task_context:
            return False
        return "overdue:" in task_context.lower()

    async def _is_user_afk(self, lookback_minutes: int) -> bool:
        try:
            snapshot = await self._get_activity_snapshot(lookback_minutes=lookback_minutes)
            if not snapshot:
                return False
            return snapshot.get("presence") == "away"
        except Exception as e:
            logger.debug("Failed to check AFK status: {}", e)
            return False

    async def _get_recent_unacknowledged_notifications(self) -> list[dict[str, Any]]:
        """Query recent unacknowledged notifications for escalation context.

        Returns:
            List of recent notification data with context
        """
        if not self.config.escalation_enabled:
            return []

        try:
            async with httpx.AsyncClient() as client:
                from datetime import datetime, timedelta

                lookback_time = datetime.now(UTC) - timedelta(hours=self.config.escalation_lookback_hours)

                response = await client.post(
                    f"{self.daemon_url}/notifications/recent_unacknowledged",
                    json={
                        "user_id": self.config.user_id,
                        "since": lookback_time.isoformat(),
                    },
                    timeout=10,
                )
                if response.status_code == 200:
                    return response.json().get("notifications", [])
                elif response.status_code == 404:
                    logger.debug("No recent unacknowledged notifications found")
                    return []
                else:
                    logger.warning("Failed to query recent notifications: {}", response.status_code)
                    return []

        except Exception as e:
            logger.debug("Failed to get recent notifications: {}", e)
            return []

    async def should_engage(
        self,
        *,
        activity_lookback_minutes: int | None = None,
        current_activity: dict[str, Any] | None | object = _CURRENT_ACTIVITY_UNSET,
    ) -> tuple[bool, dict[str, Any] | None]:
        """Determine if bot should engage with user.

        Returns:
            Tuple of (should_engage, context_snapshot)
        """
        try:
            lookback_minutes = activity_lookback_minutes or 10

            if await self._is_user_afk(lookback_minutes):
                logger.info("User AFK; skipping ambient engagement")
                return False, None

            # Step 1: Check current activity first (most important)
            if current_activity is _CURRENT_ACTIVITY_UNSET:
                current_activity = await self.get_current_activity(lookback_minutes)
            if not current_activity:
                logger.info("No current activity detected from ActivityWatch - skipping check")
                return False, None

            app = current_activity.get("app", "")
            duration_seconds = current_activity.get("duration", 0)
            duration_hours = duration_seconds / 3600

            logger.info(
                "Current activity: {} for {:.1f}h ({:.0f}s)",
                app,
                duration_hours,
                duration_seconds,
            )

            # Step 2: Get last interaction time (optional, for context)
            last_interaction = await self._get_last_interaction_time()
            minutes_idle = None
            if last_interaction:
                time_since_interaction = time.time() - last_interaction
                minutes_idle = time_since_interaction / 60
                logger.info("Last interaction was {:.0f}m ago", minutes_idle)

                # Don't engage if user was recently active with us
                if minutes_idle < self.config.idle_threshold_minutes:
                    logger.info(
                        "User recently active ({:.0f}m < {}m idle threshold), skipping engagement",
                        minutes_idle,
                        self.config.idle_threshold_minutes,
                    )
                    return False, None
            else:
                logger.info("No previous interactions found (cold start)")

            # Step 3: Get previous context (optional, for enhanced messages)
            previous_context = await self._get_previous_context_summary()
            if previous_context:
                logger.debug("Previous context available: {}", previous_context[:100])

            # Step 3a: Get user emotional state (if available)
            # Attempts to resolve session_id from recent activity, falls back to None if not found
            emotion_summary = await self._get_user_emotion_summary(session_id=None)
            if emotion_summary:
                logger.debug("Emotion context: {}", emotion_summary)

            # Step 3b: Get entity/topic context
            entity_context = await self._get_entity_context(limit=5)
            if entity_context:
                logger.debug("Entity context: {}", entity_context[:100])

            # Step 3c: Get recent unacknowledged notifications for escalation
            previous_notifications = await self._get_recent_unacknowledged_notifications()
            if previous_notifications:
                logger.info("Found {} recent unacknowledged notifications", len(previous_notifications))

            task_context = get_task_context(limit=5, include_overdue=True, include_due_soon=True)
            current_fingerprint = self._build_context_fingerprint(
                current_activity, entity_context, task_context
            )

            if not self._context_changed(current_fingerprint):
                if not previous_notifications and not self._has_overdue_tasks(task_context):
                    logger.info("Context stable; skipping ambient engagement")
                    self._last_context = current_fingerprint
                    return False, None

            logger.info(
                "Engagement conditions met (activity: {}, duration: {:.1f}h)",
                app,
                duration_hours,
            )
            self._last_context = current_fingerprint
            context_snapshot = {
                "activity": current_activity,
                "minutes_idle": minutes_idle,
                "previous_context": previous_context,
                "emotion_summary": emotion_summary,
                "entity_context": entity_context,
                "task_context": task_context,
                "previous_notifications": previous_notifications,
            }
            return True, context_snapshot

        except Exception as e:
            logger.error("Error in engagement analysis: {}", e)
            return False, None

    async def _get_last_interaction_time(self) -> float | None:
        """Get timestamp of last user interaction from daemon.

        Returns:
            Unix timestamp of last interaction, or None if no interactions
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.daemon_url}/sessions/last_interaction",
                    params={"user_id": self.config.user_id},
                    timeout=5,
                )
                if response.status_code == 200:
                    value = response.json().get("last_interaction_time")
                    if value:
                        return float(value)

        except Exception as e:
            logger.debug("Failed to get last interaction time: {}", e)

        return None

    async def get_current_activity(self, lookback_minutes: int) -> dict[str, Any] | None:
        """Get user's current activity from ActivityWatch.

        Returns:
            Dictionary with current activity info, or None if no activity
        """
        try:
            snapshot = await self._get_activity_snapshot(lookback_minutes=lookback_minutes)
            if not snapshot:
                return None

            current = snapshot.get("current_window")
            if current:
                return {
                    "app": current.get("app"),
                    "title": current.get("title"),
                    "duration": current.get("duration_seconds", 0),
                    "last_seen": current.get("last_seen"),
                }

            current_media = snapshot.get("current_media")
            if current_media:
                artist = current_media.get("artist")
                title = current_media.get("title")
                label = f"{artist} - {title}" if artist else title
                return {
                    "app": f"{current_media.get('player')} (media)",
                    "title": label,
                    "duration": current_media.get("duration_seconds", 0),
                    "last_seen": current_media.get("last_seen"),
                }
        except Exception as e:
            logger.warning("Failed to get current activity: {}", e)

        return None

    async def _get_activity_snapshot(
        self, lookback_minutes: int = 10, top_n: int = 5
    ) -> dict[str, Any] | None:
        if not self.aw_service:
            return None
        snapshot = self.aw_service.get_snapshot(
            lookback_minutes=lookback_minutes,
            top_n=top_n,
        )
        if not snapshot.get("enabled", True):
            return None
        if snapshot.get("status") == "empty":
            return None
        return snapshot

    async def _get_previous_context_summary(self) -> str | None:
        """Get summary of previous conversation context.

        Returns:
            Summary string, or None if no previous context
        """
        try:
            async with httpx.AsyncClient() as client:
                from datetime import datetime, timedelta

                lookback_minutes = 30
                since_time = datetime.now(UTC) - timedelta(minutes=lookback_minutes)

                response = await client.post(
                    f"{self.daemon_url}/search/hybrid",
                    json={
                        "query": "conversation context discussion",
                        "limit": self.config.embedding_search_limit,
                        "since": since_time.isoformat(),
                        "rerank_method": "mmr",
                        "diversity": 0.7,  # High diversity to avoid repetition
                        "entity_values": [],
                        "user_id": self.config.user_id,
                    },
                    timeout=10,
                )
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        summaries = [r.get("prompt", "")[:100] for r in results[:3]]
                        return " | ".join(summaries)
                elif response.status_code == 500:
                    logger.debug("dere_graph not available for context search")
                    return None

        except Exception as e:
            logger.debug("Failed to get previous context: {}", e)

        return None

    async def _get_most_recent_session(self) -> int | None:
        """Query daemon for the most recent active session.

        Returns:
            Session ID of most recent session, or None if not found
        """
        try:
            # Query for recent sessions (within last 24 hours)
            # This endpoint would need to be implemented in the daemon
            # For now, we'll just return None as a safe fallback
            logger.debug("Session ID resolution not yet implemented")
            return None
        except Exception as e:
            logger.debug("Failed to get recent session: {}", e)
            return None

    async def _get_user_emotion_summary(self, session_id: int | None = None) -> str | None:
        """Get user's current emotional state summary.

        Args:
            session_id: Optional session ID to get emotions for. If None, tries to find active session.

        Returns:
            Human-readable emotion summary, or None if not available
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.daemon_url}/emotion/summary", timeout=5)
                if response.status_code == 200:
                    result = response.json()
                    return result.get("summary", None)

        except Exception as e:
            logger.debug("Failed to get emotion summary: {}", e)

        return None

    async def _get_entity_context(self, limit: int = 5) -> str | None:
        """Get recent entities/topics user has been working with.

        Args:
            limit: Maximum number of entities to retrieve

        Returns:
            Formatted string of recent entities, or None if not available
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.daemon_url}/kg/entities",
                    params={
                        "limit": limit,
                        "sort_by": "last_mentioned",
                        "sort_order": "desc",
                        "user_id": self.config.user_id,
                    },
                    timeout=10,
                )
                if response.status_code == 200:
                    entities = response.json().get("entities", [])
                    if entities:
                        names = [e.get("name", "").strip() for e in entities]
                        names = [name for name in names if name]
                        if names:
                            return ", ".join(names[:limit])

                elif response.status_code in {500, 503}:
                    logger.debug("dere_graph not available for entity lookup")
                    return None

        except Exception as e:
            logger.debug("Failed to get entity context: {}", e)

        return None


    async def _get_last_dm_message(self) -> dict[str, Any] | None:
        """Get the last Discord DM message for conversation continuity.

        Returns:
            Dictionary with message, type, timestamp, minutes_ago, or None if no DMs
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.daemon_url}/conversations/last_dm/{self.config.user_id}",
                    timeout=5,
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get("message"):
                        return data
        except Exception as e:
            logger.debug("Failed to get last DM: {}", e)
        return None

    async def _evaluate_engagement(
        self,
        current_activity: dict[str, Any],
        previous_context: str | None,
        minutes_idle: float | None,
        emotion_summary: str | None = None,
        entity_context: str | None = None,
        task_context: str | None = None,
        previous_notifications: list[dict[str, Any]] | None = None,
    ) -> tuple[str, Literal["alert", "conversation"], int | None] | None:
        """Evaluate whether to engage based on context using LLM.

        Args:
            current_activity: Current user activity data
            previous_context: Summary of previous conversations (optional)
            minutes_idle: Minutes since last interaction (optional, None for cold start)
            emotion_summary: User's current emotional state (optional)
            entity_context: Recent entities/topics user has worked with (optional)
            previous_notifications: Recent unacknowledged notifications (optional)

        Returns:
            Tuple of (message, priority, parent_notification_id) if should engage, None otherwise
        """
        # Get last DM message for conversation continuity
        last_dm = await self._get_last_dm_message()

        prompt_parts = [
            f"Current activity: {current_activity}",
            f"Previous context: {previous_context}",
            f"Minutes idle: {minutes_idle}",
            f"Emotion: {emotion_summary}",
            f"Entities: {entity_context}",
            f"Tasks: {task_context}",
        ]

        # Add last DM context for continuity
        if last_dm:
            minutes_ago = last_dm["minutes_ago"]
            msg_content = last_dm["message"][:200]  # Truncate if very long
            msg_type = last_dm["message_type"]

            if msg_type == "assistant":
                prompt_parts.append(f"\nLast DM: You messaged user {minutes_ago}m ago: '{msg_content}'")
            else:
                prompt_parts.append(f"\nLast DM: User messaged you {minutes_ago}m ago: '{msg_content}'")

        if previous_notifications:
            notif_summary = "\n".join([
                f"- [{n.get('created_at')}] {n.get('message')} (status: {n.get('status')}, acknowledged: {n.get('acknowledged')})"
                for n in previous_notifications[:3]
            ])
            prompt_parts.append(f"\nPrevious notifications sent:\n{notif_summary}")
            prompt_parts.append("\nConsider whether these were addressed or ignored. If ignored and still relevant, you may escalate or follow up with appropriate tone.")

        prompt_parts.append("\nIf there are overdue tasks, upcoming deadlines, or relevant context worth mentioning, engage. Otherwise don't.")
        prompt = "\n".join(prompt_parts)

        try:
            from dere_shared.llm_client import Message

            messages = []
            if self.personality_loader:
                try:
                    personality = self.personality_loader.load(self.config.personality)
                    if personality and personality.prompt_content:
                        messages.append(Message(role="system", content=personality.prompt_content))
                        logger.info("Loaded personality: {}", self.config.personality)
                    else:
                        logger.warning("Personality {} loaded but has no prompt_content", self.config.personality)
                except Exception as e:
                    logger.warning("Failed to load personality {}: {}", self.config.personality, e)
            else:
                logger.warning("No personality_loader available")

            messages.append(Message(role="user", content=prompt))

            decision = await self.llm_client.generate_response(
                messages=messages, response_model=AmbientEngagementDecision
            )

            if decision.should_engage and decision.message:
                logger.info(
                    "Ambient decision: ENGAGE (priority={}) - {}",
                    decision.priority,
                    decision.message,
                )
                parent_id = previous_notifications[0].get("id") if previous_notifications else None
                return decision.message, decision.priority, parent_id
            else:
                logger.info("Ambient decision: NO ENGAGEMENT - {}", decision.reasoning)
                return None
        except AuthenticationError:
            # Auth expired - don't spam logs, LLM client already logged once
            return None
        except Exception as e:
            logger.error("Ambient LLM decision failed: {}", e)
            return None

    async def _route_message(
        self,
        message: str,
        priority: str,
        user_activity: dict[str, Any],
    ) -> tuple[str, str, str] | None:
        """Route message to appropriate medium using LLM-based routing.

        Args:
            message: Message to deliver
            priority: Message priority
            user_activity: Current user activity data

        Returns:
            Tuple of (medium, location, reasoning) or None if routing fails
        """
        method = (self.config.notification_method or "both").lower()
        if method == "notify-send":
            return ("desktop", "notify-send", "notification_method=notify-send")

        # Get user_id from config
        user_id = self.config.user_id

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.daemon_url}/routing/decide",
                    json={
                        "user_id": user_id,
                        "message": message,
                        "priority": priority,
                        "user_activity": user_activity,
                    },
                    timeout=30,
                    )
                if response.status_code == 200:
                    result = response.json()
                    if method == "daemon" and result.get("fallback"):
                        return None
                    return (
                        result.get("medium"),
                        result.get("location"),
                        result.get("reasoning"),
                    )
        except Exception as e:
            logger.error("Routing decision failed: {}", e)

        return None
