#!/usr/bin/env python3
"""
Add item to Zotero library via Web API.

Requires configuration in ~/.config/dere/config.toml:
[zotero]
library_id = "12345"
library_type = "user"  # or "group"
api_key = "<generate at zotero.org/settings/keys>"

Generate API key at: https://www.zotero.org/settings/keys

Usage:
    zotero-add-item.py --url "https://arxiv.org/abs/1234.5678" --type webpage
    zotero-add-item.py --title "Article Title" --url "https://blog.com/post" --author "John Doe" --type blogPost
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

try:
    from pyzotero import zotero
except ImportError:
    print("Error: pyzotero not installed. Run: uv add pyzotero", file=sys.stderr)
    sys.exit(1)


@dataclass
class ZoteroConfig:
    """Zotero API configuration."""

    library_id: str
    library_type: str
    api_key: str


def load_config() -> ZoteroConfig:
    """Load Zotero configuration from config file."""
    config_path = Path.home() / ".config" / "dere" / "config.toml"

    if not config_path.exists():
        print(
            f"Error: Config file not found: {config_path}\n\n"
            "Create config file with:\n"
            "[zotero]\n"
            'library_id = "12345"\n'
            'library_type = "user"\n'
            'api_key = "generate_at_zotero_org_settings_keys"\n\n'
            "Generate API key at: https://www.zotero.org/settings/keys",
            file=sys.stderr,
        )
        sys.exit(1)

    with config_path.open("rb") as f:
        config = tomllib.load(f)

    if "zotero" not in config:
        print(
            "Error: [zotero] section missing in config.toml\n\n"
            "Add to config file:\n"
            "[zotero]\n"
            'library_id = "12345"\n'
            'library_type = "user"\n'
            'api_key = "generate_at_zotero_org_settings_keys"',
            file=sys.stderr,
        )
        sys.exit(1)

    zotero_config = config["zotero"]
    required_fields = ["library_id", "library_type", "api_key"]
    missing = [f for f in required_fields if f not in zotero_config]

    if missing:
        print(f"Error: Missing required fields in [zotero] config: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    return ZoteroConfig(
        library_id=zotero_config["library_id"],
        library_type=zotero_config["library_type"],
        api_key=zotero_config["api_key"],
    )


def create_item(
    zot: zotero.Zotero,
    item_type: str,
    title: str,
    url: str | None = None,
    author: str | None = None,
    date: str | None = None,
    abstract: str | None = None,
) -> dict:
    """Create item in Zotero library."""
    # Get template for item type
    template = zot.item_template(item_type)

    # Fill in metadata
    template["title"] = title

    if url:
        template["url"] = url
        template["accessDate"] = date or ""  # Use current date if provided

    if abstract:
        template["abstractNote"] = abstract

    # Add author/creator
    if author:
        # Parse "Last, First" or "First Last" format
        if "," in author:
            last, first = author.split(",", 1)
            last = last.strip()
            first = first.strip()
        else:
            parts = author.strip().split()
            first = " ".join(parts[:-1]) if len(parts) > 1 else ""
            last = parts[-1]

        # Determine creator type based on item type
        creator_type = "author"
        if item_type in ["webpage", "blogPost"]:
            creator_type = "author"
        elif item_type == "book":
            creator_type = "author"
        elif item_type in ["journalArticle", "preprint"]:
            creator_type = "author"

        template["creators"] = [{"creatorType": creator_type, "firstName": first, "lastName": last}]

    # Create item via API
    try:
        response = zot.create_items([template])
        return response
    except Exception as e:
        print(f"Error creating item: {e}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Add item to Zotero library via API")
    parser.add_argument("--title", required=True, help="Item title")
    parser.add_argument("--url", help="Item URL")
    parser.add_argument("--author", help="Author name (format: 'Last, First' or 'First Last')")
    parser.add_argument("--date", help="Publication/access date (YYYY-MM-DD)")
    parser.add_argument("--abstract", help="Item abstract/description")
    parser.add_argument(
        "--type",
        default="webpage",
        choices=["webpage", "blogPost", "journalArticle", "book", "preprint", "magazineArticle", "newspaperArticle"],
        help="Item type (default: webpage)",
    )
    parser.add_argument("--json", action="store_true", help="Output response as JSON")

    args = parser.parse_args()

    # Load configuration
    config = load_config()

    # Initialize Zotero client
    try:
        zot = zotero.Zotero(config.library_id, config.library_type, config.api_key)
    except Exception as e:
        print(f"Error initializing Zotero client: {e}", file=sys.stderr)
        sys.exit(1)

    # Create item
    response = create_item(
        zot,
        item_type=args.type,
        title=args.title,
        url=args.url,
        author=args.author,
        date=args.date,
        abstract=args.abstract,
    )

    # Output result
    if args.json:
        import json

        print(json.dumps(response, indent=2))
    else:
        if response.get("successful"):
            item_key = response["successful"]["0"]["key"]
            print(f"Successfully created item in Zotero")
            print(f"  Item key: {item_key}")
            print(f"  Title: {args.title}")
            if args.url:
                print(f"  URL: {args.url}")
            print(f"\nView in Zotero: https://www.zotero.org/users/{config.library_id}/items/{item_key}")
        elif response.get("failed"):
            print("Failed to create item:", file=sys.stderr)
            print(response["failed"], file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
