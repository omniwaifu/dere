#!/usr/bin/env python3
"""Read dere configuration for daemon settings."""

from __future__ import annotations

import tomllib
from pathlib import Path

# Default daemon URL (matches dere_shared.constants.DEFAULT_DAEMON_URL)
DEFAULT_DAEMON_URL = "http://localhost:8787"


def get_config_path() -> Path:
    """Get path to dere config file."""
    config_locations = [
        Path.home() / ".config" / "dere" / "config.toml",
        Path.home() / ".dere" / "config.toml",
    ]

    for loc in config_locations:
        if loc.is_file():
            return loc

    return config_locations[0]


def load_config() -> dict:
    """Load dere configuration.

    Returns empty dict if config doesn't exist.
    """
    config_path = get_config_path()

    if not config_path.is_file():
        return {}

    try:
        with open(config_path, "rb") as f:
            return tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def get_daemon_url() -> str:
    """Get daemon URL from config.

    Returns default localhost URL if not configured.
    """
    config = load_config()
    return config.get("daemon", {}).get("url", DEFAULT_DAEMON_URL)
