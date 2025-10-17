#!/usr/bin/env python3
"""Get session conversation history."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_daemon_url


def get_session_history(session_id: int) -> dict | None:
    """Get conversation history for session."""
    daemon_url = get_daemon_url()

    try:
        response = requests.get(
            f"{daemon_url}/sessions/{session_id}/history",
            timeout=5
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error getting session history: {e}", file=sys.stderr)
        return None


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: session_history.py <session_id>", file=sys.stderr)
        sys.exit(1)

    try:
        session_id = int(sys.argv[1])
    except ValueError:
        print("Error: session_id must be an integer", file=sys.stderr)
        sys.exit(1)

    result = get_session_history(session_id)

    if result:
        print(json.dumps(result, indent=2))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
