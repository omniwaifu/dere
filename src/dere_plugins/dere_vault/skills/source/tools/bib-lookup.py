#!/usr/bin/env python3
"""Lookup citation from library.bib and output formatted frontmatter."""

from __future__ import annotations

import re
import sys
from datetime import UTC, datetime
from pathlib import Path


def parse_bibtex_entry(entry_text: str) -> dict[str, str]:
    """Parse BibTeX entry text into field dictionary."""
    fields = {}

    # Extract citekey from @type{citekey,
    citekey_match = re.search(r"@\w+\{([^,]+),", entry_text)
    if citekey_match:
        fields["citekey"] = citekey_match.group(1)

    # Extract fields: field = {value},
    field_pattern = r"(\w+)\s*=\s*\{([^}]+)\}"
    for match in re.finditer(field_pattern, entry_text):
        field_name = match.group(1).lower()
        field_value = match.group(2).strip()
        fields[field_name] = field_value

    return fields


def search_library_bib(search_term: str, bib_path: Path) -> list[str]:
    """Search library.bib for entries matching search term."""
    if not bib_path.exists():
        return []

    content = bib_path.read_text(encoding="utf-8")

    # Split into entries
    entries = re.split(r"\n@", content)
    matching_entries = []

    for entry in entries:
        # Add @ back if it was split off
        if not entry.startswith("@"):
            entry = "@" + entry

        # Case-insensitive search in entry
        if search_term.lower() in entry.lower():
            matching_entries.append(entry)

    return matching_entries


def format_frontmatter(fields: dict[str, str]) -> str:
    """Format BibTeX fields as YAML frontmatter."""
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M")

    # Determine source type from BibTeX type
    source_type = "source/article"
    if "booktitle" in fields or "isbn" in fields:
        source_type = "source/book"
    elif "journal" in fields:
        source_type = "source/paper"

    fm = f"""---
type: literature
status: draft
created: {now}
updated: {now}
"""

    # Add standard fields
    if "url" in fields:
        fm += f'source: {fields["url"]}\n'

    if "author" in fields:
        fm += f'author: {fields["author"]}\n'

    if "title" in fields:
        fm += f'title: {fields["title"]}\n'

    # Date fields
    if "year" in fields:
        fm += f'date_published: {fields["year"]}\n'
    elif "date" in fields:
        fm += f'date_published: {fields["date"]}\n'

    fm += f'date_accessed: {datetime.now(UTC).strftime("%Y-%m-%d")}\n'

    # Citation fields
    if "citekey" in fields:
        fm += f'citekey: {fields["citekey"]}\n'

    if "doi" in fields:
        fm += f'doi: {fields["doi"]}\n'

    # Academic paper fields
    if "journal" in fields:
        fm += f'journal: {fields["journal"]}\n'

    if "volume" in fields:
        fm += f'volume: {fields["volume"]}\n'

    if "issue" in fields or "number" in fields:
        issue = fields.get("issue", fields.get("number", ""))
        fm += f'issue: {issue}\n'

    if "pages" in fields:
        fm += f'pages: {fields["pages"]}\n'

    # Book fields
    if "isbn" in fields:
        fm += f'isbn: {fields["isbn"]}\n'

    if "publisher" in fields:
        fm += f'publisher: {fields["publisher"]}\n'

    if "edition" in fields:
        fm += f'edition: {fields["edition"]}\n'

    # Tags
    fm += f"""tags:
  - {source_type}
"""

    if "keywords" in fields:
        keywords = fields["keywords"].split(",")
        for kw in keywords[:3]:  # Limit to 3 tags
            tag = kw.strip().lower().replace(" ", "-")
            fm += f"  - {tag}\n"

    fm += "related:\n  - \n---\n"

    return fm


def main():
    if len(sys.argv) < 2:
        print("Usage: bib-lookup.py <search-term> [library.bib]")
        print("  search-term: Title, author, or citekey to search for")
        print("  library.bib: Path to library.bib (default: ./library.bib)")
        sys.exit(1)

    search_term = sys.argv[1]
    bib_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("library.bib")

    # Search for matching entries
    entries = search_library_bib(search_term, bib_path)

    if not entries:
        print(f"No entries found for: {search_term}", file=sys.stderr)
        sys.exit(1)

    if len(entries) > 1:
        print(f"Found {len(entries)} matching entries:", file=sys.stderr)
        for i, entry in enumerate(entries, 1):
            # Extract title for display
            title_match = re.search(r'title\s*=\s*\{([^}]+)\}', entry)
            title = title_match.group(1) if title_match else "Unknown"
            print(f"{i}. {title}", file=sys.stderr)
        print("\nUsing first match. Specify citekey for exact match.\n", file=sys.stderr)

    # Parse first matching entry
    fields = parse_bibtex_entry(entries[0])

    # Output formatted frontmatter
    frontmatter = format_frontmatter(fields)
    print(frontmatter)


if __name__ == "__main__":
    main()
