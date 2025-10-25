#!/usr/bin/env python3
"""Search entity timeline."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_daemon_url


def search_entity(entity_name: str) -> dict | None:
    """Search for entity timeline."""
    daemon_url = get_daemon_url()

    try:
        response = requests.get(
            f"{daemon_url}/entities/timeline/{entity_name}",
            timeout=5
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error searching entity: {e}", file=sys.stderr)
        return None


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: entity_search.py <entity_name>", file=sys.stderr)
        sys.exit(1)

    entity_name = sys.argv[1]
    result = search_entity(entity_name)

    if result:
        print(json.dumps(result, indent=2))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
