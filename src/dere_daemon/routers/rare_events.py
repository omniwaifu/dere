"""Rare events API for spontaneous personality events."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from dere_daemon.dependencies import get_db
from dere_shared.models import RareEvent, RareEventType

router = APIRouter(prefix="/rare-events", tags=["rare-events"])


class RareEventResponse(BaseModel):
    """Rare event response."""

    id: int
    user_id: str
    event_type: str
    content: dict[str, Any] | None
    trigger_reason: str
    trigger_context: dict[str, Any] | None
    shown_at: str | None
    dismissed_at: str | None
    created_at: str


class CreateRareEventRequest(BaseModel):
    """Request to create a rare event."""

    event_type: str
    content: dict[str, Any] | None = None
    trigger_reason: str
    trigger_context: dict[str, Any] | None = None


def _event_to_response(event: RareEvent) -> RareEventResponse:
    """Convert RareEvent model to response."""
    return RareEventResponse(
        id=event.id,  # type: ignore
        user_id=event.user_id,
        event_type=event.event_type,
        content=event.content,
        trigger_reason=event.trigger_reason,
        trigger_context=event.trigger_context,
        shown_at=event.shown_at.isoformat() if event.shown_at else None,
        dismissed_at=event.dismissed_at.isoformat() if event.dismissed_at else None,
        created_at=event.created_at.isoformat(),
    )


@router.get("", response_model=list[RareEventResponse])
async def list_events(
    user_id: str = "default",
    limit: int = 10,
    unshown_only: bool = False,
    session: AsyncSession = Depends(get_db),
) -> list[RareEventResponse]:
    """List rare events for a user.

    Args:
        user_id: User ID to filter by
        limit: Maximum number of events to return
        unshown_only: Only return events that haven't been shown yet
    """
    stmt = (
        select(RareEvent)
        .where(RareEvent.user_id == user_id)
        .order_by(RareEvent.created_at.desc())
        .limit(limit)
    )

    if unshown_only:
        stmt = stmt.where(RareEvent.shown_at.is_(None))

    result = await session.execute(stmt)
    events = result.scalars().all()

    return [_event_to_response(e) for e in events]


@router.get("/pending", response_model=RareEventResponse | None)
async def get_pending_event(
    user_id: str = "default",
    session: AsyncSession = Depends(get_db),
) -> RareEventResponse | None:
    """Get the oldest unshown event for display.

    Returns the next event that should be shown to the user.
    """
    stmt = (
        select(RareEvent)
        .where(RareEvent.user_id == user_id)
        .where(RareEvent.shown_at.is_(None))
        .order_by(RareEvent.created_at.asc())
        .limit(1)
    )

    result = await session.execute(stmt)
    event = result.scalar_one_or_none()

    if event is None:
        return None

    return _event_to_response(event)


@router.get("/{event_id}", response_model=RareEventResponse)
async def get_event(
    event_id: int,
    session: AsyncSession = Depends(get_db),
) -> RareEventResponse:
    """Get a specific rare event by ID."""
    stmt = select(RareEvent).where(RareEvent.id == event_id)
    result = await session.execute(stmt)
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    return _event_to_response(event)


@router.post("", response_model=RareEventResponse)
async def create_event(
    request: CreateRareEventRequest,
    user_id: str = "default",
    session: AsyncSession = Depends(get_db),
) -> RareEventResponse:
    """Create a new rare event.

    This is typically called by the event generator background task,
    but can also be triggered manually or by agent tools.
    """
    # Validate event type
    try:
        RareEventType(request.event_type)
    except ValueError:
        valid_types = [e.value for e in RareEventType]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event_type '{request.event_type}'. Valid: {valid_types}",
        )

    event = RareEvent(
        user_id=user_id,
        event_type=request.event_type,
        content=request.content,
        trigger_reason=request.trigger_reason,
        trigger_context=request.trigger_context,
    )

    session.add(event)
    await session.commit()
    await session.refresh(event)

    logger.info(f"[rare_events] Created event: {request.event_type} for {user_id}")

    return _event_to_response(event)


@router.post("/{event_id}/shown", response_model=RareEventResponse)
async def mark_shown(
    event_id: int,
    session: AsyncSession = Depends(get_db),
) -> RareEventResponse:
    """Mark an event as shown.

    Called when the UI displays the event to the user.
    """
    stmt = select(RareEvent).where(RareEvent.id == event_id)
    result = await session.execute(stmt)
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.shown_at is not None:
        raise HTTPException(status_code=400, detail="Event already shown")

    event.shown_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(event)

    logger.debug(f"[rare_events] Marked event {event_id} as shown")

    return _event_to_response(event)


@router.post("/{event_id}/dismiss", response_model=RareEventResponse)
async def dismiss_event(
    event_id: int,
    session: AsyncSession = Depends(get_db),
) -> RareEventResponse:
    """Dismiss an event.

    Called when the user dismisses or interacts with the event.
    """
    stmt = select(RareEvent).where(RareEvent.id == event_id)
    result = await session.execute(stmt)
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    now = datetime.now(UTC)

    # Mark as shown if not already
    if event.shown_at is None:
        event.shown_at = now

    event.dismissed_at = now
    await session.commit()
    await session.refresh(event)

    logger.debug(f"[rare_events] Dismissed event {event_id}")

    return _event_to_response(event)
