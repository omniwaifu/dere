"""Dashboard state aggregation endpoint."""

from __future__ import annotations

import socket
from datetime import UTC, datetime

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel

from dere_shared.activitywatch import ActivityWatchClient

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


def classify_activity(app: str, title: str) -> str:
    """Classify activity as productive, neutral, distracted, or absent."""
    app_lower = app.lower() if app else ""
    title_lower = title.lower() if title else ""

    productive_apps = {
        "code", "cursor", "neovim", "vim", "nvim", "emacs", "jetbrains",
        "pycharm", "webstorm", "intellij", "goland", "rider", "datagrip",
        "terminal", "konsole", "alacritty", "kitty", "wezterm", "zellij", "tmux",
        "obsidian", "notion", "logseq", "zotero",
        "postman", "insomnia", "dbeaver", "pgadmin",
    }

    distracted_apps = {
        "discord", "slack", "telegram", "whatsapp", "signal",
        "twitter", "x", "reddit", "facebook", "instagram", "tiktok",
        "steam", "lutris", "heroic", "game", "gaming",
        "youtube", "twitch", "netflix", "plex",
    }

    for prod_app in productive_apps:
        if prod_app in app_lower:
            return "productive"

    for dist_app in distracted_apps:
        if dist_app in app_lower:
            return "distracted"

    if any(browser in app_lower for browser in ["firefox", "chrome", "chromium", "brave", "zen"]):
        if any(site in title_lower for site in ["github", "stackoverflow", "docs", "documentation", "api", "reference"]):
            return "productive"
        if any(site in title_lower for site in ["youtube", "reddit", "twitter", "facebook"]):
            return "distracted"
        return "neutral"

    return "neutral"


async def get_activity_state() -> ActivityState:
    """Get current activity state from ActivityWatch."""
    try:
        hostname = socket.gethostname()
        client = ActivityWatchClient()
        now = datetime.now(UTC)

        afk_events = client.get_afk_events(hostname, 5)
        is_idle = True
        idle_duration = 0

        if afk_events:
            latest_afk = afk_events[0]
            status = latest_afk.get("data", {}).get("status", "afk")
            is_idle = status == "afk"
            if is_idle:
                event_time = datetime.fromisoformat(
                    latest_afk["timestamp"].replace("Z", "+00:00")
                )
                idle_duration = int((now - event_time).total_seconds())

        window_events = client.get_window_events(hostname, 2)
        current_app = None
        current_title = None

        if window_events:
            latest = window_events[0]
            current_app = latest.get("data", {}).get("app")
            current_title = latest.get("data", {}).get("title")

        category = "absent"
        if not is_idle and current_app:
            category = classify_activity(current_app, current_title or "")

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
