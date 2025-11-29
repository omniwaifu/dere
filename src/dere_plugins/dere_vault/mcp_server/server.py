"""FastMCP server for Zotero operations."""

from __future__ import annotations

import re
from pathlib import Path

from fastmcp import FastMCP
from youtube_transcript_api import YouTubeTranscriptApi

from .zotero import VaultIntegration, ZoteroClient, build_collection_hierarchy, load_config


def _extract_video_id(url_or_id: str) -> str:
    """Extract YouTube video ID from various URL formats or return as-is if already an ID."""
    # Common YouTube URL patterns
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",  # Raw video ID
    ]
    for pattern in patterns:
        match = re.search(pattern, url_or_id)
        if match:
            return match.group(1)
    raise ValueError(f"Could not extract video ID from: {url_or_id}")

# Create FastMCP server
mcp = FastMCP("Zotero Library Manager")


@mcp.tool()
def search_zotero(query: str, search_type: str = "title") -> list[dict]:
    """
    Search Zotero library.

    Args:
        query: Search query string
        search_type: Type of search - "title", "author", "url", or "citekey"

    Returns:
        List of matching items with metadata
    """
    config = load_config()
    client = ZoteroClient(config)
    items = client.search_items(query, search_type)

    return [
        {
            "key": item.key,
            "title": item.title,
            "authors": item.format_authors(),
            "year": item.year,
            "url": item.url,
            "item_type": item.item_type,
        }
        for item in items
    ]


@mcp.tool()
def add_zotero_item(
    title: str,
    url: str | None = None,
    author: str | None = None,
    item_type: str = "webpage",
    abstract: str | None = None,
    date: str | None = None,
) -> dict:
    """
    Add new item to Zotero library.

    Args:
        title: Item title
        url: Item URL (optional)
        author: Author name in "Last, First" or "First Last" format (optional)
        item_type: Type of item - "webpage", "blogPost", "journalArticle", "book", etc.
        abstract: Item abstract/description (optional)
        date: Publication date in "YYYY-MM-DD" or "YYYY" format (optional)

    Returns:
        Created item info with key
    """
    config = load_config()
    client = ZoteroClient(config)
    item_key = client.add_item(title, url, author, item_type, abstract, date)

    # Fetch created item
    item = client.get_item(item_key)

    return {
        "key": item.key,
        "title": item.title,
        "authors": item.format_authors(),
        "url": item.url,
        "message": f"Successfully created item in Zotero (key: {item_key})",
    }


@mcp.tool()
def create_literature_note(
    item_key: str,
    vault_path: str | None = None,
    use_citekey_naming: bool = True,
) -> dict:
    """
    Create Obsidian literature note from Zotero item.

    Args:
        item_key: Zotero item key
        vault_path: Path to Obsidian vault (auto-detected if not provided)
        use_citekey_naming: Use @citekey.md naming (default: True)

    Returns:
        Info about created note
    """
    import time

    config = load_config()
    client = ZoteroClient(config)

    # Get item from Zotero - retry to get BBT citekey
    item = client.get_item(item_key)
    if not item:
        raise ValueError(f"Item not found: {item_key}")

    # If no citekey, wait for Better BibTeX and refetch
    if not item.citekey:
        time.sleep(5)
        item = client.get_item(item_key)
        if not item:
            raise ValueError(f"Item not found after refetch: {item_key}")

    # Get collection paths
    collection_paths = client.get_item_collections(item_key)

    # Create literature note
    vault = VaultIntegration(vault_path=Path(vault_path) if vault_path else None)
    note_path = vault.create_literature_note(
        item,
        use_citekey_naming=use_citekey_naming,
        collection_paths=collection_paths,
    )

    return {
        "note_path": str(note_path),
        "title": item.title,
        "message": f"Created literature note: {note_path.name}",
    }


@mcp.tool()
def list_collections() -> dict:
    """
    List all Zotero collections with hierarchy paths.

    Returns:
        Dict mapping collection keys to collection info (name, path, parent)
    """
    config = load_config()
    client = ZoteroClient(config)
    return client.get_collections()


@mcp.tool()
def create_collection_hierarchy(collection_path: str) -> dict:
    """
    Create collection hierarchy, building parents as needed.

    Args:
        collection_path: Hierarchical path like "Field/Subfield/Topic"

    Returns:
        Info about created collection
    """
    config = load_config()
    client = ZoteroClient(config)
    collection_key = build_collection_hierarchy(client, collection_path)

    collections = client.get_collections()
    coll_info = collections.get(collection_key, {})

    return {
        "collection_key": collection_key,
        "path": coll_info.get("path", collection_path),
        "message": f"Created collection hierarchy: {collection_path}",
    }


@mcp.tool()
def add_item_to_collection(item_key: str, collection_path: str) -> dict:
    """
    Add item to collection (creates hierarchy if needed).

    Args:
        item_key: Zotero item key
        collection_path: Collection path like "Field/Subfield/Topic"

    Returns:
        Success message
    """
    config = load_config()
    client = ZoteroClient(config)

    # Build/get collection
    collection_key = build_collection_hierarchy(client, collection_path)

    # Add item
    client.add_to_collection(item_key, collection_key)

    return {
        "item_key": item_key,
        "collection_path": collection_path,
        "message": f"Added item to collection: {collection_path}",
    }


@mcp.tool()
def list_all_tags() -> list[str]:
    """
    List all existing tags in library.

    Returns:
        List of tag names
    """
    config = load_config()
    client = ZoteroClient(config)
    return client.get_all_tags()


@mcp.tool()
def add_tags_to_item(item_key: str, tags: list[str]) -> dict:
    """
    Add tags to item (preserves existing tags).

    Args:
        item_key: Zotero item key
        tags: List of tag names to add

    Returns:
        Success message
    """
    config = load_config()
    client = ZoteroClient(config)
    client.add_tags(item_key, tags)

    return {
        "item_key": item_key,
        "tags_added": tags,
        "message": f"Added {len(tags)} tags to item",
    }


@mcp.tool()
def set_item_tags(item_key: str, tags: list[str]) -> dict:
    """
    Replace all tags on item.

    Args:
        item_key: Zotero item key
        tags: List of tag names (replaces all existing)

    Returns:
        Success message
    """
    config = load_config()
    client = ZoteroClient(config)
    client.update_tags(item_key, tags)

    return {
        "item_key": item_key,
        "tags": tags,
        "message": f"Set {len(tags)} tags on item",
    }


@mcp.tool()
def list_unfiled_items() -> list[dict]:
    """
    List items not in any collection.

    Returns:
        List of unfiled items with metadata
    """
    config = load_config()
    client = ZoteroClient(config)
    items = client.list_unfiled_items()

    return [
        {
            "key": item.key,
            "title": item.title,
            "authors": item.format_authors(),
            "year": item.year,
            "abstract": item.abstract,
            "url": item.url,
            "tags": item.tags,
            "item_type": item.item_type,
        }
        for item in items
    ]


@mcp.tool()
def get_youtube_transcript(url_or_video_id: str) -> dict:
    """
    Get transcript from a YouTube video.

    Args:
        url_or_video_id: YouTube URL or video ID

    Returns:
        Dict with video_id and transcript text
    """
    video_id = _extract_video_id(url_or_video_id)
    ytt_api = YouTubeTranscriptApi()
    transcript = ytt_api.fetch(video_id)

    # Join segments into plain text
    text = " ".join(segment.text for segment in transcript)

    return {
        "video_id": video_id,
        "transcript": text,
    }


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
