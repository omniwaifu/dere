#!/usr/bin/env python3
"""Format emotion state for human-readable output."""

from __future__ import annotations

import json
import sys


def format_emotion(state: dict) -> str:
    """Format emotion state into readable text."""
    lines = []

    primary = state.get("primary", {})
    if primary:
        name = primary.get("name", "unknown")
        intensity = primary.get("intensity", 0)
        lines.append(f"Primary: {name} ({intensity}% intensity)")

    secondary = state.get("secondary", {})
    if secondary:
        name = secondary.get("name", "unknown")
        intensity = secondary.get("intensity", 0)
        lines.append(f"Secondary: {name} ({intensity}% intensity)")

    trust = state.get("trust_level", 0)
    lines.append(f"Trust: {trust:.0%}")

    return "\n".join(lines)


def main():
    """Main entry point."""
    try:
        state = json.load(sys.stdin)
        print(format_emotion(state))
    except json.JSONDecodeError:
        print("Error: Invalid JSON input", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
