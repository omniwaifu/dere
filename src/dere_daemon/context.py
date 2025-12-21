"""Context composition utilities for personality and emotional state."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dere_shared.config import load_dere_config
from dere_shared.models import Conversation, CoreMemoryBlock, Session
from dere_shared.personalities import PersonalityLoader
from dere_shared.xml_utils import add_line_numbers, render_tag, render_text_tag

if TYPE_CHECKING:
    pass


async def compose_session_context(
    session_id: int | None,
    session_factory: async_sessionmaker[AsyncSession],
    personality_loader: PersonalityLoader,
    medium: str | None = None,
    include_emotion: bool = True,
    line_numbered_xml: bool | None = None,
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
            session_user_id = session_obj.user_id
        else:
            session_obj = await db.get(Session, session_id)
            session_user_id = session_obj.user_id if session_obj else None

        # Get session personality
        stmt = select(Session.personality).where(Session.id == session_id)
        result = await db.execute(stmt)
        personality_name = result.scalar_one_or_none()

        sections: list[str] = []

        # Add personality prompt
        if personality_name:
            try:
                personality = personality_loader.load(personality_name)
                content = (personality.prompt_content or "").strip()
                if content:
                    sections.append(
                        render_text_tag(
                            "personality",
                            content,
                            indent=2,
                            attrs={"name": personality_name},
                        )
                    )
            except ValueError:
                # Personality not found, skip
                pass

        # Add core memory blocks if present
        core_blocks: dict[str, CoreMemoryBlock] = {}
        stmt = select(CoreMemoryBlock).where(
            CoreMemoryBlock.session_id == session_id,
            CoreMemoryBlock.block_type.in_(("persona", "human", "task")),
        )
        result = await db.execute(stmt)
        for block in result.scalars().all():
            core_blocks[block.block_type] = block

        if session_user_id:
            stmt = select(CoreMemoryBlock).where(
                CoreMemoryBlock.user_id == session_user_id,
                CoreMemoryBlock.session_id.is_(None),
                CoreMemoryBlock.block_type.in_(("persona", "human", "task")),
            )
            result = await db.execute(stmt)
            for block in result.scalars().all():
                if block.block_type not in core_blocks:
                    core_blocks[block.block_type] = block

        if core_blocks:
            core_sections = []
            for block_type in ("persona", "human", "task"):
                block = core_blocks.get(block_type)
                if not block:
                    continue
                content = (block.content or "").strip()
                if not content:
                    continue
                core_sections.append(render_text_tag(block_type, content, indent=4))
            if core_sections:
                sections.append(
                    render_tag("core_memory", "\n".join(core_sections), indent=2)
                )

        # Add emotional state if requested (uses global emotion manager)
        if include_emotion and sections:
            try:
                from dere_daemon.main import get_global_emotion_manager

                emotion_manager = await get_global_emotion_manager()
                emotion_summary = emotion_manager.get_emotional_state_summary()

                if emotion_summary and emotion_summary.strip():
                    sections.append(
                        render_text_tag("emotion", emotion_summary.strip(), indent=2)
                    )
            except Exception:
                # Emotion system unavailable, skip
                pass

        if not sections:
            return "", session_id

        context_xml = render_tag("context", "\n".join(sections), indent=0)
        if line_numbered_xml is None:
            config = load_dere_config()
            line_numbered_xml = config.get("context", {}).get("line_numbered_xml", False)
        if line_numbered_xml:
            context_xml = add_line_numbers(context_xml)

        return context_xml, session_id
