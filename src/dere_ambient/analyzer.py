"""Context analysis and engagement decision logic."""

from __future__ import annotations

import socket
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

import httpx
from loguru import logger

from dere_shared.activitywatch import ActivityWatchClient, detect_continuous_activities
from dere_shared.models import AmbientEngagementDecision
from dere_shared.tasks import get_task_context

from .config import AmbientConfig

if TYPE_CHECKING:
    from dere_graph.llm_client import ClaudeClient
    from dere_shared.personalities import PersonalityLoader


class ContextAnalyzer:
    """Analyzes user context and decides when to engage."""

    def __init__(
        self,
        config: AmbientConfig,
        llm_client: ClaudeClient | None = None,
        personality_loader: PersonalityLoader | None = None,
    ):
        self.config = config
        self.daemon_url = config.daemon_url
        self.aw_client = ActivityWatchClient()
        self.llm_client = llm_client
        self.personality_loader = personality_loader


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
    ) -> tuple[bool, str | None, Literal["alert", "conversation"], str | None, str | None, int | None]:
        """Determine if bot should engage with user.

        Returns:
            Tuple of (should_engage, message, priority, target_medium, target_location, parent_notification_id)
            - should_engage: True if bot should reach out
            - message: Optional message to send
            - priority: 'alert' for simple notification, 'conversation' for chat request
            - target_medium: Where to route (discord, telegram, desktop)
            - target_location: Channel/DM ID within medium
            - parent_notification_id: ID of notification being followed up on (if escalation)
        """
        try:
            # Step 1: Check current activity first (most important)
            current_activity = await self._get_current_activity()
            if not current_activity:
                logger.info("No current activity detected from ActivityWatch - skipping check")
                return False, None, "alert", None, None, None

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
                    return False, None, "alert", None, None, None
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

            # Step 4: Evaluate engagement (using LLM)
            engagement_reason = await self._evaluate_engagement(
                current_activity, previous_context, minutes_idle, emotion_summary, entity_context, previous_notifications
            )

            if engagement_reason:
                message, priority, parent_notification_id = engagement_reason

                # Step 5: Route the message using LLM-based routing
                routing = await self._route_message(
                    message=message, priority=priority, user_activity=current_activity
                )
                if routing:
                    target_medium, target_location, routing_reason = routing
                    return True, message, priority, target_medium, target_location, parent_notification_id

            logger.info(
                "No engagement conditions met (activity: {}, duration: {:.1f}h)",
                app,
                duration_hours,
            )
            return False, None, "alert", None, None, None

        except Exception as e:
            logger.error("Error in engagement analysis: {}", e)
            return False, None, "alert", None, None, None

    async def _get_last_interaction_time(self) -> float | None:
        """Get timestamp of last user interaction from daemon.

        Returns:
            Unix timestamp of last interaction, or None if no interactions
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.daemon_url}/queue/status",
                    timeout=5,
                )
                if response.status_code != 200:
                    return None

                # Query for most recent interaction using temporal filter
                from datetime import datetime, timedelta

                since_time = datetime.now(UTC) - timedelta(hours=24)

                response = await client.post(
                    f"{self.daemon_url}/search/hybrid",
                    json={
                        "query": "",  # Empty query = all results
                        "limit": 1,
                        "since": since_time.isoformat(),
                        "entity_values": [],
                        "user_id": self.config.user_id,
                    },
                    timeout=5,
                )
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        return float(results[0].get("timestamp", 0))
                elif response.status_code == 500:
                    logger.debug("dere_graph not available for search")
                    return None

        except Exception as e:
            logger.debug("Failed to get last interaction time: {}", e)

        return None

    async def _get_current_activity(self) -> dict[str, Any] | None:
        """Get user's current activity from ActivityWatch.

        Returns:
            Dictionary with current activity info, or None if no activity
        """
        try:
            hostname = socket.gethostname()
            now_utc = datetime.now(UTC)

            window_events = self.aw_client.get_window_events(hostname, lookback_minutes=10)
            if not window_events:
                return None

            continuous_activities = detect_continuous_activities(
                self.aw_client,
                hostname,
                now_utc,
                window_events,
                max_duration_hours=self.config.activity_lookback_hours,
            )

            if continuous_activities:
                sorted_activities = sorted(
                    continuous_activities.items(),
                    key=lambda x: x[1]["duration"],
                    reverse=True,
                )
                if sorted_activities:
                    key, data = sorted_activities[0]
                    last_seen = data["last_seen"]
                    return {
                        "app": data["app"],
                        "title": data["title"],
                        "duration": data["duration"],
                        "last_seen": last_seen.isoformat() if hasattr(last_seen, "isoformat") else last_seen,
                    }

        except Exception as e:
            logger.warning("Failed to get current activity: {}", e)

        return None

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
            # If no session_id provided, try to get the most recent active session
            if session_id is None:
                session_id = await self._get_most_recent_session()
                if session_id is None:
                    logger.debug("No session_id provided and no recent session found")
                    return None

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.daemon_url}/emotion/summary/{session_id}",
                    timeout=5,
                )
                if response.status_code == 200:
                    result = response.json()
                    return result.get("summary", None)
                elif response.status_code == 404:
                    logger.debug("No emotion state found for session {}", session_id)
                    return None

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
                from datetime import datetime, timedelta

                # Get entities from last 6 hours
                since_time = datetime.now(UTC) - timedelta(hours=6)

                response = await client.post(
                    f"{self.daemon_url}/search/hybrid",
                    json={
                        "query": "",  # Empty query to get all recent entities
                        "limit": limit,
                        "since": since_time.isoformat(),
                        "entity_values": [],
                        "user_id": self.config.user_id,
                    },
                    timeout=10,
                )
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        # Extract entity names from results
                        entities = []
                        for r in results:
                            # Check if result has entity information
                            if "entity" in r:
                                entities.append(r["entity"])
                            # Fallback to prompt snippets
                            elif "prompt" in r:
                                # Extract first meaningful words as pseudo-entity
                                snippet = r["prompt"][:60].strip()
                                if snippet:
                                    entities.append(snippet)

                        if entities:
                            return ", ".join(entities[:limit])

                elif response.status_code == 500:
                    logger.debug("dere_graph not available for entity search")
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
        task_context = get_task_context(limit=5, include_overdue=True, include_due_soon=True)

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

        if not self.llm_client:
            logger.error("LLM client not configured for ambient analyzer")
            return None

        try:
            from dere_graph.llm_client import Message

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
                    return (
                        result.get("medium"),
                        result.get("location"),
                        result.get("reasoning"),
                    )
        except Exception as e:
            logger.error("Routing decision failed: {}", e)

        return None
