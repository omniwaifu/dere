"""Context composition utilities for personality and emotional state."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dere_shared.models import Conversation, Session
from dere_shared.personalities import PersonalityLoader

if TYPE_CHECKING:
    pass


async def compose_session_context(
    session_id: int | None,
    session_factory: async_sessionmaker[AsyncSession],
    personality_loader: PersonalityLoader,
    medium: str | None = None,
    include_emotion: bool = True,
) -> tuple[str, int | None]:
    """Compose context from session personality and emotional state.

    Args:
        session_id: Optional session ID to use. If None, finds latest active session.
        session_factory: SQLModel async session factory
        personality_loader: PersonalityLoader instance
        medium: Optional medium filter ("cli", "discord", or None for any)
        include_emotion: Whether to include emotional state summary

    Returns:
        Tuple of (context_string, resolved_session_id)
        Returns ("", None) if no session or personality found.
    """
    async with session_factory() as db:
        # Resolve session if not provided
        if not session_id:
            # Get latest active session (with recent activity)
            stmt = (
                select(Session)
                .where(Session.end_time.is_(None))
                .order_by(Session.last_activity.desc())
                .limit(1)
            )

            if medium:
                # Find session with conversations in the specified medium
                stmt = (
                    select(Session)
                    .join(Conversation, Conversation.session_id == Session.id)
                    .where(Conversation.medium == medium)
                    .where(Session.end_time.is_(None))
                    .order_by(Session.last_activity.desc())
                    .limit(1)
                )

            result = await db.execute(stmt)
            session_obj = result.scalar_one_or_none()

            if not session_obj:
                return "", None
            session_id = session_obj.id

        # Get session personality
        stmt = select(Session.personality).where(Session.id == session_id)
        result = await db.execute(stmt)
        personality_name = result.scalar_one_or_none()

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
