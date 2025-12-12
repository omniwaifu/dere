#!/usr/bin/env python3
"""Read dere configuration for personality and daemon settings."""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path


def get_config_path() -> Path:
    """Get path to dere config file."""
    # Check for config in standard locations
    config_locations = [
        Path.home() / ".config" / "dere" / "config.toml",
        Path.home() / ".dere" / "config.toml",
    ]

    for loc in config_locations:
        if loc.is_file():
            return loc

    # Default to first location
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


def get_personality(vault_path: Path | None = None) -> str | None:
    """Get personality for current vault.

    Returns None if no personality configured.
    """
    config = load_config()

    if not config:
        return None

    # Check for vault-specific personality
    if vault_path:
        vault_configs = config.get("vaults", {})
        vault_config = vault_configs.get(str(vault_path), {})

        if "personality" in vault_config:
            return vault_config["personality"]

    # Check for global default personality
    return config.get("default_personality")


def get_daemon_url() -> str | None:
    """Get daemon URL from config.

    Returns None if not configured.
    """
    config = load_config()
    return config.get("daemon_url")


def is_daemon_enabled(vault_path: Path | None = None) -> bool:
    """Check if daemon integration is enabled for vault.

    Returns False if not configured.
    """
    config = load_config()

    if not config:
        return False

    # Check vault-specific setting
    if vault_path:
        vault_configs = config.get("vaults", {})
        vault_config = vault_configs.get(str(vault_path), {})

        if "enable_daemon" in vault_config:
            return vault_config["enable_daemon"]

    # Check global setting
    return config.get("enable_daemon", False)


if __name__ == "__main__":
    # CLI usage
    if len(sys.argv) > 1:
        command = sys.argv[1]

        if command == "personality":
            vault_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
            personality = get_personality(vault_path)
            if personality:
                print(personality)
                sys.exit(0)
            else:
                sys.exit(1)

        elif command == "daemon-url":
            url = get_daemon_url()
            if url:
                print(url)
                sys.exit(0)
            else:
                sys.exit(1)

        elif command == "daemon-enabled":
            vault_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
            enabled = is_daemon_enabled(vault_path)
            print("true" if enabled else "false")
            sys.exit(0 if enabled else 1)

    else:
        print(
            "Usage: config_reader.py [personality|daemon-url|daemon-enabled] [vault_path]",
            file=sys.stderr,
        )
        sys.exit(1)
