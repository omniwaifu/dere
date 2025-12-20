"""ActivityWatch aggregation endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from dere_shared.activitywatch import ActivityWatchService

router = APIRouter(prefix="/activity", tags=["activity"])


class ActivityStateResponse(BaseModel):
    enabled: bool
    timestamp: str | None = None
    hostname: str | None = None
    lookback_minutes: int | None = None
    recency_seconds: int | None = None
    presence: str | None = None
    is_afk: bool | None = None
    idle_seconds: int | None = None
    current_window: dict[str, Any] | None = None
    current_media: dict[str, Any] | None = None
    top_apps: list[dict[str, Any]] = []
    top_titles: list[dict[str, Any]] = []
    window_events_count: int | None = None
    media_events_count: int | None = None
    afk_events_count: int | None = None
    window_switches: int | None = None
    unique_apps: int | None = None
    unique_titles: int | None = None
    focus_streak_seconds: float | int | None = None
    media_streak_seconds: float | int | None = None
    current_category: str | None = None
    category_totals: dict[str, float] | None = None
    top_categories: list[dict[str, Any]] = []
    context_fingerprint: str | None = None
    recent_windows: list[dict[str, Any]] = []
    recent_media: list[dict[str, Any]] = []
    status: str | None = None


@router.get("/state", response_model=ActivityStateResponse)
async def activity_state(
    t: int | None = None,
    minutes: int | None = None,
    top: int = 5,
    recency_seconds: int = 120,
    include_recent: bool = False,
    recent_limit: int = 5,
):
    """Get current ActivityWatch state.

    Args:
        t: Lookback minutes (alias for minutes)
        minutes: Lookback minutes
        top: Top-N apps/titles to return
        recency_seconds: Recency window for "current" determination
    """
    lookback_minutes = t or minutes or 10
    service = ActivityWatchService.from_config(cache_ttl_seconds=2)
    if not service:
        return ActivityStateResponse(enabled=False, status="disabled")

    snapshot = service.get_snapshot(
        lookback_minutes=lookback_minutes,
        top_n=top,
        recency_seconds=recency_seconds,
        include_recent=include_recent,
        recent_limit=recent_limit,
    )
    return ActivityStateResponse(**snapshot)
