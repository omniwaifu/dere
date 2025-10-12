"""Configuration loading for dere with TOML support."""

from __future__ import annotations

import os
from typing import Any


def load_dere_config() -> dict[str, Any]:
    """Load dere configuration from ~/.config/dere/config.toml with defaults.

    Returns a configuration dictionary with context and weather settings.
    Falls back to defaults if the config file doesn't exist or cannot be parsed.
    """
    config: dict[str, Any] = {
        "context": {
            "time": True,
            "weather": True,
            "activity": True,
            "media_player": True,
            "recent_files": True,
            "activity_lookback_minutes": 10,
            "activity_max_duration_hours": 6,
            "recent_files_timeframe": "1h",
            "recent_files_base_path": "/mnt/data/Code",
            "recent_files_max_depth": 5,
            "show_inactive_items": True,
            "update_interval_seconds": 0,
            "weather_cache_minutes": 10,
            "format": "concise",
            "max_title_length": 50,
            "show_duration_for_short": True,
        },
        "weather": {
            "enabled": False,
            "city": None,
            "units": "metric",
        },
        "discord": {
            "token": "",
            "default_persona": "tsun",
            "allowed_guilds": "",
            "allowed_channels": "",
            "idle_timeout_seconds": 1200,
            "summary_grace_seconds": 30,
            "context_enabled": True,
        },
        "database": {
            "url": "postgresql://postgres:dere@localhost/dere",
        },
        "synthesis": {
            "enabled": True,
            "auto_run_interval_hours": 24,
            "min_sessions_for_patterns": 5,
        },
    }

    config_path = os.path.expanduser("~/.config/dere/config.toml")
    if os.path.exists(config_path):
        try:
            import tomllib

            with open(config_path, "rb") as f:
                toml_config = tomllib.load(f)

            for section, values in toml_config.items():
                if section in config:
                    config[section].update(values)
                else:
                    config[section] = values

        except (ImportError, OSError, ValueError):
            pass

    return config


def _parse_simple_toml(content: str) -> dict[str, Any]:
    """Simple TOML parser for basic key=value pairs.

    Fallback parser for Python <3.11 that handles basic TOML syntax.
    Only supports simple key=value pairs within sections.
    """
    config: dict[str, Any] = {"context": {}, "weather": {}}
    current_section: str | None = None

    for line in content.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("[") and line.endswith("]"):
            current_section = line[1:-1]
            continue

        if "=" in line and current_section in config:
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.split("#")[0].strip().strip("\"'")

            match value.lower():
                case "true":
                    parsed_value: Any = True
                case "false":
                    parsed_value = False
                case _ if value.isdigit():
                    parsed_value = int(value)
                case _:
                    parsed_value = value

            config[current_section][key] = parsed_value

    return config
