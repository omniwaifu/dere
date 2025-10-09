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


def get_full_context(
    config: dict[str, Any] | None = None,
    session_id: int | None = None,
    daemon_url: str = "http://localhost:8787",
) -> str:
    """Get full context from all enabled sources.

    Gathers environmental context (time, weather, activity) and conversation context
    (past relevant conversations with temporal formatting), then combines them into
    a structured context block.

    Args:
        config: Optional configuration dictionary. If None, loads from config file.
        session_id: Optional session ID for retrieving conversation context
        daemon_url: URL of the dere daemon for conversation context retrieval

    Returns:
        Formatted context string with environmental and conversation context
    """
    if config is None:
        config = load_dere_config()

    environmental_parts = []

    # Time context (always enabled)
    try:
        if config["context"]["time"]:
            time_ctx = get_time_context()
            if time_ctx:
                environmental_parts.append(f"Current time: {time_ctx['time']}, {time_ctx['date']}")
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
                environmental_parts.append(weather_str)
    except Exception:
        pass

    # Activity context
    try:
        if config["context"]["activity"] or config["context"]["media_player"]:
            activity_ctx = get_activity_context(config)
            if activity_ctx:
                if activity_ctx.get("recent_apps"):
                    activity_str = "Recent activity: " + ", ".join(activity_ctx["recent_apps"])
                    environmental_parts.append(activity_str)
                elif activity_ctx.get("status"):
                    environmental_parts.append(f"User status: {activity_ctx['status']}")
    except Exception:
        pass

    # Recent files context
    try:
        if config["context"]["recent_files"]:
            files_ctx = get_recent_files_context(config)
            if files_ctx:
                files_str = "Recently modified: " + ", ".join(files_ctx)
                environmental_parts.append(files_str)
    except Exception:
        pass

    # Emotion context
    if session_id:
        try:
            import requests

            resp = requests.get(f"{daemon_url}/emotion/summary/{session_id}", timeout=1)
            if resp.status_code == 200:
                emotion_summary = resp.json().get("summary", "")
                if emotion_summary and emotion_summary != "Currently in a neutral emotional state.":
                    environmental_parts.append(f"Emotional state: {emotion_summary}")
        except Exception:
            pass

    # Build environmental context section
    sections = []
    if environmental_parts:
        env_context = " | ".join(environmental_parts)
        sections.append(f"[Environmental Context]\n{env_context}")

    # Fetch conversation context from daemon
    if session_id:
        try:
            import requests

            response = requests.get(
                f"{daemon_url}/context/get",
                json={"session_id": session_id, "max_age_minutes": 30},
                timeout=2,
            )
            if response.ok:
                data = response.json()
                conv_context = data.get("context")
                if conv_context and conv_context.strip():
                    sections.append(f"[Conversation Context]\n{conv_context}")
        except Exception:
            pass  # Silent failure - conversation context is supplementary

    return "\n\n".join(sections) if sections else ""
