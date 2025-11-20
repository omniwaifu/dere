#!/usr/bin/env python3
"""Read dere configuration for daemon settings."""

from __future__ import annotations

import json
from pathlib import Path


def get_config_path() -> Path:
    """Get path to dere config file."""
    config_locations = [
        Path.home() / ".config" / "dere" / "config.json",
        Path.home() / ".dere" / "config.json",
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
        with open(config_path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def get_daemon_url() -> str:
    """Get daemon URL from config.

    Returns default localhost URL if not configured.
    """
    config = load_config()
    return config.get("daemon", {}).get("url", "http://localhost:8787")
