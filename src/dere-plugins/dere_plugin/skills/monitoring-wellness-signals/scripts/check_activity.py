#!/usr/bin/env python3
"""Check current activity from ActivityWatch."""

from __future__ import annotations

import json
import socket
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_activitywatch_url


def get_current_activity() -> dict | None:
    """Get most recent activity from ActivityWatch."""
    aw_url = get_activitywatch_url()
    hostname = socket.gethostname()
    bucket = f"aw-watcher-window_{hostname}"

    try:
        response = requests.get(
            f"{aw_url}/api/0/buckets/{bucket}/events",
            params={"limit": 1},
            timeout=2
        )
        response.raise_for_status()
        events = response.json()
        return events[0] if events else None
    except requests.exceptions.RequestException as e:
        print(f"Error querying ActivityWatch: {e}", file=sys.stderr)
        return None


def main():
    """Main entry point."""
    activity = get_current_activity()
    if activity:
        print(json.dumps(activity, indent=2))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
