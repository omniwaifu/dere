"""Shared filesystem helpers for dere-discord."""

from __future__ import annotations

import os
import platform
from pathlib import Path


def get_config_dir() -> Path:
    """Return the configuration directory used by dere projects."""

    system = platform.system()
    if system == "Windows":
        return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "dere"
    return Path.home() / ".config" / "dere"


def format_project_path(
    *,
    guild_id: int | None,
    channel_id: int,
    user_id: int | None = None,
) -> str:
    """Build a project path string understood by the daemon."""

    if guild_id is None:
        return f"discord://dm/{user_id or channel_id}"
    return f"discord://guild/{guild_id}/channel/{channel_id}"
