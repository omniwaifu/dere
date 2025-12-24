"""Ambient monitoring dashboard endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
import json
import re
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import Mission, MissionExecution, Notification, NotificationContext

router = APIRouter(prefix="/ambient", tags=["ambient"])


class AmbientConfigSummary(BaseModel):
    enabled: bool
    personality: str
    notification_method: str
    check_interval_minutes: int
    idle_threshold_minutes: int
    min_notification_interval_minutes: int
    activity_lookback_hours: int
    escalation_enabled: bool
    escalation_lookback_hours: int
    startup_delay_seconds: int
    fsm_enabled: bool
    fsm_intervals: dict[str, int | tuple[int, int]]
    fsm_weights: dict[str, float]
    exploring_enabled: bool
    exploring_min_idle_minutes: int
    exploring_interval_minutes: tuple[int, int]
    exploring_max_explorations_per_day: int
    exploring_max_daily_cost_usd: float


class AmbientRunSummary(BaseModel):
    mission_id: int
    mission_name: str
    execution_id: int
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    send: bool | None = None
    priority: str | None = None
    confidence: float | None = None
    message_preview: str | None = None


class AmbientNotificationSummary(BaseModel):
    notification_id: int
    message: str
    priority: str
    status: str
    created_at: datetime | None
    delivered_at: datetime | None
    acknowledged: bool
    target_medium: str
    target_location: str
    trigger_type: str | None = None
    context_snapshot: dict[str, Any] | None = None


class AmbientDashboardSummary(BaseModel):
    fsm_state: str
    is_enabled: bool
    last_run_at: datetime | None
    last_notification_at: datetime | None


class AmbientDashboardResponse(BaseModel):
    summary: AmbientDashboardSummary
    config: AmbientConfigSummary
    recent_runs: list[AmbientRunSummary]
    recent_notifications: list[AmbientNotificationSummary]
    timestamp: datetime


def _parse_ambient_output(text: str | None) -> dict[str, Any] | None:
    if not text:
        return None

    code_block = re.search(r"```json\s*(\{.*?\})\s*```", text, re.S)
    if code_block:
        try:
            return json.loads(code_block.group(1))
        except Exception:
            return None

    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            obj, _ = decoder.raw_decode(text[match.start():])
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


def _preview_message(message: str | None, limit: int = 160) -> str | None:
    if not message:
        return None
    if len(message) <= limit:
        return message
    return f"{message[:limit]}..."


@router.get("/dashboard", response_model=AmbientDashboardResponse)
async def ambient_dashboard(
    request: Request,
    limit_runs: int = 8,
    limit_notifications: int = 8,
    db: AsyncSession = Depends(get_db),
):
    from dere_ambient import load_ambient_config

    ambient_config = load_ambient_config()
    monitor = getattr(request.app.state, "ambient_monitor", None)
    fsm_state = "unknown"
    if monitor and monitor.fsm:
        fsm_state = monitor.fsm.state.value

    recent_runs: list[AmbientRunSummary] = []
    last_run_at = None

    stmt = (
        select(MissionExecution, Mission)
        .join(Mission, MissionExecution.mission_id == Mission.id)
        .where(Mission.name.ilike("ambient-%"))
        .order_by(MissionExecution.started_at.desc().nullslast(), MissionExecution.created_at.desc())
        .limit(limit_runs)
    )
    result = await db.execute(stmt)
    for execution, mission in result.all():
        decision = _parse_ambient_output(execution.output_text)
        send = None
        priority = None
        confidence = None
        message_preview = None
        if decision:
            send = decision.get("send")
            priority = decision.get("priority")
            raw_confidence = decision.get("confidence")
            if raw_confidence is not None:
                try:
                    confidence = float(raw_confidence)
                except (TypeError, ValueError):
                    confidence = None
            message_preview = _preview_message(decision.get("message"))

        run_time = execution.started_at or execution.created_at

        recent_runs.append(
            AmbientRunSummary(
                mission_id=mission.id or 0,
                mission_name=mission.name,
                execution_id=execution.id or 0,
                status=execution.status,
                started_at=execution.started_at,
                completed_at=execution.completed_at,
                send=send,
                priority=priority,
                confidence=confidence,
                message_preview=message_preview,
            )
        )
        if last_run_at is None and run_time:
            last_run_at = run_time

    recent_notifications: list[AmbientNotificationSummary] = []
    last_notification_at = None

    notif_stmt = (
        select(Notification, NotificationContext)
        .outerjoin(
            NotificationContext,
            NotificationContext.notification_id == Notification.id,
        )
        .where(Notification.user_id == ambient_config.user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit_notifications)
    )
    notif_result = await db.execute(notif_stmt)
    for notification, context in notif_result.all():
        recent_notifications.append(
            AmbientNotificationSummary(
                notification_id=notification.id or 0,
                message=notification.message,
                priority=notification.priority,
                status=notification.status,
                created_at=notification.created_at,
                delivered_at=notification.delivered_at,
                acknowledged=notification.acknowledged,
                target_medium=notification.target_medium,
                target_location=notification.target_location,
                trigger_type=context.trigger_type if context else None,
                context_snapshot=context.context_snapshot if context else None,
            )
        )
        if last_notification_at is None and notification.created_at:
            last_notification_at = notification.created_at

    config_summary = AmbientConfigSummary(
        enabled=ambient_config.enabled,
        personality=ambient_config.personality,
        notification_method=ambient_config.notification_method,
        check_interval_minutes=ambient_config.check_interval_minutes,
        idle_threshold_minutes=ambient_config.idle_threshold_minutes,
        min_notification_interval_minutes=ambient_config.min_notification_interval_minutes,
        activity_lookback_hours=ambient_config.activity_lookback_hours,
        escalation_enabled=ambient_config.escalation_enabled,
        escalation_lookback_hours=ambient_config.escalation_lookback_hours,
        startup_delay_seconds=ambient_config.startup_delay_seconds,
        fsm_enabled=ambient_config.fsm_enabled,
        fsm_intervals={
            "idle": ambient_config.fsm_idle_interval,
            "monitoring": ambient_config.fsm_monitoring_interval,
            "engaged": ambient_config.fsm_engaged_interval,
            "cooldown": ambient_config.fsm_cooldown_interval,
            "escalating": ambient_config.fsm_escalating_interval,
            "suppressed": ambient_config.fsm_suppressed_interval,
        },
        fsm_weights={
            "activity": ambient_config.fsm_weight_activity,
            "emotion": ambient_config.fsm_weight_emotion,
            "responsiveness": ambient_config.fsm_weight_responsiveness,
            "temporal": ambient_config.fsm_weight_temporal,
            "task": ambient_config.fsm_weight_task,
        },
        exploring_enabled=ambient_config.exploring.enabled,
        exploring_min_idle_minutes=ambient_config.exploring.min_idle_minutes,
        exploring_interval_minutes=ambient_config.exploring.exploration_interval_minutes,
        exploring_max_explorations_per_day=ambient_config.exploring.max_explorations_per_day,
        exploring_max_daily_cost_usd=ambient_config.exploring.max_daily_cost_usd,
    )

    summary = AmbientDashboardSummary(
        fsm_state=fsm_state,
        is_enabled=bool(ambient_config.enabled and monitor is not None),
        last_run_at=last_run_at,
        last_notification_at=last_notification_at,
    )

    return AmbientDashboardResponse(
        summary=summary,
        config=config_summary,
        recent_runs=recent_runs,
        recent_notifications=recent_notifications,
        timestamp=datetime.now(UTC),
    )
