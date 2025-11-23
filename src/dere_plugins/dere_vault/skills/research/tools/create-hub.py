#!/usr/bin/env python3
"""Generate Hub template from tag or search query."""

import re
import sys
from datetime import UTC, datetime
from pathlib import Path


def find_notes_by_tag(vault_path: str, tag: str) -> list[Path]:
    """Find all notes with given tag."""
    vault = Path(vault_path).expanduser()
    matching_notes = []

    for md_file in vault.rglob("*.md"):
        # Skip hidden directories
        if any(part.startswith(".") for part in md_file.parts):
            continue

        content = md_file.read_text(encoding="utf-8")

        # Check for tag in frontmatter or body
        if f"#{tag}" in content or f"- {tag}" in content:
            matching_notes.append(md_file)

    return matching_notes


def extract_title(note_path: Path) -> str:
    """Extract title from note (first # heading or filename)."""
    content = note_path.read_text(encoding="utf-8")

    # Try to find first heading
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if match:
        return match.group(1)

    # Fall back to filename
    return note_path.stem


def generate_hub_template(topic: str, notes: list[Path], vault_path: str) -> str:
    """Generate Hub markdown from notes."""
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M")
    note_count = len(notes)

    # Build note links
    note_links = []
    for note in notes:
        title = extract_title(note)
        note_links.append(f"- [[{title}]]")

    links_str = "\n".join(note_links)

    template = f"""---
type: hub
created: {now}
updated: {now}
tags:
  - hub
  - {topic}
coverage: emerging
note_count: {note_count}
---

# Hub: {topic.replace("-", " ").title()}

## Overview

[Write 2-3 paragraphs introducing this topic area and why it matters]

## Core Concepts

Key permanent notes that define this area:

{links_str}

## Related Concepts

[Add supporting or adjacent ideas]

## Applications

[Add real-world uses and examples]

## Sources

[Add key literature notes]

## Open Questions

What's not yet understood:
- [Question 1]
- [Question 2]

## Related Hubs

[Add links to adjacent hub notes]
"""

    return template


def main():
    if len(sys.argv) < 3:
        print("Usage: create-hub.py <vault-path> <tag> [output-file]")
        print("  vault-path: Path to Obsidian vault")
        print("  tag: Tag to collect notes from (without #)")
        print("  output-file: Optional output file (default: stdout)")
        sys.exit(1)

    vault_path = sys.argv[1]
    tag = sys.argv[2].lstrip("#")
    output_file = sys.argv[3] if len(sys.argv) > 3 else None

    notes = find_notes_by_tag(vault_path, tag)

    if len(notes) < 5:
        print(
            f"Warning: Only {len(notes)} notes found with tag #{tag}", file=sys.stderr
        )
        print("Consider waiting until you have 10+ notes before creating Hub", file=sys.stderr)

    hub_content = generate_hub_template(tag, notes, vault_path)

    if output_file:
        Path(output_file).write_text(hub_content, encoding="utf-8")
        print(f"Hub template written to: {output_file}")
    else:
        print(hub_content)


if __name__ == "__main__":
    main()
