#!/usr/bin/env python3
"""Query current emotion state from dere daemon."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

# Add parent scripts dir to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_daemon_url


def get_emotion_state() -> dict | None:
    """Get current emotion state."""
    daemon_url = get_daemon_url()

    try:
        response = requests.get(f"{daemon_url}/emotion/state", timeout=2)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error querying emotion state: {e}", file=sys.stderr)
        return None


def main():
    """Main entry point."""
    state = get_emotion_state()
    if state:
        print(json.dumps(state, indent=2))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
