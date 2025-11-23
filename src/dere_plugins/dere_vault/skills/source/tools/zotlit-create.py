#!/usr/bin/env python3
"""
Create Obsidian literature notes from Zotero database entries.

Queries Zotero's SQLite database directly (~/Zotero/zotero.sqlite) and generates
formatted markdown notes using Jinja2 templates. Complements bib-lookup.py by accessing
full item metadata including abstracts, tags, and attachments.

Usage:
    zotlit-create.py "Computational Complexity"
    zotlit-create.py --author "Aaronson"
    zotlit-create.py --citekey "aaronson2011"
    zotlit-create.py --title "Quantum" --author "Aaronson" --vault ~/my-vault
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError:
    print("Error: jinja2 not installed. Run: uv pip install jinja2", file=sys.stderr)
    sys.exit(1)


@dataclass
class ZoteroItem:
    """Structured Zotero item data."""

    item_id: int
    key: str
    title: str
    authors: list[str]
    year: int | None
    publication: str | None
    abstract: str | None
    url: str | None
    doi: str | None
    tags: list[str]
    attachments: list[str]
    citekey: str | None
    item_type: str

    def format_authors(self) -> str:
        """Format authors as 'Last, First; Last2, First2'."""
        return "; ".join(self.authors)

    def format_filename(self, use_citekey: bool = False) -> str:
        """Generate filename: 'Author - Title (Year).md' or '@citekey.md'."""
        if use_citekey and self.citekey:
            return f"@{self.citekey}.md"

        # First author last name
        first_author = self.authors[0].split(",")[0] if self.authors else "Unknown"

        # Clean title (first 50 chars)
        clean_title = self.title[:50].replace("/", "-").replace(":", " -")

        # Year
        year_str = f"({self.year})" if self.year else ""

        return f"{first_author} - {clean_title} {year_str}.md".strip()


class ZoteroDatabase:
    """Query Zotero SQLite database."""

    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or Path.home() / "Zotero" / "zotero.sqlite"
        if not self.db_path.exists():
            raise FileNotFoundError(f"Zotero database not found: {self.db_path}")

    def search_items(
        self,
        title: str | None = None,
        author: str | None = None,
        citekey: str | None = None,
    ) -> list[ZoteroItem]:
        """Search for items by title, author, or citekey."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Base query for regular items (not attachments/notes)
        query = """
            SELECT DISTINCT i.itemID, i.key, it.typeName
            FROM items i
            JOIN itemTypes it ON i.itemTypeID = it.itemTypeID
            WHERE it.typeName NOT IN ('attachment', 'note', 'annotation')
            AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
        """
        params: list[str] = []

        # Add search conditions
        if title:
            query += " AND i.itemID IN (SELECT itemID FROM itemData id JOIN itemDataValues idv ON id.valueID = idv.valueID WHERE idv.value LIKE ?)"
            params.append(f"%{title}%")

        if author:
            query += """ AND i.itemID IN (
                SELECT itemID FROM itemCreators ic
                JOIN creators c ON ic.creatorID = c.creatorID
                WHERE c.lastName LIKE ? OR c.firstName LIKE ?
            )"""
            params.extend([f"%{author}%", f"%{author}%"])

        if citekey:
            # Better BibTeX stores citekey in itemData
            query += " AND i.itemID IN (SELECT itemID FROM itemData id JOIN itemDataValues idv ON id.valueID = idv.valueID WHERE idv.value LIKE ?)"
            params.append(f"%{citekey}%")

        cursor.execute(query, params)
        rows = cursor.fetchall()

        items = [self._load_item(cursor, row["itemID"], row["key"], row["typeName"]) for row in rows]
        conn.close()

        return items

    def _load_item(self, cursor: sqlite3.Cursor, item_id: int, key: str, item_type: str) -> ZoteroItem:
        """Load full item data for a given itemID."""
        # Get title and other fields
        cursor.execute(
            """
            SELECT f.fieldName, idv.value
            FROM itemData id
            JOIN fields f ON id.fieldID = f.fieldID
            JOIN itemDataValues idv ON id.valueID = idv.valueID
            WHERE id.itemID = ?
        """,
            (item_id,),
        )
        fields = {row[0]: row[1] for row in cursor.fetchall()}

        # Get authors
        cursor.execute(
            """
            SELECT c.lastName, c.firstName, ct.creatorType
            FROM itemCreators ic
            JOIN creators c ON ic.creatorID = c.creatorID
            JOIN creatorTypes ct ON ic.creatorTypeID = ct.creatorTypeID
            WHERE ic.itemID = ?
            ORDER BY ic.orderIndex
        """,
            (item_id,),
        )
        authors = [f"{row[0]}, {row[1]}" if row[1] else row[0] for row in cursor.fetchall()]

        # Get tags
        cursor.execute(
            """
            SELECT t.name
            FROM itemTags it
            JOIN tags t ON it.tagID = t.tagID
            WHERE it.itemID = ?
        """,
            (item_id,),
        )
        tags = [row[0] for row in cursor.fetchall()]

        # Get attachments
        cursor.execute(
            """
            SELECT ia.path
            FROM itemAttachments ia
            WHERE ia.parentItemID = ?
        """,
            (item_id,),
        )
        attachments = [row[0] for row in cursor.fetchall() if row[0]]

        # Extract year from date field
        date_str = fields.get("date", "")
        year = None
        if date_str:
            # Try to parse year (could be "2011", "2011-05-01", etc.)
            year_match = date_str.split("-")[0] if "-" in date_str else date_str
            try:
                year = int(year_match)
            except ValueError:
                pass

        return ZoteroItem(
            item_id=item_id,
            key=key,
            title=fields.get("title", "Untitled"),
            authors=authors,
            year=year,
            publication=fields.get("publicationTitle") or fields.get("journalAbbreviation"),
            abstract=fields.get("abstractNote"),
            url=fields.get("url"),
            doi=fields.get("DOI"),
            tags=tags,
            attachments=attachments,
            citekey=fields.get("citekey"),  # Better BibTeX extension
            item_type=item_type,
        )


class TemplateRenderer:
    """Render literature notes using Jinja2 templates."""

    def __init__(self, template_dir: Path | None = None):
        self.template_dir = template_dir or Path(__file__).parent / "templates"
        self.template_dir.mkdir(parents=True, exist_ok=True)

        self.env = Environment(
            loader=FileSystemLoader(self.template_dir),
            autoescape=select_autoescape(["html", "xml"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )

        # Ensure default template exists
        default_template = self.template_dir / "zotlit-default.md.j2"
        if not default_template.exists():
            self._create_default_template(default_template)

    def _create_default_template(self, path: Path) -> None:
        """Create default Jinja2 template."""
        template_content = '''---
title: "{{ item.title }}"
authors: {{ item.format_authors() }}
year: {{ item.year or "n.d." }}
{% if item.publication -%}
publication: "{{ item.publication }}"
{% endif -%}
{% if item.citekey -%}
citekey: "@{{ item.citekey }}"
{% endif -%}
{% if item.url -%}
url: {{ item.url }}
{% endif -%}
{% if item.doi -%}
doi: {{ item.doi }}
{% endif -%}
tags:
{% for tag in item.tags %}
  - {{ tag }}
{% endfor %}
date: {{ today }}
---

# {{ item.title }}

## Metadata
- **Authors**: {{ item.format_authors() }}
- **Year**: {{ item.year or "n.d." }}
{% if item.publication -%}
- **Publication**: {{ item.publication }}
{% endif -%}
{% if item.url -%}
- **URL**: {{ item.url }}
{% endif -%}
{% if item.doi -%}
- **DOI**: {{ item.doi }}
{% endif %}

## Abstract
{% if item.abstract -%}
{{ item.abstract }}
{% else -%}
_(No abstract available)_
{% endif %}

## Key Concepts
-

## Quotes & Notes


## Connections
-

## References
{% if item.attachments -%}
**Attachments**:
{%- for attachment in item.attachments %}
- {{ attachment }}
{%- endfor %}
{% endif %}
'''
        path.write_text(template_content)

    def render(self, item: ZoteroItem, template_name: str = "zotlit-default.md.j2") -> str:
        """Render item using specified template."""
        template = self.env.get_template(template_name)
        return template.render(item=item, today=datetime.now().strftime("%Y-%m-%d"))


def find_vault() -> Path | None:
    """Auto-detect vault directory."""
    candidates = [
        Path.home() / "vault",
        Path.home() / "Documents" / "vault",
        Path.home() / "Obsidian",
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


def log_to_daily_note(vault_path: Path, note_title: str) -> None:
    """Append link to today's daily note under Reading section."""
    today = datetime.now().strftime("%Y-%m-%d")
    daily_note_path = vault_path / "Journal" / f"{today}.md"

    # Ensure Journal directory exists
    daily_note_path.parent.mkdir(parents=True, exist_ok=True)

    # Create or append
    if not daily_note_path.exists():
        daily_note_path.write_text(f"# {today}\n\n## Reading\n- [[{note_title}]]\n")
    else:
        content = daily_note_path.read_text()
        if "## Reading" not in content:
            content += f"\n## Reading\n- [[{note_title}]]\n"
        else:
            # Append under existing Reading section
            lines = content.split("\n")
            for i, line in enumerate(lines):
                if line.startswith("## Reading"):
                    lines.insert(i + 1, f"- [[{note_title}]]")
                    break
            content = "\n".join(lines)
        daily_note_path.write_text(content)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create literature notes from Zotero database")
    parser.add_argument("--title", help="Search by title")
    parser.add_argument("--author", help="Search by author name")
    parser.add_argument("--citekey", help="Search by BibTeX citekey")
    parser.add_argument("--vault", type=Path, help="Vault directory (auto-detected if omitted)")
    parser.add_argument(
        "--citekey-naming",
        action="store_true",
        help="Use @citekey.md naming instead of Author - Title (Year).md",
    )
    parser.add_argument("--no-daily-log", action="store_true", help="Skip daily note logging")
    parser.add_argument("query", nargs="?", help="Quick search (searches title and author)")

    args = parser.parse_args()

    # Determine search params
    if args.query and not (args.title or args.author or args.citekey):
        # Quick search mode: search title only (more likely to match)
        title = args.query
        author = None
        citekey = None
    else:
        title = args.title
        author = args.author
        citekey = args.citekey

    if not (title or author or citekey):
        parser.error("Must provide search criteria: --title, --author, --citekey, or a query")

    # Search Zotero database
    try:
        db = ZoteroDatabase()
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    items = db.search_items(title=title, author=author, citekey=citekey)

    if not items:
        print("No items found matching search criteria.", file=sys.stderr)
        sys.exit(1)

    # Handle multiple matches
    if len(items) > 1:
        print(f"Found {len(items)} matches:")
        for i, item in enumerate(items, 1):
            authors_str = item.format_authors()[:50]
            print(f"{i}. {item.title[:60]} ({item.year or 'n.d.'}) - {authors_str}")

        # Interactive selection
        if sys.stdin.isatty():
            choice = input("\nSelect item number (1-{}, or 'q' to quit): ".format(len(items)))
            if choice.lower() == "q":
                sys.exit(0)
            try:
                selected = items[int(choice) - 1]
            except (ValueError, IndexError):
                print("Invalid selection.", file=sys.stderr)
                sys.exit(1)
        else:
            # Non-interactive: use first match
            selected = items[0]
            print(f"Using first match: {selected.title}")
    else:
        selected = items[0]

    # Render template
    renderer = TemplateRenderer()
    content = renderer.render(selected)

    # Determine vault path
    vault_path = args.vault or find_vault()
    if not vault_path:
        print("Error: Could not auto-detect vault. Use --vault to specify.", file=sys.stderr)
        sys.exit(1)

    # Generate filename
    filename = selected.format_filename(use_citekey=args.citekey_naming)
    note_path = vault_path / "Sources" / filename

    # Ensure Sources directory exists
    note_path.parent.mkdir(parents=True, exist_ok=True)

    # Write note
    if note_path.exists():
        print(f"Error: Note already exists: {note_path}", file=sys.stderr)
        sys.exit(1)

    note_path.write_text(content)
    print(f"Created: {note_path}")

    # Log to daily note
    if not args.no_daily_log:
        try:
            note_title = note_path.stem  # Filename without .md
            log_to_daily_note(vault_path, note_title)
            print(f"Logged to daily note: Journal/{datetime.now().strftime('%Y-%m-%d')}.md")
        except Exception as e:
            print(f"Warning: Could not log to daily note: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
