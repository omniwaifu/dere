"""Deterministic routing decision for multi-medium message delivery."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from dere_graph.llm_client import ClaudeClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


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
    """Decide where to route a message using simple deterministic logic.

    Args:
        user_id: User identifier
        message: The message to be delivered
        priority: Message priority ('alert' or 'conversation')
        available_mediums: List of online mediums with channels
        user_activity: Current user activity from ActivityWatch
        recent_conversations: Recent conversation history with mediums
        session_factory: SQLModel async session factory (unused, kept for compatibility)
        llm_client: Unused, kept for compatibility

    Returns:
        RoutingDecision with medium, location, and reasoning

    Logic:
    1. If mediums available, use most recently active
    2. Prefer DM channels over guild channels
    3. Fallback to desktop notification if nothing available
    """
    # If no mediums available, fall back to desktop notification
    if not available_mediums:
        return RoutingDecision(
            medium="desktop",
            location="notify-send",
            reasoning="No conversational mediums online",
            fallback=True,
        )

    # Use most recently active medium (already sorted by last_heartbeat DESC)
    active_medium = available_mediums[0]
    channels = active_medium.get("available_channels", [])

    if channels:
        # Smart channel selection: prefer DMs, then general/main channels, then first available
        selected_channel = _select_best_fallback_channel(channels)
        location = (
            selected_channel.get("id", str(selected_channel))
            if isinstance(selected_channel, dict)
            else str(selected_channel)
        )
        return RoutingDecision(
            medium=active_medium["medium"],
            location=location,
            reasoning=f"Routing to {active_medium['medium']} (most recently active)",
        )

    # Ultimate fallback
    return RoutingDecision(
        medium="desktop",
        location="notify-send",
        reasoning="No channels available for active medium",
        fallback=True,
    )
