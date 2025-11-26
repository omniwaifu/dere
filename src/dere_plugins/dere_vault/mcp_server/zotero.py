"""Zotero client wrapper and vault integration."""

from __future__ import annotations

import json
import tomllib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from pyzotero import zotero


@dataclass
class ZoteroConfig:
    """Zotero API configuration."""

    library_id: str
    library_type: str
    api_key: str


@dataclass
class ZoteroItem:
    """Zotero item metadata."""

    key: str
    title: str
    authors: list[str]
    year: int | None
    publication: str | None
    abstract: str | None
    url: str | None
    doi: str | None
    tags: list[str]
    citekey: str | None
    item_type: str

    def format_authors(self) -> str:
        """Format authors as 'Last, First; Last2, First2'."""
        return "; ".join(self.authors)

    def format_filename(self, use_citekey: bool = False) -> str:
        """Generate filename: 'author-title-year.md' or '@citekey.md'."""
        if use_citekey and self.citekey:
            return f"@{self.citekey}.md"

        # First author last name
        first_author = self.authors[0].split(",")[0] if self.authors else "unknown"

        # Clean title (first 50 chars, lowercase, no spaces)
        clean_title = (
            self.title[:50]
            .lower()
            .replace(" ", "-")
            .replace("/", "-")
            .replace(":", "-")
            .replace("(", "")
            .replace(")", "")
            .replace("'", "")
            .replace('"', "")
        )

        # Year
        year_str = str(self.year) if self.year else "nd"

        return f"{first_author.lower()}-{clean_title}-{year_str}.md"


def build_collection_hierarchy(
    client: ZoteroClient,
    collection_path: str,
) -> str:
    """
    Build collection hierarchy from path, creating parents as needed.

    Args:
        client: ZoteroClient instance
        collection_path: Path like "Field/Subfield/Topic"

    Returns:
        Collection key of the leaf collection
    """
    existing = client.get_collections()

    # Check if full path already exists
    path_to_key = {coll["path"]: key for key, coll in existing.items()}
    if collection_path in path_to_key:
        return path_to_key[collection_path]

    # Build hierarchy level by level
    parts = collection_path.split("/")
    parent_key = None

    for i, part in enumerate(parts):
        path_so_far = "/".join(parts[: i + 1])

        if path_so_far in path_to_key:
            # Already exists
            parent_key = path_to_key[path_so_far]
        else:
            # Create this level
            new_key = client.create_collection(part, parent_key)
            path_to_key[path_so_far] = new_key
            parent_key = new_key

    return parent_key  # Return leaf collection key


def load_config() -> ZoteroConfig:
    """Load Zotero configuration from config file."""
    config_path = Path.home() / ".config" / "dere" / "config.toml"

    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found: {config_path}\n\n"
            "Create config file with:\n"
            "[zotero]\n"
            'library_id = "12345"\n'
            'library_type = "user"\n'
            'api_key = "generate_at_zotero_org_settings_keys"\n\n'
            "Generate API key at: https://www.zotero.org/settings/keys"
        )

    with config_path.open("rb") as f:
        config = tomllib.load(f)

    if "zotero" not in config:
        raise ValueError(
            "Error: [zotero] section missing in config.toml\n\n"
            "Add to config file:\n"
            "[zotero]\n"
            'library_id = "12345"\n'
            'library_type = "user"\n'
            'api_key = "generate_at_zotero_org_settings_keys"'
        )

    zotero_config = config["zotero"]
    required_fields = ["library_id", "library_type", "api_key"]
    missing = [f for f in required_fields if f not in zotero_config]

    if missing:
        raise ValueError(f"Missing required fields in [zotero] config: {', '.join(missing)}")

    return ZoteroConfig(
        library_id=zotero_config["library_id"],
        library_type=zotero_config["library_type"],
        api_key=zotero_config["api_key"],
    )


class ZoteroClient:
    """Zotero Web API client."""

    def __init__(self, config: ZoteroConfig):
        self.zot = zotero.Zotero(config.library_id, config.library_type, config.api_key)

    def search_items(
        self,
        query: str,
        search_type: str = "title",
    ) -> list[ZoteroItem]:
        """Search for items by title, author, URL, or citekey."""
        # Search using full-text query
        items = self.zot.items(q=query)

        # Filter and parse results
        matches = []
        for item_data in items:
            data = item_data.get("data", {})

            # Skip attachments, notes, annotations
            if data.get("itemType") in ("attachment", "note", "annotation"):
                continue

            # Apply client-side filtering based on search type
            if search_type == "url":
                item_url = data.get("url", "")
                if item_url != query:
                    continue
            elif search_type == "title":
                item_title = data.get("title", "").lower()
                if query.lower() not in item_title:
                    continue
            elif search_type == "author":
                creators = data.get("creators", [])
                author_names = [
                    f"{c.get('lastName', '')} {c.get('firstName', '')}".lower() for c in creators
                ]
                if not any(query.lower() in name for name in author_names):
                    continue
            elif search_type == "citekey":
                extra = data.get("extra", "")
                item_citekey = self._extract_citekey(extra)
                if not item_citekey or query.lower() not in item_citekey.lower():
                    continue

            # Parse item
            parsed_item = self._parse_item(item_data)
            if parsed_item:
                matches.append(parsed_item)

        return matches

    def get_item(self, key: str) -> ZoteroItem | None:
        """Get item by key."""
        try:
            item_data = self.zot.item(key)
            return self._parse_item(item_data)
        except Exception:
            return None

    def add_item(
        self,
        title: str,
        url: str | None = None,
        author: str | None = None,
        item_type: str = "webpage",
        abstract: str | None = None,
        date: str | None = None,
    ) -> str:
        """Add new item to Zotero library. Returns item key."""
        # Get template for item type
        template = self.zot.item_template(item_type)

        # Fill in metadata
        template["title"] = title

        if url:
            template["url"] = url

        if abstract:
            template["abstractNote"] = abstract

        if date:
            template["date"] = date

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

            creator_type = "author"
            template["creators"] = [
                {"creatorType": creator_type, "firstName": first, "lastName": last}
            ]

        # Create item via API
        response = self.zot.create_items([template])

        if response.get("successful"):
            item_key = response["successful"]["0"]["key"]
            return item_key
        else:
            raise RuntimeError(f"Failed to create item: {response.get('failed')}")

    def _extract_citekey(self, extra: str) -> str | None:
        """Extract Better BibTeX citekey from extra field."""
        for line in extra.split("\n"):
            if line.startswith("Citation Key:"):
                return line.replace("Citation Key:", "").strip()
        return None

    @staticmethod
    def _generate_citekey(author: str | None, title: str, year: int | None) -> str:
        """Generate citekey following Better BibTeX default pattern [auth][Title][year]."""
        import re
        import unicodedata

        # Stop words to remove from title (Better BibTeX default list)
        stop_words = {
            "a", "an", "the", "and", "or", "but", "for", "nor", "on", "at",
            "to", "from", "by", "of", "in", "with", "as", "against",
        }

        def normalize(s: str) -> str:
            """Remove accents and normalize unicode."""
            return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()

        # [auth] - first author's last name, lowercased, preserving hyphens
        auth_part = ""
        if author:
            # Handle "Last, First" or "First Last" format
            if "," in author:
                auth_part = author.split(",")[0].strip()
            else:
                parts = author.strip().split()
                auth_part = parts[-1] if parts else ""
            auth_part = normalize(auth_part).lower()
            # Keep only letters and hyphens
            auth_part = re.sub(r"[^a-z-]", "", auth_part)

        # [Title] - first 3 significant words, stop words removed
        title_part = ""
        if title:
            # Remove punctuation and split
            clean_title = re.sub(r"[^\w\s]", " ", normalize(title))
            words = clean_title.split()
            # Filter stop words, take first 3, capitalize first letter preserving rest
            significant_words = [w for w in words if w.lower() not in stop_words][:3]
            title_words = [w[0].upper() + w[1:] if w else "" for w in significant_words]
            title_part = "".join(title_words)
            title_part = re.sub(r"[^a-zA-Z0-9]", "", title_part)

        # [year] - 4-digit year or empty
        year_part = str(year) if year else ""

        return f"{auth_part}{title_part}{year_part}"

    def _get_citekey_from_bib(self, item_url: str | None, vault_path: Path | None = None) -> str | None:
        """Extract citekey from library.bib file by URL."""
        if not item_url:
            return None

        # Try vault-relative path first, then fallbacks
        bib_paths = []
        if vault_path:
            bib_paths.append(vault_path / "library.bib")

        bib_paths.extend([
            Path.home() / "vault" / "library.bib",
            Path.cwd() / "library.bib",
        ])

        for bib_path in bib_paths:
            if not bib_path.exists():
                continue

            try:
                content = bib_path.read_text()
                # Simple regex to find @type{citekey, ... howpublished = {url}
                import re
                pattern = r'@\w+\{([^,]+),.*?howpublished\s*=\s*\{([^}]+)\}'
                matches = re.findall(pattern, content, re.DOTALL)

                for citekey, bib_url in matches:
                    # Clean up URL from bib
                    clean_bib_url = bib_url.replace('\\textasciitilde', '~').strip()
                    if clean_bib_url in item_url or item_url in clean_bib_url:
                        return citekey.strip()
            except Exception:
                pass

        return None

    def get_collections(self) -> dict[str, dict]:
        """Get all collections with hierarchy paths."""
        collections = self.zot.collections()

        # Build mapping: key -> collection data with path
        collection_map = {}
        key_to_name = {}
        key_to_parent = {}

        for coll in collections:
            key = coll["key"]
            data = coll.get("data", {})
            name = data.get("name", "")
            parent_key = data.get("parentCollection", False)

            key_to_name[key] = name
            key_to_parent[key] = parent_key

        # Build paths
        def get_path(key: str) -> str:
            parts = []
            current = key
            while current:
                parts.insert(0, key_to_name[current])
                current = key_to_parent.get(current, False)
            return "/".join(parts)

        for key in key_to_name:
            collection_map[key] = {
                "name": key_to_name[key],
                "path": get_path(key),
                "parent": key_to_parent[key],
            }

        return collection_map

    def create_collection(self, name: str, parent_key: str | None = None) -> str:
        """Create collection. Returns collection key."""
        collection_data = {"name": name}

        if parent_key:
            collection_data["parentCollection"] = parent_key

        response = self.zot.create_collections([collection_data])

        if response.get("successful"):
            return response["successful"]["0"]["key"]
        else:
            raise RuntimeError(f"Failed to create collection: {response.get('failed')}")

    def add_to_collection(self, item_key: str, collection_key: str) -> None:
        """Add item to collection."""
        item = self.zot.item(item_key)
        data = item.get("data", {})

        collections = data.get("collections", [])
        if collection_key not in collections:
            collections.append(collection_key)
            data["collections"] = collections
            self.zot.update_item(item)

    def list_unfiled_items(self) -> list[ZoteroItem]:
        """Get items not in any collection."""
        items = self.zot.items()

        unfiled = []
        for item_data in items:
            data = item_data.get("data", {})

            # Skip attachments, notes, annotations
            if data.get("itemType") in ("attachment", "note", "annotation"):
                continue

            # Check if in any collection
            collections = data.get("collections", [])
            if not collections:
                parsed_item = self._parse_item(item_data)
                if parsed_item:
                    unfiled.append(parsed_item)

        return unfiled

    def get_all_tags(self) -> list[str]:
        """Get all tags from library."""
        tags = self.zot.tags()
        if not tags or not isinstance(tags, list):
            return []
        return [tag["tag"] for tag in tags if isinstance(tag, dict) and "tag" in tag]

    def add_tags(self, item_key: str, tag_names: list[str]) -> None:
        """Add tags to item (preserves existing tags)."""
        item = self.zot.item(item_key)
        data = item.get("data", {})

        existing_tags = {tag["tag"] for tag in data.get("tags", [])}
        all_tags = existing_tags | set(tag_names)

        data["tags"] = [{"tag": tag} for tag in all_tags]
        self.zot.update_item(item)

    def update_tags(self, item_key: str, tag_names: list[str]) -> None:
        """Replace all tags on item."""
        item = self.zot.item(item_key)
        data = item.get("data", {})

        data["tags"] = [{"tag": tag} for tag in tag_names]
        self.zot.update_item(item)

    def get_item_collections(self, item_key: str) -> list[str]:
        """Get collection paths for an item."""
        item = self.zot.item(item_key)
        data = item.get("data", {})
        collection_keys = data.get("collections", [])

        if not collection_keys:
            return []

        # Get all collections
        all_collections = self.get_collections()

        # Map keys to paths
        return [all_collections[key]["path"] for key in collection_keys if key in all_collections]

    def _parse_item(self, item_data: dict) -> ZoteroItem:
        """Parse API response into ZoteroItem."""
        data = item_data.get("data", {})
        key = data.get("key", "")

        # Basic fields
        title = data.get("title", "Untitled")
        url = data.get("url")
        doi = data.get("DOI")
        abstract = data.get("abstractNote")
        item_type = data.get("itemType", "")

        # Publication
        publication = data.get("publicationTitle") or data.get("journalAbbreviation")

        # Authors
        creators = data.get("creators", [])
        authors = []
        for creator in creators:
            last_name = creator.get("lastName", "")
            first_name = creator.get("firstName", "")
            if first_name:
                authors.append(f"{last_name}, {first_name}")
            else:
                authors.append(last_name)

        # Year from date field
        date_str = data.get("date", "")
        year = None
        if date_str:
            year_match = date_str.split("-")[0] if "-" in date_str else date_str
            try:
                year = int(year_match)
            except ValueError:
                pass

        # Tags
        tags = [tag.get("tag", "") for tag in data.get("tags", [])]

        # Citekey: extra field -> bib file -> generate from metadata
        extra = data.get("extra", "")
        citekey = self._extract_citekey(extra)
        if not citekey:
            citekey = self._get_citekey_from_bib(url)
        if not citekey:
            first_author = authors[0] if authors else None
            citekey = self._generate_citekey(first_author, title, year)

        return ZoteroItem(
            key=key,
            title=title,
            authors=authors,
            year=year,
            publication=publication,
            abstract=abstract,
            url=url,
            doi=doi,
            tags=tags,
            citekey=citekey,
            item_type=item_type,
        )


class VaultIntegration:
    """Obsidian vault integration for literature notes."""

    def __init__(self, vault_path: Path | None = None, template_dir: Path | None = None):
        self.vault_path = vault_path or self._find_vault()
        if not self.vault_path:
            raise FileNotFoundError("Could not auto-detect vault. Provide vault_path.")

        self.template_dir = (
            template_dir
            or Path(__file__).parent.parent / "skills" / "source" / "tools" / "templates"
        )
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
            raise FileNotFoundError(
                f"Template not found: {default_template}. "
                "Ensure zotlit-default.md.j2 exists in the templates directory."
            )

    def _find_vault(self) -> Path | None:
        """Auto-detect vault directory by checking for .obsidian folder."""
        # Check current directory and parents
        current = Path.cwd().resolve()
        while current != current.parent:
            if (current / ".obsidian").is_dir():
                return current
            current = current.parent

        # Check common vault locations
        candidates = [
            Path.home() / "vault",
            Path.home() / "Vault",
            Path.home() / "Documents" / "vault",
            Path.home() / "Obsidian",
        ]
        for candidate in candidates:
            if candidate.exists() and (candidate / ".obsidian").is_dir():
                return candidate

        return None


    def create_literature_note(
        self,
        item: ZoteroItem,
        use_citekey_naming: bool = False,
        skip_daily_log: bool = False,
        collection_paths: list[str] | None = None,
    ) -> Path:
        """Create literature note from Zotero item.

        Args:
            item: ZoteroItem with metadata
            use_citekey_naming: Use @citekey.md naming
            skip_daily_log: Skip logging to daily note
            collection_paths: List of Zotero collection paths for this item
        """
        # Render template
        template = self.env.get_template("zotlit-default.md.j2")
        content = template.render(
            item=item,
            today=datetime.now().strftime("%Y-%m-%d"),
            collection_paths=collection_paths or [],
        )

        # Generate filename
        filename = item.format_filename(use_citekey=use_citekey_naming)
        note_path = self.vault_path / "Literature" / filename

        # Ensure Literature directory exists
        note_path.parent.mkdir(parents=True, exist_ok=True)

        # Write note
        if note_path.exists():
            raise FileExistsError(f"Note already exists: {note_path}")

        note_path.write_text(content)

        # Log to daily note
        if not skip_daily_log:
            note_title = note_path.stem
            self._log_to_daily_note(note_title)

        return note_path

    def _get_daily_note_config(self) -> dict:
        """Read Obsidian daily notes configuration."""
        config_path = self.vault_path / ".obsidian" / "daily-notes.json"
        if config_path.exists():
            try:
                return json.loads(config_path.read_text())
            except (json.JSONDecodeError, OSError):
                pass

        # Default fallback
        return {"folder": "Daily", "format": "YYYY-MM-DD"}

    def _format_daily_note_path(self, date: datetime) -> Path:
        """Get daily note path based on Obsidian config."""
        config = self._get_daily_note_config()
        folder = config.get("folder", "Daily")
        format_str = config.get("format", "YYYY-MM-DD")

        # Convert moment.js format to Python strftime
        # YYYY -> %Y, MM -> %m, DD -> %d
        python_format = format_str.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")

        relative_path = date.strftime(python_format)
        return self.vault_path / folder / f"{relative_path}.md"

    def _log_to_daily_note(self, note_title: str) -> None:
        """Append link to today's daily note under Reading section."""
        today = datetime.now()
        daily_note_path = self._format_daily_note_path(today)

        # Ensure parent directory exists
        daily_note_path.parent.mkdir(parents=True, exist_ok=True)

        link_text = f"- [[{note_title}]]"

        # Check if already logged (duplicate prevention)
        if daily_note_path.exists():
            content = daily_note_path.read_text()
            if link_text in content:
                return  # Already logged, skip

        # Create or append
        if not daily_note_path.exists():
            date_header = today.strftime("%Y-%m-%d")
            daily_note_path.write_text(f"# {date_header}\n\n## Reading\n{link_text}\n")
        else:
            content = daily_note_path.read_text()
            if "## Reading" not in content:
                content += f"\n## Reading\n{link_text}\n"
            else:
                # Append under existing Reading section
                lines = content.split("\n")
                for i, line in enumerate(lines):
                    if line.startswith("## Reading"):
                        lines.insert(i + 1, link_text)
                        break
                content = "\n".join(lines)
            daily_note_path.write_text(content)
