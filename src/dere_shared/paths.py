"""Shared filesystem helpers for dere projects."""

from __future__ import annotations

import os
import platform
from pathlib import Path


def get_config_dir() -> Path:
    """Get platform-specific config directory."""
    match platform.system():
        case "Windows":
            return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            return Path.home() / "Library" / "Application Support" / "dere"
        case _:
            return Path.home() / ".config" / "dere"


def get_data_dir() -> Path:
    """Get platform-specific data directory."""
    match platform.system():
        case "Windows":
            return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            return Path.home() / "Library" / "Application Support" / "dere"
        case _:
            return Path.home() / ".local" / "share" / "dere"
