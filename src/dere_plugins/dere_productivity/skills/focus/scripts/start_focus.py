#!/usr/bin/env python3
"""Start a focus session on a task."""

from __future__ import annotations

import json
import sys

# Note: This script is meant to be called by Claude using the Bash tool
# Claude will use the MCP tools directly:
#   - mcp__taskwarrior__start_task
#   - mcp__taskwarrior__stop_task
# This script exists as a fallback/example

if __name__ == "__main__":
    print(
        json.dumps(
            {
                "error": "This script is a placeholder.",
                "message": "Use MCP tools: mcp__taskwarrior__start_task / stop_task",
            }
        )
    )
    sys.exit(1)
