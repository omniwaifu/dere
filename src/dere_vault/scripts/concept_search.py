#!/usr/bin/env python3
"""Search permanent notes for similar concepts to prevent duplicates."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    from .detect_vault import find_vault_root
except ImportError:
    from detect_vault import find_vault_root


def normalize_text(text: str) -> str:
    """Normalize text for comparison."""
    return text.lower().strip()


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


def calculate_similarity(query: str, note_title: str, note_tags: list[str], note_content: str) -> float:
    """Calculate similarity score between query and note (0.0-1.0)."""
    query_norm = normalize_text(query)
    title_norm = normalize_text(note_title)
    content_norm = normalize_text(note_content)

    score = 0.0

    # Exact title match
    if query_norm == title_norm:
        score += 1.0
    # Title contains query
    elif query_norm in title_norm:
        score += 0.7
    # Query contains title words
    elif any(word in query_norm for word in title_norm.split() if len(word) > 3):
        score += 0.5

    # Tag overlap
    query_words = set(query_norm.split())
    tag_words = set(" ".join(note_tags).lower().split())
    if query_words & tag_words:
        score += 0.3

    # Content contains query
    if query_norm in content_norm:
        score += 0.2

    return min(score, 1.0)


def search_concepts(vault_path: Path, query: str, threshold: float = 0.3) -> list[dict]:
    """Search for similar concepts in permanent notes."""
    results = []

    # Search all markdown files
    for note_path in vault_path.rglob("*.md"):
        try:
            content = note_path.read_text(encoding="utf-8")
        except Exception:
            continue

        # Only process permanent notes
        if not is_permanent_note(content):
            continue

        title = extract_title(content)
        if not title:
            continue

        tags = extract_frontmatter_tags(content)

        # Calculate similarity
        similarity = calculate_similarity(query, title, tags, content)

        if similarity >= threshold:
            results.append({
                "path": note_path.relative_to(vault_path),
                "title": title,
                "tags": tags,
                "similarity": similarity,
            })

    # Sort by similarity (descending)
    results.sort(key=lambda x: x["similarity"], reverse=True)

    return results


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Search permanent notes for similar concepts")
    parser.add_argument("query", help="Concept to search for")
    parser.add_argument("--threshold", type=float, default=0.3, help="Minimum similarity score (0.0-1.0)")
    parser.add_argument("--vault-path", type=Path, help="Path to vault (auto-detected if not provided)")
    parser.add_argument("--limit", type=int, default=10, help="Maximum number of results")

    args = parser.parse_args()

    # Find vault
    vault_path = args.vault_path
    if not vault_path:
        vault_path = find_vault_root()
        if not vault_path:
            print("Error: Could not find vault. Specify --vault-path", file=sys.stderr)
            return 1

    # Search
    results = search_concepts(vault_path, args.query, args.threshold)

    if not results:
        print(f"No similar concepts found for: {args.query}")
        return 0

    # Display results
    print(f"Found {len(results)} similar concept(s) for: {args.query}\n")

    for i, result in enumerate(results[:args.limit], 1):
        print(f"{i}. {result['title']} (similarity: {result['similarity']:.2f})")
        print(f"   Path: {result['path']}")
        if result['tags']:
            print(f"   Tags: {', '.join(result['tags'])}")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
