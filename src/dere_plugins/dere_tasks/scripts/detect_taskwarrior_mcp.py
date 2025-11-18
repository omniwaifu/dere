#!/usr/bin/env python3
"""Detect if taskwarrior MCP server is available."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _find_mcp_config() -> Path | None:
    """Find the MCP configuration file.

    Looks in common locations for MCP server configuration.
    """
    possible_locations = [
        Path.home() / ".config" / "mcp" / "config.json",
        Path.home() / ".mcp" / "config.json",
        Path.home() / "Library" / "Application Support" / "mcp" / "config.json",  # macOS
        Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")) / "mcp" / "config.json",
    ]

    for location in possible_locations:
        if location.exists():
            return location

    return None


def _check_taskwarrior_in_config(config_path: Path) -> bool:
    """Check if taskwarrior MCP server is configured.

    Args:
        config_path: Path to MCP configuration file

    Returns:
        True if taskwarrior server is found in configuration
    """
    try:
        with open(config_path) as f:
            config = json.load(f)

        # Check for taskwarrior server in MCP servers list
        servers = config.get("mcpServers", {})
        for server_name, server_config in servers.items():
            # Check if this is a taskwarrior server
            command = server_config.get("command", "")
            args = server_config.get("args", [])

            # Look for taskwarrior-related keywords
            if "taskwarrior" in server_name.lower():
                return True
            if "taskwarrior" in command.lower():
                return True
            if any("taskwarrior" in str(arg).lower() for arg in args):
                return True

        return False
    except Exception:
        return False


def _check_taskwarrior_command() -> bool:
    """Check if taskwarrior command is available in PATH.

    Returns:
        True if 'task' command is available
    """
    import shutil

    return shutil.which("task") is not None


def is_taskwarrior_mcp_available() -> bool:
    """Check if taskwarrior MCP tools are available.

    This is called from main.py during plugin loading to determine
    if the dere-tasks plugin should be enabled.

    Detection strategy:
    1. Check if MCP config file exists
    2. Check if taskwarrior server is configured in MCP
    3. Check if taskwarrior command is available

    Returns:
        True if taskwarrior MCP server appears to be available
    """
    # First check if taskwarrior itself is installed
    if not _check_taskwarrior_command():
        return False

    # Then check if MCP config has taskwarrior server
    config_path = _find_mcp_config()
    if not config_path:
        # No MCP config found, but taskwarrior is installed
        # Allow enabling the plugin (user may configure MCP later)
        return True

    # Check if taskwarrior is configured in MCP
    return _check_taskwarrior_in_config(config_path)


if __name__ == "__main__":
    # CLI usage: exit 0 if available, exit 1 if not
    if is_taskwarrior_mcp_available():
        print("Taskwarrior MCP available")
        sys.exit(0)
    else:
        print("Taskwarrior MCP not available")
        sys.exit(1)
