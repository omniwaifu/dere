#!/usr/bin/env python3
"""Find orphan notes with low link density in vault."""

import re
import sys
from pathlib import Path


def count_links(content: str) -> dict[str, int]:
    """Count outgoing and backlink references in note content."""
    # Outgoing wikilinks: [[Note Name]]
    outgoing = len(re.findall(r"\[\[([^\]]+)\]\]", content))

    # This is just outgoing - backlinks require vault-wide analysis
    return {
        "outgoing": outgoing,
    }


def find_orphans(vault_path: str, min_links: int = 3) -> list[tuple[Path, int]]:
    """Find notes with fewer than min_links outgoing links."""
    vault = Path(vault_path).expanduser()

    if not vault.exists():
        print(f"Error: Vault path does not exist: {vault}", file=sys.stderr)
        return []

    orphans = []

    for md_file in vault.rglob("*.md"):
        # Skip certain directories
        if any(part.startswith(".") for part in md_file.parts):
            continue

        content = md_file.read_text(encoding="utf-8")
        links = count_links(content)

        if links["outgoing"] < min_links:
            orphans.append((md_file, links["outgoing"]))

    # Sort by link count (lowest first)
    orphans.sort(key=lambda x: x[1])

    return orphans


def main():
    if len(sys.argv) < 2:
        print("Usage: find-orphans.py <vault-path> [min-links]")
        print("  vault-path: Path to Obsidian vault")
        print("  min-links: Minimum outgoing links (default: 3)")
        sys.exit(1)

    vault_path = sys.argv[1]
    min_links = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    orphans = find_orphans(vault_path, min_links)

    if not orphans:
        print(f"No orphan notes found (all have {min_links}+ links)")
        return

    print(f"Found {len(orphans)} notes with < {min_links} outgoing links:\n")

    for note_path, link_count in orphans:
        rel_path = note_path.relative_to(Path(vault_path).expanduser())
        print(f"{link_count} links: {rel_path}")


if __name__ == "__main__":
    main()
