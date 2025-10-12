"""Context composition utilities for personality and emotional state."""

from __future__ import annotations

from typing import TYPE_CHECKING

from dere_shared.personalities import PersonalityLoader

if TYPE_CHECKING:
    from dere_daemon.database import Database


async def compose_session_context(
    session_id: int | None,
    db: Database,
    personality_loader: PersonalityLoader,
    medium: str | None = None,
    include_emotion: bool = True,
) -> tuple[str, int | None]:
    """Compose context from session personality and emotional state.

    Args:
        session_id: Optional session ID to use. If None, finds latest active session.
        db: Database instance
        personality_loader: PersonalityLoader instance
        medium: Optional medium filter ("cli", "discord", or None for any)
        include_emotion: Whether to include emotional state summary

    Returns:
        Tuple of (context_string, resolved_session_id)
        Returns ("", None) if no session or personality found.
    """
    # Resolve session if not provided
    if not session_id:
        session = db.get_latest_active_session(medium=medium)
        if not session:
            return "", None
        session_id = session["id"]

    # Resolve personality using hierarchy: session > user_session > default
    personality_name = db.resolve_personality_hierarchy(session_id, default_personality=None)

    if not personality_name:
        return "", session_id

    context_parts = []

    # Add personality prompt
    try:
        personality = personality_loader.load(personality_name)
        context_parts.append(personality.prompt_content)
    except ValueError:
        # Personality not found, skip
        pass

    # Add emotional state if requested
    if include_emotion and context_parts:
        try:
            from dere_daemon.main import get_or_create_emotion_manager

            emotion_manager = await get_or_create_emotion_manager(session_id, personality_name)
            emotion_summary = emotion_manager.get_summary()

            if emotion_summary and emotion_summary.strip():
                context_parts.append(f"Current emotional state: {emotion_summary}")
        except Exception:
            # Emotion system unavailable, skip
            pass

    return "\n\n".join(context_parts), session_id
