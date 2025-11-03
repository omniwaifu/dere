#!/usr/bin/env python3
"""Get detected patterns from synthesis system."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_daemon_url


def get_patterns(personality: list[str], limit: int = 10) -> dict | None:
    """Get patterns for personality combo."""
    daemon_url = get_daemon_url()

    payload = {"personality_combo": personality, "limit": limit, "format_with_personality": False}

    try:
        response = requests.post(
            f"{daemon_url}/api/synthesis/patterns",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error getting patterns: {e}", file=sys.stderr)
        return None


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: get_patterns.py <personality> [limit]", file=sys.stderr)
        print("Example: get_patterns.py tsun 10", file=sys.stderr)
        sys.exit(1)

    personality = sys.argv[1].split(",")
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    result = get_patterns(personality, limit)

    if result:
        print(json.dumps(result, indent=2))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
