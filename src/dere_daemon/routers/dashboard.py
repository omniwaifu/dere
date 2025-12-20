"""Dashboard state aggregation endpoint."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel

from dere_shared.activitywatch import ActivityWatchService, classify_activity

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class EmotionState(BaseModel):
    """Current emotion state."""

    type: str
    intensity: float
    last_updated: int | None = None


class ActivityState(BaseModel):
    """Current user activity from ActivityWatch."""

    current_app: str | None = None
    current_title: str | None = None
    is_idle: bool = True
    idle_duration_seconds: int = 0
    activity_category: str = "absent"  # productive, neutral, distracted, absent


class AmbientState(BaseModel):
    """Current ambient monitor FSM state."""

    fsm_state: str = "unknown"
    next_check_at: datetime | None = None
    is_enabled: bool = False


class DashboardState(BaseModel):
    """Aggregated dashboard state for the UI."""

    emotion: EmotionState
    activity: ActivityState
    ambient: AmbientState
    timestamp: datetime


async def get_activity_state() -> ActivityState:
    """Get current activity state from ActivityWatch."""
    try:
        service = ActivityWatchService.from_config(cache_ttl_seconds=3)
        if not service:
            return ActivityState()

        snapshot = service.get_snapshot(lookback_minutes=5, top_n=3)
        current = snapshot.get("current_window") or snapshot.get("current_media")
        current_app = None
        current_title = None

        if current:
            current_app = current.get("app") or current.get("player")
            if current.get("app"):
                current_title = current.get("title")
            else:
                artist = current.get("artist")
                title = current.get("title")
                current_title = f"{artist} - {title}" if artist else title

        is_idle = snapshot.get("presence") == "away"
        idle_duration = snapshot.get("idle_seconds", 0) if is_idle else 0

        category = "absent"
        if not is_idle and current_app:
            category = snapshot.get("current_category") or classify_activity(
                current_app, current_title or ""
            )

        return ActivityState(
            current_app=current_app,
            current_title=current_title,
            is_idle=is_idle,
            idle_duration_seconds=idle_duration,
            activity_category=category,
        )
    except Exception as e:
        logger.warning(f"[get_activity_state] ActivityWatch error: {e}")
        return ActivityState()


@router.get("/state", response_model=DashboardState)
async def get_dashboard_state():
    """Get aggregated dashboard state for the UI."""
    from dere_daemon.main import app, get_global_emotion_manager

    now = datetime.now(UTC)

    try:
        emotion_manager = await get_global_emotion_manager()
        mood = emotion_manager.get_current_mood()

        if mood:
            emotion = EmotionState(
                type=mood.dominant_emotion_type,
                intensity=mood.intensity,
                last_updated=mood.last_updated,
            )
        else:
            emotion = EmotionState(
                type="neutral",
                intensity=0.0,
            )
    except Exception as e:
        logger.error(f"[dashboard] Emotion error: {e}")
        emotion = EmotionState(
            type="neutral",
            intensity=0.0,
        )

    activity = await get_activity_state()

    ambient = AmbientState()
    try:
        monitor = app.state.ambient_monitor
        if monitor:
            ambient = AmbientState(
                fsm_state=monitor.fsm.state.value if monitor.fsm else "unknown",
                next_check_at=None,
                is_enabled=True,
            )
    except Exception as e:
        logger.warning(f"[dashboard] Ambient state error: {e}")

    return DashboardState(
        emotion=emotion,
        activity=activity,
        ambient=ambient,
        timestamp=now,
    )
