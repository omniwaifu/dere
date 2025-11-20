#!/usr/bin/env python3
"""Helper to read dere configuration."""

from __future__ import annotations

import tomllib

from dere_shared.paths import get_config_dir


def read_config() -> dict:
    """Read dere config.toml."""
    config_path = get_config_dir() / "config.toml"
    if not config_path.exists():
        return {}

    with open(config_path, "rb") as f:
        return tomllib.load(f)


def get_daemon_url() -> str:
    """Get daemon URL from config."""
    config = read_config()
    return config.get("ambient", {}).get("daemon_url", "http://localhost:8787")


def get_activitywatch_url() -> str:
    """Get ActivityWatch URL from config."""
    config = read_config()
    return config.get("activitywatch", {}).get("url", "http://localhost:5600")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: config_reader.py <daemon_url|activitywatch_url>")
        sys.exit(1)

    match sys.argv[1]:
        case "daemon_url":
            print(get_daemon_url())
        case "activitywatch_url":
            print(get_activitywatch_url())
        case _:
            print(f"Unknown config key: {sys.argv[1]}", file=sys.stderr)
            sys.exit(1)
