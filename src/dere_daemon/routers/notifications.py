"""Notification system endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import Notification, NotificationContext

router = APIRouter(prefix="/notifications", tags=["notifications"])


# Request/Response models
class NotificationCreateRequest(BaseModel):
    user_id: str
    target_medium: str
    target_location: str
    message: str
    priority: str
    routing_reasoning: str
    parent_notification_id: int | None = None
    context_snapshot: dict[str, Any] | None = None
    trigger_type: str | None = None
    trigger_id: str | None = None
    trigger_data: dict[str, Any] | None = None


class NotificationDeliveredRequest(BaseModel):
    notification_id: int


class NotificationFailedRequest(BaseModel):
    notification_id: int
    error_message: str


class NotificationQueryRequest(BaseModel):
    user_id: str
    since: str


@router.post("/create")
async def notifications_create(req: NotificationCreateRequest, db: AsyncSession = Depends(get_db)):
    """Create a notification in the queue for delivery.

    Called by ambient monitor when it decides to engage.
    """
    notification = Notification(
        user_id=req.user_id,
        target_medium=req.target_medium,
        target_location=req.target_location,
        message=req.message,
        priority=req.priority,
        routing_reasoning=req.routing_reasoning,
        status="pending",
        created_at=datetime.now(UTC),
        parent_notification_id=req.parent_notification_id,
    )
    db.add(notification)
    await db.flush()

    if req.context_snapshot or req.trigger_type:
        notif_context = NotificationContext(
            notification_id=notification.id,
            trigger_type=req.trigger_type,
            trigger_id=req.trigger_id,
            trigger_data=req.trigger_data,
            context_snapshot=req.context_snapshot,
        )
        db.add(notif_context)

    await db.commit()

    # Truncate message for logging
    message_preview = req.message[:100] + "..." if len(req.message) > 100 else req.message
    logger.info(
        "Notification {} created: {} -> {} ({}) | \"{}\"",
        notification.id,
        req.target_medium,
        req.target_location,
        req.priority,
        message_preview,
    )
    return {"notification_id": notification.id, "status": "queued"}


@router.get("/recent")
async def notifications_recent(
    user_id: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
):
    """Get recent notifications for a user (for ambient monitor context)."""
    stmt = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    notifications = result.scalars().all()

    return {
        "notifications": [
            {
                "id": n.id,
                "message": n.message,
                "priority": n.priority,
                "status": n.status,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "delivered_at": n.delivered_at.isoformat() if n.delivered_at else None,
            }
            for n in notifications
        ]
    }


@router.get("/pending")
async def notifications_pending(medium: str, db: AsyncSession = Depends(get_db)):
    """Get pending notifications for a specific medium.

    Bots poll this endpoint to retrieve messages that need to be delivered.
    """
    stmt = (
        select(Notification)
        .where(Notification.target_medium == medium)
        .where(Notification.status == "pending")
        .order_by(Notification.priority.desc(), Notification.created_at.asc())
    )
    result = await db.execute(stmt)
    notifications = result.scalars().all()

    return {
        "notifications": [
            {
                "id": n.id,
                "user_id": n.user_id,
                "target_location": n.target_location,
                "message": n.message,
                "priority": n.priority,
                "routing_reasoning": n.routing_reasoning,
                "created_at": n.created_at,
            }
            for n in notifications
        ]
    }


@router.post("/recent_unacknowledged")
async def notifications_recent_unacknowledged(
    req: NotificationQueryRequest, db: AsyncSession = Depends(get_db)
):
    """Query recent unacknowledged notifications for escalation context.

    Returns notifications that were delivered but not acknowledged within the lookback period.
    """
    since_time = datetime.fromisoformat(req.since)

    stmt = (
        select(Notification)
        .where(
            Notification.user_id == req.user_id,
            Notification.created_at >= since_time,
            Notification.status == "delivered",
            ~Notification.acknowledged,
        )
        .order_by(Notification.created_at.desc())
        .limit(10)
    )

    result = await db.execute(stmt)
    notifications = result.scalars().all()

    return {
        "notifications": [
            {
                "id": n.id,
                "message": n.message,
                "priority": n.priority,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "delivered_at": n.delivered_at.isoformat() if n.delivered_at else None,
                "status": n.status,
                "acknowledged": n.acknowledged,
                "parent_notification_id": n.parent_notification_id,
            }
            for n in notifications
        ]
    }


@router.post("/{notification_id}/delivered")
async def notification_delivered(notification_id: int, db: AsyncSession = Depends(get_db)):
    """Mark a notification as successfully delivered.

    Called by bots after successfully sending a message.
    """
    stmt = (
        update(Notification)
        .where(Notification.id == notification_id)
        .values(
            status="delivered",
            delivered_at=datetime.now(UTC),
        )
    )
    await db.execute(stmt)
    await db.commit()

    logger.info("Notification {} marked as delivered", notification_id)
    return {"status": "delivered"}


@router.post("/{notification_id}/acknowledge")
async def notification_acknowledge(notification_id: int, db: AsyncSession = Depends(get_db)):
    """Mark a notification as acknowledged by the user.

    Called when user responds/interacts after receiving notification.
    This prevents escalation of the notification.
    """
    stmt = (
        update(Notification)
        .where(Notification.id == notification_id)
        .values(
            acknowledged=True,
            acknowledged_at=datetime.now(UTC),
        )
    )
    await db.execute(stmt)
    await db.commit()

    logger.info("Notification {} acknowledged by user", notification_id)
    return {"status": "acknowledged"}


@router.post("/{notification_id}/failed")
async def notification_failed(
    notification_id: int, req: NotificationFailedRequest, db: AsyncSession = Depends(get_db)
):
    """Mark a notification as failed with error message.

    Called by bots when message delivery fails.
    """
    stmt = (
        update(Notification)
        .where(Notification.id == notification_id)
        .values(
            status="failed",
            error_message=req.error_message,
            delivered_at=datetime.now(UTC),
        )
    )
    await db.execute(stmt)
    await db.commit()

    logger.warning("Notification {} failed: {}", notification_id, req.error_message)
    return {"status": "failed"}
