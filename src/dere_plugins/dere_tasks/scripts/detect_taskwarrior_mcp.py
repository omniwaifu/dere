#!/usr/bin/env python3
"""Detect if taskwarrior MCP server is available."""

from __future__ import annotations

import os
import platform
import shutil
import sys
from pathlib import Path


def get_config_dir() -> Path:
    """Get platform-specific config directory."""
    match platform.system():
        case "Windows":
            return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            return Path.home() / "Library" / "Application Support" / "dere"
        case _:
            # Linux and others
            return Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "dere"


def is_taskwarrior_mcp_available() -> bool:
    """Check if taskwarrior MCP tools are available.

    This is called from main.py during plugin loading to determine
    if the dere-tasks plugin should be enabled.

    Checks:
    1. If an MCP config exists with a taskwarrior server
    2. If the taskwarrior command is available on the system

    Returns True if either condition is met, allowing the plugin to work
    with or without MCP.
    """
    # Check for MCP server configuration
    try:
        # Avoid circular import by importing here
        import json

        config_dir = get_config_dir()
        mcp_config_path = config_dir / "mcp_config.json"

        if mcp_config_path.exists():
            with open(mcp_config_path) as f:
                config = json.load(f)

            # Check if any server contains "task" in its name or command
            mcp_servers = config.get("mcpServers", {})
            for server_name, server_config in mcp_servers.items():
                # Check server name
                if "task" in server_name.lower():
                    return True

                # Check command
                command = server_config.get("command", "")
                if "task" in command.lower():
                    return True

    except Exception:
        # If MCP config check fails, continue to other checks
        pass

    # Check if taskwarrior command is available on the system
    if shutil.which("task") is not None:
        return True

    # Default to False if neither MCP nor taskwarrior command is available
    return False


if __name__ == "__main__":
    # CLI usage: exit 0 if available, exit 1 if not
    if is_taskwarrior_mcp_available():
        print("Taskwarrior MCP available")
        sys.exit(0)
    else:
        print("Taskwarrior MCP not available")
        sys.exit(1)
