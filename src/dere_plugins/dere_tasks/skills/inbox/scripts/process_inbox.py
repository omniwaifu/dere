#!/usr/bin/env python3
"""Get inbox tasks for processing using taskwarrior MCP."""

from __future__ import annotations

import json
import sys

# Note: This script is meant to be called by Claude using the Bash tool
# Claude will use the MCP tool directly: mcp__taskwarrior__process_inbox
# This script exists as a fallback/example

if __name__ == "__main__":
    print(
        json.dumps(
            {
                "error": "This script is a placeholder.",
                "message": "Use MCP tool: mcp__taskwarrior__process_inbox",
            }
        )
    )
    sys.exit(1)
