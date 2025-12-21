"""Aggregate context gathering from all sources."""

from __future__ import annotations

import subprocess
import time
from datetime import datetime
from typing import Any

from .config import load_dere_config
from .constants import DEFAULT_DAEMON_URL
from .weather import get_weather_context
from .xml_utils import add_line_numbers, render_tag, render_text_tag


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


async def get_full_context(
    config: dict[str, Any] | None = None,
    session_id: int | None = None,
    daemon_url: str = DEFAULT_DAEMON_URL,
    last_message_time: int | None = None,
    user_id: str | None = None,
    personality: str | None = None,
    current_prompt: str | None = None,
) -> str:
    """Get full context from all enabled sources.

    Gathers environmental context (time, weather, activity) and conversation context
    (past relevant conversations with temporal formatting), then combines them into
    a structured context block.

    Args:
        config: Optional configuration dictionary. If None, loads from config file.
        session_id: Optional session ID for retrieving conversation context
        daemon_url: URL of the dere daemon for conversation context retrieval
        last_message_time: Unix timestamp of last message for differential activity lookback

    Returns:
        Formatted context string with environmental and conversation context
    """
    if config is None:
        config = load_dere_config()

    environmental_parts = []
    emotion_summary = None

    # Time context (always enabled)
    try:
        if config["context"]["time"]:
            time_ctx = get_time_context()
            if time_ctx:
                time_parts = []
                if time_ctx.get("time"):
                    time_parts.append(
                        render_text_tag("time_of_day", time_ctx["time"], indent=6)
                    )
                if time_ctx.get("date"):
                    time_parts.append(render_text_tag("date", time_ctx["date"], indent=6))
                if time_ctx.get("timezone"):
                    time_parts.append(
                        render_text_tag("timezone", time_ctx["timezone"], indent=6)
                    )
                if time_parts:
                    environmental_parts.append(
                        render_tag("time", "\n".join(time_parts), indent=4)
                    )
    except Exception:
        pass

    # Weather context
    try:
        if config["context"]["weather"]:
            weather_ctx = get_weather_context(config)
            if weather_ctx:
                weather_parts = []
                for key in (
                    "location",
                    "conditions",
                    "temperature",
                    "feels_like",
                    "humidity",
                    "pressure",
                    "wind_speed",
                ):
                    value = weather_ctx.get(key)
                    if value:
                        weather_parts.append(render_text_tag(key, value, indent=6))
                if weather_parts:
                    environmental_parts.append(
                        render_tag("weather", "\n".join(weather_parts), indent=4)
                    )
    except Exception:
        pass

    # Activity context - MOVED TO dere-productivity plugin
    # (Activity context is now part of productivity features, not core personality)

    # Recent files context
    try:
        if config["context"]["recent_files"]:
            files_ctx = get_recent_files_context(config)
            if files_ctx:
                file_parts = [
                    render_text_tag("file", path, indent=6)
                    for path in files_ctx
                    if path
                ]
                if file_parts:
                    environmental_parts.append(
                        render_tag("recent_files", "\n".join(file_parts), indent=4)
                    )
    except Exception:
        pass

    # Task context - MOVED TO dere-productivity plugin
    # (Task context is now part of productivity features, not core personality)

    # Emotion context
    if session_id:
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{daemon_url}/emotion/summary/{session_id}", timeout=1.0)
                if resp.status_code == 200:
                    summary = resp.json().get("summary", "")
                    if summary and summary != "Currently in a neutral emotional state.":
                        emotion_summary = summary
        except Exception:
            pass

    # Knowledge graph context
    knowledge_graph_context = None
    try:
        if config["context"].get("knowledge_graph", False) and session_id and current_prompt:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{daemon_url}/context/build",
                    json={
                        "session_id": session_id,
                        "project_path": "",
                        "personality": personality or "assistant",
                        "user_id": user_id,
                        "context_depth": 5,
                        "current_prompt": current_prompt,
                    },
                    timeout=2.0,
                )
                if response.is_success:
                    data = response.json()
                    kg_context = data.get("context")
                    if kg_context and kg_context.strip():
                        knowledge_graph_context = kg_context
    except Exception:
        pass

    # Build environmental context section
    sections = []
    if environmental_parts:
        sections.append(
            render_tag("environment", "\n".join(environmental_parts), indent=2)
        )

    if emotion_summary:
        sections.append(render_text_tag("emotion", emotion_summary, indent=2))

    # Add knowledge graph context
    if knowledge_graph_context:
        sections.append(
            render_text_tag("knowledge_graph", knowledge_graph_context, indent=2)
        )

    # Fetch conversation context from daemon
    if session_id:
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{daemon_url}/context/get",
                    json={"session_id": session_id, "max_age_minutes": 30},
                    timeout=2.0,
                )
                if response.is_success:
                    data = response.json()
                    conv_context = data.get("context")
                    if conv_context and conv_context.strip():
                        sections.append(
                            render_text_tag("conversation", conv_context, indent=2)
                        )
        except Exception:
            pass  # Silent failure - conversation context is supplementary

    if not sections:
        return ""

    context_xml = render_tag("context", "\n".join(sections), indent=0)
    if config.get("context", {}).get("line_numbered_xml", False):
        return add_line_numbers(context_xml)
    return context_xml
