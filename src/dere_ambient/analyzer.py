"""Context analysis and engagement decision logic."""

from __future__ import annotations

import socket
import time
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from loguru import logger

from dere_shared.activitywatch import ActivityWatchClient, detect_continuous_activities
from dere_shared.tasks import get_task_context

from .config import AmbientConfig


class ContextAnalyzer:
    """Analyzes user context and decides when to engage."""

    def __init__(self, config: AmbientConfig):
        self.config = config
        self.daemon_url = config.daemon_url
        self.aw_client = ActivityWatchClient()

    async def should_engage(
        self,
    ) -> tuple[bool, str | None, Literal["alert", "conversation"], str | None, str | None]:
        """Determine if bot should engage with user.

        Returns:
            Tuple of (should_engage, message, priority, target_medium, target_location)
            - should_engage: True if bot should reach out
            - message: Optional message to send
            - priority: 'alert' for simple notification, 'conversation' for chat request
            - target_medium: Where to route (discord, telegram, desktop)
            - target_location: Channel/DM ID within medium
        """
        try:
            # Step 1: Check current activity first (most important)
            current_activity = await self._get_current_activity()
            if not current_activity:
                logger.debug("No current activity detected from ActivityWatch")
                return False, None, "alert"

            app = current_activity.get("app", "")
            duration_seconds = current_activity.get("duration", 0)
            duration_hours = duration_seconds / 3600

            logger.debug(
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
                logger.debug("Last interaction was {:.0f}m ago", minutes_idle)

                # Don't engage if user was recently active with us
                if minutes_idle < self.config.idle_threshold_minutes:
                    logger.debug(
                        "User recently active ({:.0f}m < {}m threshold), skipping engagement",
                        minutes_idle,
                        self.config.idle_threshold_minutes,
                    )
                    return False, None, "alert"
            else:
                logger.debug("No previous interactions found (cold start)")

            # Step 3: Get previous context (optional, for enhanced messages)
            previous_context = await self._get_previous_context_summary()
            if previous_context:
                logger.debug("Previous context available: {}", previous_context[:100])

            # Step 4: Evaluate engagement (using LLM)
            engagement_reason = await self._evaluate_engagement(
                current_activity, previous_context, minutes_idle
            )

            if engagement_reason:
                message, priority = engagement_reason
                logger.info("Engagement triggered: {} (priority: {})", message, priority)

                # Step 5: Route the message using LLM-based routing
                routing = await self._route_message(
                    message=message, priority=priority, user_activity=current_activity
                )
                if routing:
                    target_medium, target_location, routing_reason = routing
                    logger.info(
                        "Routing decision: {} -> {} (reason: {})",
                        target_medium,
                        target_location,
                        routing_reason,
                    )
                    return True, message, priority, target_medium, target_location

            logger.debug(
                "No engagement conditions met (activity: {}, duration: {:.1f}h)",
                app,
                duration_hours,
            )
            return False, None, "alert", None, None

        except Exception as e:
            logger.error("Error in engagement analysis: {}", e)
            return False, None, "alert", None, None

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

                # Query for most recent conversation (requires Ollama for embeddings)
                response = await client.post(
                    f"{self.daemon_url}/search/similar",
                    json={"query": "recent conversation", "limit": 1, "threshold": 0.0},
                    timeout=5,
                )
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        return float(results[0].get("timestamp", 0))
                elif response.status_code == 500:
                    logger.debug("Ollama not available for embedding search")
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
                    return {
                        "app": data["app"],
                        "title": data["title"],
                        "duration": data["duration"],
                        "last_seen": data["last_seen"],
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
                response = await client.post(
                    f"{self.daemon_url}/search/similar",
                    json={
                        "query": "what were we discussing",
                        "limit": self.config.embedding_search_limit,
                        "threshold": self.config.context_change_threshold,
                    },
                    timeout=10,
                )
                if response.status_code == 200:
                    results = response.json().get("results", [])
                    if results:
                        summaries = [r.get("prompt", "")[:100] for r in results[:3]]
                        return " | ".join(summaries)
                elif response.status_code == 500:
                    logger.debug("Ollama not available for context search")
                    return None

        except Exception as e:
            logger.debug("Failed to get previous context: {}", e)

        return None

    async def _evaluate_engagement(
        self,
        current_activity: dict[str, Any],
        previous_context: str | None,
        minutes_idle: float | None,
    ) -> tuple[str, Literal["alert", "conversation"]] | None:
        """Evaluate whether to engage based on context using LLM.

        Args:
            current_activity: Current user activity data
            previous_context: Summary of previous conversations (optional)
            minutes_idle: Minutes since last interaction (optional, None for cold start)

        Returns:
            Tuple of (message, priority) if should engage, None otherwise
        """
        app = current_activity.get("app", "")
        title = current_activity.get("title", "")
        duration_seconds = current_activity.get("duration", 0)
        duration_hours = duration_seconds / 3600

        # Get task context
        task_context = get_task_context(limit=5, include_overdue=True, include_due_soon=True)

        # Build prompt for LLM decision
        prompt = f"""Analyze this user activity and decide if ambient engagement is warranted.

Current Activity:
- Application: {app}
- Window Title: {title}
- Duration: {duration_hours:.1f} hours ({duration_seconds:.0f} seconds)

Context:
- Previous conversation context: {previous_context if previous_context else "None (cold start)"}
- Minutes since last interaction: {minutes_idle if minutes_idle else "N/A"}
- {task_context if task_context else "Tasks: None"}

Decide:
1. Should I reach out? (yes/no)
2. If yes, what message? (conversational, contextual)
3. Priority level: "alert" (simple notification) or "conversation" (chat request)

Respond in JSON:
{{"should_engage": true/false, "message": "...", "priority": "alert" or "conversation"}}"""

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.daemon_url}/llm/generate",
                    json={
                        "prompt": prompt,
                        "include_context": True,
                        "medium": None,  # Use any active session
                    },
                    timeout=30,
                )
                if response.status_code == 200:
                    result = response.json()
                    response_text = result.get("response", "")
                    import json

                    try:
                        # Claude CLI with --output-format json returns structured JSON
                        claude_response = json.loads(response_text)
                        # Extract text content from Claude's JSON structure
                        content_blocks = claude_response.get("content", [])
                        if content_blocks:
                            text_content = content_blocks[0].get("text", "")
                            decision = json.loads(text_content)
                            if decision.get("should_engage"):
                                return decision.get("message"), decision.get(
                                    "priority", "conversation"
                                )
                    except (json.JSONDecodeError, KeyError, IndexError) as e:
                        logger.warning("Failed to parse LLM response: {}", e)
        except Exception as e:
            logger.debug("LLM engagement decision failed: {}", e)

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
        # TODO: Get actual user_id from config or session
        # For now, use placeholder - this needs to be configurable
        user_id = "default_user"

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
