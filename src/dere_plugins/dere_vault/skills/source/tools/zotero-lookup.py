#!/usr/bin/env python3
"""
Check if URL or title exists in Zotero database.

Used by source skill to determine whether to use zotlit-create.py (if item exists)
or prompt user to add to Zotero (if item doesn't exist).

Usage:
    zotero-lookup.py --url "https://arxiv.org/abs/1234.5678"
    zotero-lookup.py --title "Computational Complexity"
    zotero-lookup.py --author "Aaronson"
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ZoteroMatch:
    """Lightweight Zotero item match."""

    item_id: int
    key: str
    title: str
    authors: str
    year: int | None
    url: str | None
    item_type: str


class ZoteroLookup:
    """Lightweight Zotero database lookup."""

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or Path.home() / "Zotero" / "zotero.sqlite"
        if not self.db_path.exists():
            raise FileNotFoundError(f"Zotero database not found: {self.db_path}")

    def check_url(self, url: str) -> list[ZoteroMatch]:
        """Check if URL exists in Zotero database."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Search in itemData for URL field
        cursor.execute(
            """
            SELECT DISTINCT i.itemID, i.key, it.typeName
            FROM items i
            JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
            JOIN itemData id ON i.itemID = id.itemID
            JOIN fields f ON id.fieldID = f.fieldID
            JOIN itemDataValues idv ON id.valueID = idv.valueID
            WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
            AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
            AND f.fieldName = 'url'
            AND idv.value = ?
        """,
            (url,),
        )

        rows = cursor.fetchall()
        matches = [self._load_item_summary(cursor, row["itemID"], row["key"], row["typeName"]) for row in rows]
        conn.close()

        return matches

    def check_title(self, title: str, author: str | None = None) -> list[ZoteroMatch]:
        """Check if title (optionally with author) exists in Zotero database."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        query = """
            SELECT DISTINCT i.itemID, i.key, it.typeName
            FROM items i
            JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
            WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
            AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
            AND i.itemID IN (
                SELECT itemID FROM itemData id
                JOIN fields f ON id.fieldID = f.fieldID
                JOIN itemDataValues idv ON id.valueID = idv.valueID
                WHERE f.fieldName = 'title'
                AND idv.value LIKE ?
            )
        """
        params: list[str] = [f"%{title}%"]

        if author:
            query += """ AND i.itemID IN (
                SELECT itemID FROM itemCreators ic
                JOIN creators c ON ic.creatorID = c.creatorID
                WHERE c.lastName LIKE ? OR c.firstName LIKE ?
            )"""
            params.extend([f"%{author}%", f"%{author}%"])

        cursor.execute(query, params)
        rows = cursor.fetchall()

        matches = [self._load_item_summary(cursor, row["itemID"], row["key"], row["typeName"]) for row in rows]
        conn.close()

        return matches

    def _load_item_summary(self, cursor: sqlite3.Cursor, item_id: int, key: str, item_type: str) -> ZoteroMatch:
        """Load minimal item data for display."""
        # Get title and URL
        cursor.execute(
            """
            SELECT f.fieldName, idv.value
            FROM itemData id
            JOIN fields f ON id.fieldID = f.fieldID
            JOIN itemDataValues idv ON id.valueID = idv.valueID
            WHERE id.itemID = ?
            AND f.fieldName IN ('title', 'url', 'date')
        """,
            (item_id,),
        )
        fields = {row[0]: row[1] for row in cursor.fetchall()}

        # Get first author
        cursor.execute(
            """
            SELECT c.lastName, c.firstName
            FROM itemCreators ic
            JOIN creators c ON ic.creatorID = c.creatorID
            WHERE ic.itemID = ?
            ORDER BY ic.orderIndex
            LIMIT 1
        """,
            (item_id,),
        )
        author_row = cursor.fetchone()
        author = f"{author_row[0]}, {author_row[1]}" if author_row and author_row[1] else (author_row[0] if author_row else "Unknown")

        # Extract year
        date_str = fields.get("date", "")
        year = None
        if date_str:
            year_match = date_str.split("-")[0] if "-" in date_str else date_str
            try:
                year = int(year_match)
            except ValueError:
                pass

        return ZoteroMatch(
            item_id=item_id,
            key=key,
            title=fields.get("title", "Untitled"),
            authors=author,
            year=year,
            url=fields.get("url"),
            item_type=item_type,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Check if URL or title exists in Zotero database")
    parser.add_argument("--url", help="Check by URL")
    parser.add_argument("--title", help="Check by title")
    parser.add_argument("--author", help="Filter by author (used with --title)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    if not (args.url or args.title):
        parser.error("Must provide --url or --title")

    try:
        lookup = ZoteroLookup()
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    # Perform lookup
    if args.url:
        matches = lookup.check_url(args.url)
    else:
        matches = lookup.check_title(args.title, args.author)

    # Output results
    if not matches:
        if args.json:
            print('{"found": false, "matches": []}')
        else:
            print("No matches found.")
        sys.exit(1)

    if args.json:
        import json

        output = {
            "found": True,
            "count": len(matches),
            "matches": [
                {
                    "item_id": m.item_id,
                    "key": m.key,
                    "title": m.title,
                    "authors": m.authors,
                    "year": m.year,
                    "url": m.url,
                    "item_type": m.item_type,
                }
                for m in matches
            ],
        }
        print(json.dumps(output, indent=2))
    else:
        print(f"Found {len(matches)} match(es):")
        for i, m in enumerate(matches, 1):
            year_str = f"({m.year})" if m.year else ""
            print(f"{i}. {m.title[:60]} {year_str} - {m.authors}")
            if m.url:
                print(f"   URL: {m.url}")

    sys.exit(0)


if __name__ == "__main__":
    main()
