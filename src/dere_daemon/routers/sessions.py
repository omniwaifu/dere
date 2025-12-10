"""Session management endpoints."""

from __future__ import annotations

import time
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, Request
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from dere_daemon.dependencies import get_db
from dere_shared.models import Conversation, Session

router = APIRouter(prefix="/sessions", tags=["sessions"])


# Request/Response models
class CreateSessionRequest(BaseModel):
    working_dir: str
    personality: str | None = None
    medium: str = "cli"


class CreateSessionResponse(BaseModel):
    session_id: int


class FindOrCreateSessionRequest(BaseModel):
    working_dir: str
    personality: str | None = None
    medium: str = "cli"
    max_age_hours: int | None = None
    user_id: str | None = None


class FindOrCreateSessionResponse(BaseModel):
    session_id: int
    resumed: bool
    claude_session_id: str | None


class StoreMessageRequest(BaseModel):
    message: str
    role: str = "user"


class StoreMessageResponse(BaseModel):
    message_id: int


@router.post("/create", response_model=CreateSessionResponse)
async def create_session(req: CreateSessionRequest, db: AsyncSession = Depends(get_db)):
    """Create a new session"""
    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
        personality=req.personality,
        medium=req.medium,
    )

    db.add(session)
    await db.flush()
    await db.refresh(session)

    return CreateSessionResponse(session_id=session.id)


@router.post("/find_or_create", response_model=FindOrCreateSessionResponse)
async def find_or_create_session(
    req: FindOrCreateSessionRequest, db: AsyncSession = Depends(get_db)
):
    """Find existing session or create new one with continuity support.

    If an existing session is found within max_age_hours, it will be resumed.
    If an old session exists but is outside max_age_hours, a new session will
    be created with continued_from linkage for historical continuity.
    """
    # Find latest session for this working_dir
    stmt = (
        select(Session)
        .where(Session.working_dir == req.working_dir)
        .order_by(Session.start_time.desc())
    )
    if req.max_age_hours is not None:
        cutoff_time = int(time.time()) - (req.max_age_hours * 3600)
        stmt = stmt.where(Session.start_time >= cutoff_time)

    result = await db.execute(stmt)
    existing = result.scalars().first()

    if existing and req.max_age_hours is not None:
        return FindOrCreateSessionResponse(
            session_id=existing.id,
            resumed=True,
            claude_session_id=existing.claude_session_id,
        )

    if existing and req.max_age_hours is None:
        return FindOrCreateSessionResponse(
            session_id=existing.id,
            resumed=True,
            claude_session_id=existing.claude_session_id,
        )

    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
        continued_from=existing.id if existing else None,
        personality=req.personality,
        medium=req.medium,
        user_id=req.user_id,
    )

    db.add(session)
    await db.flush()
    await db.refresh(session)

    return FindOrCreateSessionResponse(session_id=session.id, resumed=False, claude_session_id=None)


@router.post("/{session_id}/claude_session")
async def update_claude_session(
    session_id: int, claude_session_id: str = Body(...), db: AsyncSession = Depends(get_db)
):
    """Update the Claude SDK session ID for a daemon session.

    This is called after creating a ClaudeSDKClient and capturing its session ID
    from the first system init message.
    """
    logger.info(
        "Received claude_session_id update: session_id={}, claude_session_id={}",
        session_id,
        claude_session_id,
    )

    stmt = select(Session).where(Session.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one()

    session.claude_session_id = claude_session_id
    await db.flush()

    logger.info("Successfully updated claude_session_id for session {}", session_id)
    return {"status": "updated"}


@router.post("/{session_id}/message", response_model=StoreMessageResponse)
async def store_message(
    session_id: int,
    req: StoreMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    """Store a message"""
    conv = Conversation(
        session_id=session_id,
        prompt=req.message,
        message_type=req.role,
        timestamp=int(time.time()),
    )

    db.add(conv)
    await db.flush()
    await db.refresh(conv)

    return StoreMessageResponse(message_id=conv.id)


@router.get("/{session_id}/history")
async def get_history(session_id: int, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Get conversation history for a session"""
    stmt = (
        select(Conversation)
        .where(Conversation.session_id == session_id)
        .order_by(Conversation.timestamp.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()

    return {
        "messages": [
            {
                "id": msg.id,
                "prompt": msg.prompt,
                "message_type": msg.message_type,
                "timestamp": msg.timestamp,
            }
            for msg in messages
        ]
    }


@router.get("/{session_id}/last_message_time")
async def get_last_message_time(session_id: int, db: AsyncSession = Depends(get_db)):
    """Get timestamp of most recent conversation message in session"""
    stmt = (
        select(Conversation.created_at)
        .where(Conversation.session_id == session_id)
        .order_by(Conversation.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    timestamp = result.scalar_one_or_none()

    if timestamp:
        return {"session_id": session_id, "last_message_time": int(timestamp.timestamp())}
    return {"session_id": session_id, "last_message_time": None}


class EndSessionRequest(BaseModel):
    session_id: int


class EndSessionResponse(BaseModel):
    status: str
    summary_generated: bool = False
    reason: str | None = None


async def _generate_session_summary(content: str) -> str | None:
    """Generate a summary of session content using LLM."""
    from dere_shared.llm_client import ClaudeClient, Message

    prompt = f"""Summarize this conversation in 1-2 concise sentences. Focus on what was discussed and any outcomes.

{content[:2000]}"""

    try:
        client = ClaudeClient()
        messages = [Message(role="user", content=prompt)]
        summary = await client.generate_text_response(messages)
        return summary.strip()
    except Exception as e:
        logger.error(f"[sessions] Summary generation failed: {e}")
        return None


@router.post("/end", response_model=EndSessionResponse)
async def end_session(
    req: EndSessionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """End a session and generate summary.

    Flushes pending emotion appraisals and generates a rolling summary
    of recent conversation content.
    """
    # Flush pending emotion appraisal if manager exists
    app_state = request.app.state
    if hasattr(app_state, "emotion_managers"):
        # Check for global emotion manager (session_id=0)
        if 0 in app_state.emotion_managers:
            manager = app_state.emotion_managers[0]
            if manager.has_pending_stimuli():
                logger.info("[sessions] Flushing pending emotion appraisal on session end")
                try:
                    await manager.flush_batch_appraisal()
                except Exception as e:
                    logger.error(f"[sessions] Failed to flush emotion appraisal: {e}")

    # Get recent messages (last 30 min or last 50 messages)
    thirty_minutes_ago = int(time.time()) - 1800
    stmt = (
        select(Conversation.prompt, Conversation.message_type)
        .where(Conversation.session_id == req.session_id)
        .where(Conversation.timestamp >= thirty_minutes_ago)
        .order_by(Conversation.timestamp.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        # Mark as ended even with no content
        stmt = (
            update(Session)
            .where(Session.id == req.session_id)
            .values(end_time=int(time.time()))
        )
        await db.execute(stmt)
        await db.commit()
        return EndSessionResponse(status="ended", reason="no_content")

    # Build content for summarization
    content = "\n".join([f"{row.message_type}: {row.prompt}" for row in reversed(rows)])

    # Generate summary
    summary = await _generate_session_summary(content)

    # Update session
    update_values: dict = {"end_time": int(time.time())}
    if summary:
        update_values["summary"] = summary
        update_values["summary_updated_at"] = datetime.now(UTC)

    stmt = update(Session).where(Session.id == req.session_id).values(**update_values)
    await db.execute(stmt)
    await db.commit()

    if summary:
        logger.info(f"[sessions] Generated summary for session {req.session_id}")

    return EndSessionResponse(status="ended", summary_generated=summary is not None)


class SummaryContextResponse(BaseModel):
    summary: str | None = None
    session_ids: list[int] = []
    created_at: str | None = None


@router.get("/context", response_model=SummaryContextResponse)
async def get_summary_context(db: AsyncSession = Depends(get_db)):
    """Get the latest global summary context."""
    from dere_shared.models import SummaryContext

    stmt = (
        select(SummaryContext)
        .order_by(SummaryContext.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    context = result.scalar_one_or_none()

    if not context:
        return SummaryContextResponse()

    return SummaryContextResponse(
        summary=context.summary,
        session_ids=context.session_ids or [],
        created_at=context.created_at.isoformat() if context.created_at else None,
    )
