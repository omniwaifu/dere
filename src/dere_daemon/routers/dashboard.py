"""Dashboard state aggregation endpoint for the tamagotchi UI."""

from __future__ import annotations

import socket
from datetime import UTC, datetime
from enum import Enum

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel

from dere_shared.activitywatch import ActivityWatchClient
from dere_shared.bond import BondManager

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Global bond manager instance (initialized on first use)
_bond_manager: BondManager | None = None


class EmotionHue(int, Enum):
    """HSL hue values for each emotion type.

    Positive emotions: greens, blues, warm tones
    Negative emotions: reds, grays
    Neutral: gray
    """

    # Positive emotions - warm/bright
    JOY = 142  # Green
    HOPE = 210  # Blue
    SATISFACTION = 150  # Teal-green
    RELIEF = 170  # Cyan-green
    HAPPY_FOR = 145  # Green
    PRIDE = 45  # Gold/amber
    ADMIRATION = 330  # Pink
    LOVE = 340  # Rose
    INTEREST = 270  # Purple
    GRATITUDE = 335  # Pink
    GRATIFICATION = 50  # Warm amber
    GLOATING = 40  # Orange-amber (mischievous)

    # Negative emotions - cool/muted
    DISTRESS = 0  # Red
    FEAR = 25  # Orange-red
    FEARS_CONFIRMED = 15  # Red-orange
    DISAPPOINTMENT = 220  # Muted blue
    PITY = 200  # Gray-blue
    RESENTMENT = 355  # Deep red
    SHAME = 280  # Muted purple
    REPROACH = 5  # Deep red
    HATE = 350  # Crimson
    DISGUST = 80  # Olive/sickly
    ANGER = 0  # Red
    REMORSE = 260  # Purple-gray

    # Neutral
    NEUTRAL = 220  # Cool gray-blue


EMOTION_HUE_MAP: dict[str, int] = {
    e.name.lower().replace("_", "-"): e.value for e in EmotionHue
}


def get_emotion_hue(emotion_type: str) -> int:
    """Get the HSL hue for an emotion type."""
    normalized = emotion_type.lower().replace("_", "-")
    return EMOTION_HUE_MAP.get(normalized, EmotionHue.NEUTRAL.value)


class EmotionState(BaseModel):
    """Current emotion state with color info."""

    type: str
    intensity: float
    hue: int
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


class BondStateResponse(BaseModel):
    """Current bond/affection state."""

    affection_level: float
    trend: str
    streak_days: int
    last_interaction_at: datetime | None = None
    context_summary: str = ""


class DashboardState(BaseModel):
    """Aggregated dashboard state for the UI."""

    emotion: EmotionState
    activity: ActivityState
    ambient: AmbientState
    bond: BondStateResponse | None = None
    attention_cue: str
    timestamp: datetime


def classify_activity(app: str, title: str) -> str:
    """Classify activity as productive, neutral, distracted, or absent."""
    app_lower = app.lower() if app else ""
    title_lower = title.lower() if title else ""

    # Productive: IDEs, terminals, documentation
    productive_apps = {
        "code", "cursor", "neovim", "vim", "nvim", "emacs", "jetbrains",
        "pycharm", "webstorm", "intellij", "goland", "rider", "datagrip",
        "terminal", "konsole", "alacritty", "kitty", "wezterm", "zellij", "tmux",
        "obsidian", "notion", "logseq", "zotero",
        "postman", "insomnia", "dbeaver", "pgadmin",
    }

    # Distracted: social media, games, entertainment
    distracted_apps = {
        "discord", "slack", "telegram", "whatsapp", "signal",
        "twitter", "x", "reddit", "facebook", "instagram", "tiktok",
        "steam", "lutris", "heroic", "game", "gaming",
        "youtube", "twitch", "netflix", "plex",
    }

    # Check app name
    for prod_app in productive_apps:
        if prod_app in app_lower:
            return "productive"

    for dist_app in distracted_apps:
        if dist_app in app_lower:
            return "distracted"

    # Browser is neutral unless title suggests otherwise
    if any(browser in app_lower for browser in ["firefox", "chrome", "chromium", "brave", "zen"]):
        # Check title for clues
        if any(site in title_lower for site in ["github", "stackoverflow", "docs", "documentation", "api", "reference"]):
            return "productive"
        if any(site in title_lower for site in ["youtube", "reddit", "twitter", "facebook"]):
            return "distracted"
        return "neutral"

    return "neutral"


def get_attention_context(
    activity: ActivityState,
    emotion: EmotionState,
    bond: BondStateResponse | None = None,
) -> dict:
    """Build context dict for attention cue generation.

    This provides structured data that can be used by LLM or template system.
    """
    return {
        "is_idle": activity.is_idle,
        "idle_minutes": activity.idle_duration_seconds // 60,
        "current_app": activity.current_app,
        "activity_category": activity.activity_category,
        "emotion_type": emotion.type,
        "emotion_intensity": emotion.intensity,
        "affection_level": bond.affection_level if bond else 50.0,
        "bond_trend": bond.trend if bond else "stable",
        "streak_days": bond.streak_days if bond else 0,
    }


# Minimal fallback cues when LLM unavailable - just state indicators
FALLBACK_CUES = {
    ("idle", "high"): "...",
    ("idle", "medium"): "...",
    ("idle", "low"): ".",
    ("productive", "high"): "watching",
    ("productive", "medium"): "here",
    ("productive", "low"): "present",
    ("distracted", "high"): "nearby",
    ("distracted", "medium"): "here",
    ("distracted", "low"): ".",
    ("neutral", "high"): "with you",
    ("neutral", "medium"): "here",
    ("neutral", "low"): ".",
}


def generate_attention_cue(
    activity: ActivityState,
    emotion: EmotionState,
    bond: BondStateResponse | None = None,
) -> str:
    """Generate minimal attention cue as fallback.

    Real cues should come from LLM via personality system.
    This is just a presence indicator.
    """
    affection = bond.affection_level if bond else 50.0

    # Determine warmth level
    if affection >= 65:
        warmth = "high"
    elif affection >= 35:
        warmth = "medium"
    else:
        warmth = "low"

    # Determine activity state
    if activity.is_idle:
        state = "idle"
    else:
        state = activity.activity_category

    return FALLBACK_CUES.get((state, warmth), "...")


async def get_activity_state() -> ActivityState:
    """Get current activity state from ActivityWatch."""
    try:
        hostname = socket.gethostname()
        client = ActivityWatchClient()
        now = datetime.now(UTC)

        # Check AFK status first
        afk_events = client.get_afk_events(hostname, 5)
        is_idle = True
        idle_duration = 0

        if afk_events:
            latest_afk = afk_events[0]
            status = latest_afk.get("data", {}).get("status", "afk")
            is_idle = status == "afk"
            if is_idle:
                # Calculate idle duration
                event_time = datetime.fromisoformat(
                    latest_afk["timestamp"].replace("Z", "+00:00")
                )
                idle_duration = int((now - event_time).total_seconds())

        # Get recent window activity
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


async def get_bond_manager() -> BondManager:
    """Get or create the global bond manager."""
    global _bond_manager
    if _bond_manager is None:
        from dere_daemon.main import app

        _bond_manager = BondManager(app.state.session_factory)
    return _bond_manager


@router.get("/state", response_model=DashboardState)
async def get_dashboard_state():
    """Get aggregated dashboard state for the UI."""
    from dere_daemon.main import app, get_global_emotion_manager

    now = datetime.now(UTC)

    # Get emotion state
    try:
        emotion_manager = await get_global_emotion_manager()
        mood = emotion_manager.get_current_mood()

        if mood:
            emotion = EmotionState(
                type=mood.dominant_emotion_type,
                intensity=mood.intensity,
                hue=get_emotion_hue(mood.dominant_emotion_type),
                last_updated=mood.last_updated,
            )
        else:
            emotion = EmotionState(
                type="neutral",
                intensity=0.0,
                hue=EmotionHue.NEUTRAL.value,
            )
    except Exception as e:
        logger.error(f"[dashboard] Emotion error: {e}")
        emotion = EmotionState(
            type="neutral",
            intensity=0.0,
            hue=EmotionHue.NEUTRAL.value,
        )

    # Get activity state
    activity = await get_activity_state()

    # Get ambient state
    ambient = AmbientState()
    try:
        monitor = app.state.ambient_monitor
        if monitor:
            ambient = AmbientState(
                fsm_state=monitor.fsm.state.value if monitor.fsm else "unknown",
                next_check_at=None,  # Could calculate from intervals
                is_enabled=True,
            )
    except Exception as e:
        logger.warning(f"[dashboard] Ambient state error: {e}")

    # Get bond state
    bond: BondStateResponse | None = None
    try:
        bond_manager = await get_bond_manager()
        await bond_manager.apply_decay()  # Apply any pending decay
        state = await bond_manager.get_state()
        bond = BondStateResponse(
            affection_level=state.affection_level,
            trend=state.trend,
            streak_days=state.streak_days,
            last_interaction_at=state.last_interaction_at,
            context_summary=bond_manager.get_context_summary(),
        )
    except Exception as e:
        logger.warning(f"[dashboard] Bond state error: {e}")

    # Generate attention cue (bond-aware)
    attention_cue = generate_attention_cue(activity, emotion, bond)

    return DashboardState(
        emotion=emotion,
        activity=activity,
        ambient=ambient,
        bond=bond,
        attention_cue=attention_cue,
        timestamp=now,
    )
