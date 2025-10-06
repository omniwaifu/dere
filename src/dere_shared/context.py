"""Aggregate context gathering from all sources."""

from __future__ import annotations

import subprocess
import time
from datetime import datetime
from typing import Any

from .activitywatch import get_activity_context
from .config import load_dere_config
from .weather import get_weather_context


def get_time_context() -> dict[str, str]:
    """Get current time and date context.

    Returns:
        Dictionary with time, date, and timezone fields
    """
    now = datetime.now()
    tz = time.strftime("%Z")

    return {
        "time": now.strftime("%H:%M:%S") + " " + tz,
        "date": now.strftime("%A, %B %d, %Y"),
        "timezone": tz,
    }


def get_recent_files_context(config: dict[str, Any]) -> list[str] | None:
    """Get recently modified files using fd.

    Args:
        config: Configuration dictionary with recent_files settings

    Returns:
        List of file paths or None on error
    """
    try:
        timeframe = config["context"]["recent_files_timeframe"]
        base_path = config["context"]["recent_files_base_path"]
        max_depth = config["context"]["recent_files_max_depth"]

        result = subprocess.run(
            [
                "fd",
                "--changed-within",
                timeframe,
                "--type",
                "f",
                "--max-depth",
                str(max_depth),
                ".",
                base_path,
            ],
            capture_output=True,
            text=True,
            timeout=1,
        )

        if result.returncode == 0 and result.stdout:
            files = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
            return files if files else None

        return None

    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        return None


def get_full_context(config: dict[str, Any] | None = None) -> str:
    """Get full context from all enabled sources.

    Gathers time, weather, and activity context based on configuration,
    and formats them into a single context string. Handles errors gracefully
    by providing partial context when some sources fail.

    Args:
        config: Optional configuration dictionary. If None, loads from config file.

    Returns:
        Formatted context string with all available context information
    """
    if config is None:
        config = load_dere_config()

    parts = []

    # Time context (always enabled)
    try:
        if config["context"]["time"]:
            time_ctx = get_time_context()
            if time_ctx:
                parts.append(f"Current time: {time_ctx['time']}, {time_ctx['date']}")
    except Exception:
        pass

    # Weather context
    try:
        if config["context"]["weather"]:
            weather_ctx = get_weather_context(config)
            if weather_ctx:
                weather_str = (
                    f"Weather in {weather_ctx['location']}: {weather_ctx['conditions']}, "
                    f"{weather_ctx['temperature']} (feels like {weather_ctx['feels_like']}), "
                    f"Humidity: {weather_ctx['humidity']}, Pressure: {weather_ctx['pressure']}"
                )
                parts.append(weather_str)
    except Exception:
        pass

    # Activity context
    try:
        if config["context"]["activity"] or config["context"]["media_player"]:
            activity_ctx = get_activity_context(config)
            if activity_ctx:
                if activity_ctx.get("recent_apps"):
                    activity_str = "Recent activity: " + ", ".join(activity_ctx["recent_apps"])
                    parts.append(activity_str)
                elif activity_ctx.get("status"):
                    parts.append(f"User status: {activity_ctx['status']}")
    except Exception:
        pass

    # Recent files context
    try:
        if config["context"]["recent_files"]:
            files_ctx = get_recent_files_context(config)
            if files_ctx:
                files_str = "Recently modified: " + ", ".join(files_ctx)
                parts.append(files_str)
    except Exception:
        pass

    return " | ".join(parts)
