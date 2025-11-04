#!/usr/bin/env python3
"""Detect if taskwarrior MCP server is available."""

from __future__ import annotations

import sys


def is_taskwarrior_mcp_available() -> bool:
    """Check if taskwarrior MCP tools are available.

    This is called from main.py during plugin loading to determine
    if the dere-tasks plugin should be enabled.

    For now, returns True to always enable when explicitly loaded.
    In the future, could check MCP server availability.
    """
    # TODO: Add proper MCP server detection
    # For now, always return True when plugin is loaded
    return True


if __name__ == "__main__":
    # CLI usage: exit 0 if available, exit 1 if not
    if is_taskwarrior_mcp_available():
        print("Taskwarrior MCP available")
        sys.exit(0)
    else:
        print("Taskwarrior MCP not available")
        sys.exit(1)
