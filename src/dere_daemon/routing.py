"""LLM-based routing decision for multi-medium message delivery."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from dere_shared.models import RoutingDecision as RoutingDecisionModel

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from dere_graph.llm_client import ClaudeClient


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


def _select_best_fallback_channel(channels: list[dict[str, Any] | Any]) -> dict[str, Any] | Any:
    """Select best channel for fallback routing.

    Prefers:
    1. DM channels (type='dm' or type='private')
    2. General/main channels (name contains 'general' or 'main')
    3. First available channel

    Args:
        channels: List of channel dicts or raw channel identifiers

    Returns:
        Selected channel (dict or raw value)
    """
    if not channels:
        return channels[0] if channels else None

    # Convert to list of dicts if needed
    dict_channels = [ch for ch in channels if isinstance(ch, dict)]

    # Prefer DM channels
    dm_channels = [
        ch
        for ch in dict_channels
        if ch.get("type", "").lower() in ("dm", "private", "direct_message")
    ]
    if dm_channels:
        return dm_channels[0]

    # Prefer general/main channels
    general_channels = [
        ch
        for ch in dict_channels
        if any(keyword in ch.get("name", "").lower() for keyword in ("general", "main", "chat"))
    ]
    if general_channels:
        return general_channels[0]

    # Fallback to first available
    return channels[0]


async def decide_routing(
    user_id: str,
    message: str,
    priority: str,
    available_mediums: list[dict[str, Any]],
    user_activity: dict[str, Any] | None,
    recent_conversations: list[dict[str, Any]],
    session_factory: async_sessionmaker[AsyncSession],
    llm_client: ClaudeClient | None = None,
) -> RoutingDecision:
    """Use LLM to intelligently decide where to route a message.

    Args:
        user_id: User identifier
        message: The message to be delivered
        priority: Message priority ('alert' or 'conversation')
        available_mediums: List of online mediums with channels
        user_activity: Current user activity from ActivityWatch
        recent_conversations: Recent conversation history with mediums
        session_factory: SQLModel async session factory (for future database lookups)
        llm_client: Optional ClaudeClient for structured outputs

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

        # NOTE: When adding additional mediums (e.g., Telegram), add similar formatting:
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

Respond with your routing decision and reasoning."""

    if not llm_client:
        from loguru import logger

        logger.error("LLM client not configured for routing")
        # Fall through to fallback logic below

    else:
        try:
            from loguru import logger

            from dere_graph.llm_client import Message

            messages = [Message(role="user", content=prompt)]
            decision_model = await llm_client.generate_response(
                messages=messages, response_model=RoutingDecisionModel
            )

            return RoutingDecision(
                medium=decision_model.medium,
                location=decision_model.location,
                reasoning=decision_model.reasoning,
                fallback=decision_model.fallback,
            )
        except Exception as e:
            logger.error("Routing LLM decision failed: {}", e)
            # Fall through to fallback logic below

    # Fallback: use most recently active medium
    if available_mediums:
        fallback_medium = available_mediums[0]  # Already sorted by last_heartbeat DESC
        channels = fallback_medium.get("available_channels", [])
        if channels:
            # Smart channel selection: prefer DMs, then general/main channels, then first available
            selected_channel = _select_best_fallback_channel(channels)
            location = (
                selected_channel.get("id", str(selected_channel))
                if isinstance(selected_channel, dict)
                else str(selected_channel)
            )
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
