"""Presence management endpoints."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import Presence

router = APIRouter(prefix="/presence", tags=["presence"])


# Request/Response models
class PresenceRegisterRequest(BaseModel):
    medium: str
    user_id: str
    available_channels: list[dict[str, Any]]


class PresenceHeartbeatRequest(BaseModel):
    medium: str
    user_id: str


class PresenceUnregisterRequest(BaseModel):
    medium: str
    user_id: str


@router.post("/register")
async def presence_register(req: PresenceRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a medium as online with available channels.

    Used by Discord/Telegram/etc bots to announce they are online and ready to receive messages.

    Future: Telegram integration
    Pattern for implementing additional mediums (e.g., Telegram, Slack, etc.):
    1. Create bot client similar to Discord's DereDiscordClient
    2. Call this endpoint on startup with medium="telegram"
    3. Provide available_channels with chat IDs and metadata
    4. Send heartbeats every 30s via /presence/heartbeat
    5. Poll /notifications/pending with medium="telegram" query param
    6. Deliver notifications via bot API (e.g., Telegram send_message)
    7. Link sessions with user_id for cross-medium continuity
    """
    logger.info(
        "Presence registered: {} for user {} with {} channels",
        req.medium,
        req.user_id,
        len(req.available_channels),
    )

    # Check if presence already exists
    stmt = select(Presence).where(
        Presence.medium == req.medium,
        Presence.user_id == req.user_id,
    )
    result = await db.execute(stmt)
    presence = result.scalar_one_or_none()

    if presence:
        stmt = (
            update(Presence)
            .where(Presence.medium == req.medium, Presence.user_id == req.user_id)
            .values(
                available_channels=req.available_channels,
                last_heartbeat=datetime.now(UTC),
            )
        )
        await db.execute(stmt)
    else:
        presence = Presence(
            medium=req.medium,
            user_id=req.user_id,
            available_channels=req.available_channels,
            last_heartbeat=datetime.now(UTC),
        )
        db.add(presence)

    return {"status": "registered"}


@router.post("/heartbeat")
async def presence_heartbeat(req: PresenceHeartbeatRequest, db: AsyncSession = Depends(get_db)):
    """Heartbeat to keep medium alive.

    Bots should call this every 30s to maintain presence.
    """
    stmt = (
        update(Presence)
        .where(Presence.medium == req.medium, Presence.user_id == req.user_id)
        .values(last_heartbeat=datetime.now(UTC))
    )
    await db.execute(stmt)
    return {"status": "ok"}


@router.post("/unregister")
async def presence_unregister(req: PresenceUnregisterRequest, db: AsyncSession = Depends(get_db)):
    """Cleanly unregister a medium on shutdown."""
    logger.info("Presence unregistered: {} for user {}", req.medium, req.user_id)

    stmt = delete(Presence).where(
        Presence.medium == req.medium,
        Presence.user_id == req.user_id,
    )
    await db.execute(stmt)
    return {"status": "unregistered"}


@router.get("/available")
async def presence_available(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get all online mediums for a user.

    Returns mediums that can currently receive messages.
    """
    # Consider presence stale after 60 seconds
    stale_threshold = datetime.now(UTC) - timedelta(seconds=60)

    stmt = (
        select(Presence)
        .where(Presence.user_id == user_id)
        .where(Presence.last_heartbeat >= stale_threshold)
    )
    result = await db.execute(stmt)
    presences = result.scalars().all()

    mediums = [
        {
            "medium": p.medium,
            "available_channels": json.loads(p.available_channels) if p.available_channels else [],
            "last_heartbeat": p.last_heartbeat,
        }
        for p in presences
    ]
    return {"mediums": mediums}
