#!/usr/bin/env python3
"""Get related entities."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
from config_reader import get_daemon_url


def get_related_entities(entity_name: str, limit: int = 10) -> dict | None:
    """Get entities related to given entity."""
    daemon_url = get_daemon_url()

    try:
        response = requests.get(
            f"{daemon_url}/entities/related/{entity_name}", params={"limit": limit}, timeout=5
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error getting related entities: {e}", file=sys.stderr)
        return None


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: related_entities.py <entity_name> [limit]", file=sys.stderr)
        sys.exit(1)

    entity_name = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10

    result = get_related_entities(entity_name, limit)

    if result:
        print(json.dumps(result, indent=2))
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
