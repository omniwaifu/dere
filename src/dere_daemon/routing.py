"""LLM-based routing decision for multi-medium message delivery."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from dere_daemon.database import Database


class RoutingDecision:
    """Result of routing decision."""

    def __init__(
        self,
        medium: str,
        location: str,
        reasoning: str,
        fallback: bool = False,
    ):
        self.medium = medium
        self.location = location
        self.reasoning = reasoning
        self.fallback = fallback  # True if no mediums available, using desktop notification


async def decide_routing(
    user_id: str,
    message: str,
    priority: str,
    available_mediums: list[dict[str, Any]],
    user_activity: dict[str, Any] | None,
    recent_conversations: list[dict[str, Any]],
    db: Database,
) -> RoutingDecision:
    """Use LLM to intelligently decide where to route a message.

    Args:
        user_id: User identifier
        message: The message to be delivered
        priority: Message priority ('alert' or 'conversation')
        available_mediums: List of online mediums with channels
        user_activity: Current user activity from ActivityWatch
        recent_conversations: Recent conversation history with mediums
        db: Database instance

    Returns:
        RoutingDecision with medium, location, and reasoning

    NOTE: This is LLM-based routing - NO HARDCODED RULES.
    The LLM considers:
    - Which mediums are online
    - Where user was recently active
    - Current activity context
    - Message urgency
    - User preferences (future: learn from patterns)
    """
    import httpx

    # If no mediums available, fall back to desktop notification
    if not available_mediums:
        return RoutingDecision(
            medium="desktop",
            location="notify-send",
            reasoning="No conversational mediums online, fallback to desktop notification",
            fallback=True,
        )

    # Build context for LLM decision
    mediums_summary = []
    for medium_info in available_mediums:
        medium = medium_info["medium"]
        channels = medium_info.get("available_channels", [])

        # TODO: Telegram integration
        # When adding Telegram support, add similar channel formatting:
        # elif medium == "telegram":
        #     channel_list = [
        #         f"  - {ch.get('type', 'chat')}: {ch.get('title', 'unnamed')} (id: {ch.get('id', 'unknown')})"
        #         for ch in channels[:5]
        #     ]
        if medium == "discord":
            channel_list = [
                f"  - {ch.get('type', 'channel')}: {ch.get('name', 'unnamed')} (id: {ch.get('id', 'unknown')})"
                for ch in channels[:5]  # Limit to 5 for context
            ]
        else:
            # Generic fallback for future mediums
            channel_list = [f"  - {ch}" for ch in channels[:5]]

        mediums_summary.append(
            f"- {medium.upper()}: {len(channels)} channels available\n" + "\n".join(channel_list)
        )

    # Recent conversation context
    recent_summary = []
    for conv in recent_conversations[:3]:  # Last 3 conversations
        medium = conv.get("medium", "unknown")
        timestamp = conv.get("timestamp", 0)
        import time

        mins_ago = int((time.time() - timestamp) / 60)
        recent_summary.append(f"- {medium}: {mins_ago}m ago")

    # User activity context
    activity_summary = "None"
    if user_activity:
        app = user_activity.get("app", "unknown")
        duration = user_activity.get("duration", 0) / 60  # minutes
        activity_summary = f"{app} for {duration:.0f}m"

    # Build prompt for LLM
    prompt = f"""You are a routing agent for an omnipresent AI assistant. Decide where to deliver this message.

MESSAGE TO DELIVER:
"{message}"

PRIORITY: {priority}
USER ID: {user_id}

AVAILABLE MEDIUMS:
{chr(10).join(mediums_summary) if mediums_summary else "None"}

RECENT CONVERSATION LOCATIONS:
{chr(10).join(recent_summary) if recent_summary else "None"}

CURRENT USER ACTIVITY:
{activity_summary}

ROUTING DECISION CRITERIA:
1. Prefer the medium where user was most recently active
2. Consider message urgency (alert = any medium, conversation = prefer active medium)
3. For Discord: choose appropriate channel (DM for personal, guild channel for context)
4. Respect user context (e.g., don't interrupt focused work with chat messages)
5. Future consideration: learn user preferences over time

Respond in JSON:
{{
  "medium": "discord|telegram|etc",
  "location": "channel_id or dm_user_id",
  "reasoning": "1-2 sentence explanation"
}}"""

    # Call LLM via daemon endpoint (reuse existing /llm/generate)
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "http://localhost:8787/llm/generate",
                json={
                    "prompt": prompt,
                    "model": "claude-3-5-haiku-20241022",
                    "include_context": False,  # Don't inject personality here, pure routing logic
                },
                timeout=30,
            )

            if response.status_code == 200:
                result = response.json()
                response_text = result.get("response", "")

                import json

                # Parse nested JSON (Claude CLI format)
                claude_response = json.loads(response_text)
                content_blocks = claude_response.get("content", [])
                if content_blocks:
                    text_content = content_blocks[0].get("text", "")
                    decision = json.loads(text_content)

                    return RoutingDecision(
                        medium=decision.get("medium", "desktop"),
                        location=decision.get("location", "notify-send"),
                        reasoning=decision.get("reasoning", "LLM routing decision"),
                    )
    except Exception as e:
        from loguru import logger

        logger.error("Routing LLM decision failed: {}", e)

    # Fallback: use most recently active medium
    if available_mediums:
        fallback_medium = available_mediums[0]  # Already sorted by last_heartbeat DESC
        channels = fallback_medium.get("available_channels", [])
        if channels:
            # Use first available channel (TODO: smarter fallback)
            first_channel = channels[0]
            location = first_channel.get("id", str(first_channel)) if isinstance(first_channel, dict) else str(first_channel)
            return RoutingDecision(
                medium=fallback_medium["medium"],
                location=location,
                reasoning="LLM routing failed, using most recently active medium as fallback",
            )

    # Ultimate fallback
    return RoutingDecision(
        medium="desktop",
        location="notify-send",
        reasoning="All routing attempts failed, fallback to desktop notification",
        fallback=True,
    )
