#!/usr/bin/env python3
"""Analyze link density and knowledge graph health in permanent notes."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from .detect_vault import find_vault_root
except ImportError:
    from detect_vault import find_vault_root


def extract_wikilinks(content: str) -> set[str]:
    """Extract [[wikilinks]] from note content."""
    return set(re.findall(r"\[\[([^\]]+)\]\]", content))


def extract_frontmatter_tags(content: str) -> list[str]:
    """Extract tags from YAML frontmatter."""
    match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return []

    frontmatter = match.group(1)
    tags = []
    in_tags = False

    for line in frontmatter.split("\n"):
        if line.startswith("tags:"):
            in_tags = True
            continue
        if in_tags:
            if line.startswith("  - "):
                tags.append(line.replace("  - ", "").strip())
            elif not line.startswith(" "):
                break

    return tags


def extract_title(content: str) -> str | None:
    """Extract title from frontmatter or first heading."""
    # Try frontmatter first
    match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if match:
        title_match = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", match.group(1), re.MULTILINE)
        if title_match:
            return title_match.group(1)

    # Fall back to first heading
    heading_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if heading_match:
        return heading_match.group(1)

    return None


def is_permanent_note(content: str) -> bool:
    """Check if note is a permanent note."""
    match = re.search(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return False

    frontmatter = match.group(1)
    return "type: permanent" in frontmatter


def analyze_vault(vault_path: Path) -> dict:
    """Analyze link structure of all permanent notes."""
    notes = {}
    note_titles = {}

    # First pass: collect all permanent notes and their titles
    for note_path in vault_path.rglob("*.md"):
        try:
            content = note_path.read_text(encoding="utf-8")
        except Exception:
            continue

        if not is_permanent_note(content):
            continue

        title = extract_title(content)
        if not title:
            continue

        note_key = note_path.stem
        note_titles[note_key] = title
        note_titles[title] = title  # Also map title to itself

        links = extract_wikilinks(content)
        tags = extract_frontmatter_tags(content)

        notes[note_key] = {
            "path": note_path.relative_to(vault_path),
            "title": title,
            "links_out": links,
            "links_in": set(),
            "tags": tags,
        }

    # Second pass: calculate incoming links
    for note_key, note_data in notes.items():
        for link in note_data["links_out"]:
            # Try to find the target note
            # Links could be to filename or to title
            target_key = link
            if link in note_titles:
                # Find the note with this title
                for k, data in notes.items():
                    if data["title"] == link:
                        target_key = k
                        break

            if target_key in notes:
                notes[target_key]["links_in"].add(note_key)

    return notes


def find_orphans(notes: dict, min_links: int = 3) -> list[dict]:
    """Find notes with fewer than min_links total links."""
    orphans = []

    for note_key, note_data in notes.items():
        total_links = len(note_data["links_out"]) + len(note_data["links_in"])
        if total_links < min_links:
            orphans.append({
                "title": note_data["title"],
                "path": note_data["path"],
                "links_out": len(note_data["links_out"]),
                "links_in": len(note_data["links_in"]),
                "total": total_links,
            })

    orphans.sort(key=lambda x: x["total"])
    return orphans


def suggest_connections(notes: dict, note_key: str, limit: int = 5) -> list[dict]:
    """Suggest potential connections for a note based on tag overlap."""
    if note_key not in notes:
        return []

    target_note = notes[note_key]
    target_tags = set(target_note["tags"])

    if not target_tags:
        return []

    suggestions = []

    for other_key, other_note in notes.items():
        if other_key == note_key:
            continue

        # Skip if already linked
        if other_key in target_note["links_out"] or other_key in target_note["links_in"]:
            continue

        other_tags = set(other_note["tags"])
        overlap = target_tags & other_tags

        if overlap:
            suggestions.append({
                "title": other_note["title"],
                "path": other_note["path"],
                "shared_tags": list(overlap),
                "overlap_count": len(overlap),
            })

    suggestions.sort(key=lambda x: x["overlap_count"], reverse=True)
    return suggestions[:limit]


def calculate_statistics(notes: dict) -> dict:
    """Calculate vault-wide link statistics."""
    if not notes:
        return {}

    link_counts = [len(n["links_out"]) + len(n["links_in"]) for n in notes.values()]
    out_counts = [len(n["links_out"]) for n in notes.values()]
    in_counts = [len(n["links_in"]) for n in notes.values()]

    return {
        "total_notes": len(notes),
        "avg_total_links": sum(link_counts) / len(link_counts),
        "avg_out_links": sum(out_counts) / len(out_counts),
        "avg_in_links": sum(in_counts) / len(in_counts),
        "max_links": max(link_counts),
        "min_links": min(link_counts),
    }


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Analyze knowledge graph link health")
    parser.add_argument("--vault-path", type=Path, help="Path to vault (auto-detected if not provided)")
    parser.add_argument("--orphans", action="store_true", help="Show orphaned notes (< 3 total links)")
    parser.add_argument("--suggest", type=str, help="Suggest connections for a note (by title or filename)")
    parser.add_argument("--stats", action="store_true", help="Show vault-wide statistics")
    parser.add_argument("--min-links", type=int, default=3, help="Minimum links for non-orphan status")

    args = parser.parse_args()

    # Find vault
    vault_path = args.vault_path
    if not vault_path:
        vault_path = find_vault_root()
        if not vault_path:
            print("Error: Could not find vault. Specify --vault-path", file=sys.stderr)
            return 1

    # Analyze
    print("Analyzing vault knowledge graph...\n")
    notes = analyze_vault(vault_path)

    if not notes:
        print("No permanent notes found in vault")
        return 0

    # Show statistics
    if args.stats or (not args.orphans and not args.suggest):
        stats = calculate_statistics(notes)
        print("Vault Statistics:")
        print(f"  Total permanent notes: {stats['total_notes']}")
        print(f"  Average total links: {stats['avg_total_links']:.1f}")
        print(f"  Average outgoing links: {stats['avg_out_links']:.1f}")
        print(f"  Average incoming links: {stats['avg_in_links']:.1f}")
        print(f"  Max links (any note): {stats['max_links']}")
        print(f"  Min links (any note): {stats['min_links']}")
        print()

    # Show orphans
    if args.orphans:
        orphans = find_orphans(notes, args.min_links)
        if orphans:
            print(f"Found {len(orphans)} orphaned note(s) with < {args.min_links} total links:\n")
            for i, orphan in enumerate(orphans, 1):
                print(f"{i}. {orphan['title']}")
                print(f"   Path: {orphan['path']}")
                print(f"   Links: {orphan['links_out']} out, {orphan['links_in']} in ({orphan['total']} total)")
                print()
        else:
            print(f"No orphaned notes found (all notes have >= {args.min_links} links)")

    # Suggest connections
    if args.suggest:
        # Find note by title or filename
        note_key = None
        for key, note_data in notes.items():
            if key == args.suggest or note_data["title"] == args.suggest:
                note_key = key
                break

        if not note_key:
            print(f"Error: Note not found: {args.suggest}", file=sys.stderr)
            return 1

        suggestions = suggest_connections(notes, note_key)
        if suggestions:
            print(f"Suggested connections for: {notes[note_key]['title']}\n")
            for i, suggestion in enumerate(suggestions, 1):
                print(f"{i}. {suggestion['title']}")
                print(f"   Path: {suggestion['path']}")
                print(f"   Shared tags: {', '.join(suggestion['shared_tags'])}")
                print()
        else:
            print(f"No suggestions found for: {notes[note_key]['title']}")
            print("(Note may already be well-connected or have no shared tags with other notes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
