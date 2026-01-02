from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

import tomlkit

from dere_shared.models import Personality


class PersonalitySource(str, Enum):
    """Source of a personality"""

    EMBEDDED = "embedded"  # Only exists in embedded resources
    USER = "user"  # Only exists in user config (custom)
    OVERRIDE = "override"  # User config overrides embedded


@dataclass
class PersonalityInfo:
    """Personality with source metadata for listing"""

    name: str
    short_name: str
    color: str
    icon: str
    source: PersonalitySource
    has_embedded: bool  # Whether an embedded version exists


class PersonalityLoader:
    """Load personalities from TOML files (embedded or user config)"""

    def __init__(self, config_dir: Path | None = None):
        self.config_dir = config_dir
        self._cache: dict[str, Personality] = {}

    def load(self, name_or_alias: str) -> Personality:
        """Load a personality by name or alias"""
        normalized = name_or_alias.lower()

        # Check cache
        if normalized in self._cache:
            return self._cache[normalized]

        # Try user config first
        if self.config_dir:
            personality = self._load_from_user_config(normalized)
            if personality:
                self._cache[normalized] = personality
                return personality

        # Fall back to embedded
        personality = self._load_from_embedded(normalized)
        if not personality:
            raise ValueError(f"Personality '{name_or_alias}' not found")

        self._cache[normalized] = personality
        return personality

    def _load_from_user_config(self, name: str) -> Personality | None:
        """Load personality from user config directory"""
        if not self.config_dir:
            return None

        personalities_dir = self.config_dir / "personalities"
        personality_path = personalities_dir / f"{name}.toml"

        if not personality_path.exists():
            return None

        return self._parse_toml(personality_path.read_text())

    def _load_from_embedded(self, name: str) -> Personality | None:
        """Load personality from embedded resources"""
        personalities_dir = self._embedded_dir()
        personality_path = personalities_dir / f"{name}.toml"
        if personality_path.exists():
            return self._parse_toml(personality_path.read_text())

        # Search all embedded personalities by alias
        if personalities_dir.exists():
            for file_path in personalities_dir.iterdir():
                if file_path.is_file() and file_path.name.endswith(".toml"):
                    data = file_path.read_text()
                    personality = self._parse_toml(data)
                    if self._matches(personality, name):
                        return personality

        return None

    def _parse_toml(self, data: str) -> Personality:
        """Parse TOML data into Personality model"""
        parsed = tomllib.loads(data)

        metadata = parsed.get("metadata", {})
        display = parsed.get("display", {})
        prompt = parsed.get("prompt", {})
        occ = parsed.get("occ", {})

        return Personality(
            name=metadata.get("name", ""),
            short_name=metadata.get("short_name", ""),
            aliases=metadata.get("aliases", []),
            color=display.get("color", "white"),
            icon=display.get("icon", "●"),
            avatar=display.get("avatar"),
            prompt_content=prompt.get("content", ""),
            announcement=display.get("announcement"),
            occ_goals=occ.get("goals", []),
            occ_standards=occ.get("standards", []),
            occ_attitudes=occ.get("attitudes", []),
        )

    def _matches(self, personality: Personality, name: str) -> bool:
        """Check if personality matches the given name"""
        normalized = name.lower()

        if personality.name.lower() == normalized:
            return True
        if personality.short_name.lower() == normalized:
            return True

        return any(alias.lower() == normalized for alias in personality.aliases)

    def list_available(self) -> list[str]:
        """List all available personality names"""
        personalities = []

        # Embedded personalities
        personalities_path = self._embedded_dir()
        if personalities_path.exists():
            for file_path in personalities_path.iterdir():
                if file_path.is_file() and file_path.name.endswith(".toml"):
                    personalities.append(file_path.name.removesuffix(".toml"))

        # User config personalities
        if self.config_dir:
            personalities_dir = self.config_dir / "personalities"
            if personalities_dir.exists():
                for path in personalities_dir.glob("*.toml"):
                    personalities.append(path.stem)

        return sorted(set(personalities))

    def list_all_with_source(self) -> list[PersonalityInfo]:
        """List all personalities with their source indicator"""
        embedded_names = self._get_embedded_names()
        user_names = self._get_user_config_names()

        result: list[PersonalityInfo] = []

        # Process all unique names
        all_names = embedded_names | user_names

        for name in sorted(all_names):
            in_embedded = name in embedded_names
            in_user = name in user_names

            if in_user and in_embedded:
                source = PersonalitySource.OVERRIDE
            elif in_user:
                source = PersonalitySource.USER
            else:
                source = PersonalitySource.EMBEDDED

            # Load the personality to get display info
            personality = self.load(name)
            result.append(
                PersonalityInfo(
                    name=personality.name,
                    short_name=personality.short_name,
                    color=personality.color,
                    icon=personality.icon,
                    source=source,
                    has_embedded=in_embedded,
                )
            )

        return result

    def _get_embedded_names(self) -> set[str]:
        """Get all embedded personality names"""
        names: set[str] = set()
        personalities_path = self._embedded_dir()
        if personalities_path.exists():
            for file_path in personalities_path.iterdir():
                if file_path.is_file() and file_path.name.endswith(".toml"):
                    names.add(file_path.name.removesuffix(".toml"))
        return names

    def _get_user_config_names(self) -> set[str]:
        """Get all user config personality names"""
        names: set[str] = set()
        if self.config_dir:
            personalities_dir = self.config_dir / "personalities"
            if personalities_dir.exists():
                for path in personalities_dir.glob("*.toml"):
                    names.add(path.stem)
        return names

    def is_user_override(self, name: str) -> bool:
        """Check if a user config override exists for this personality"""
        if not self.config_dir:
            return False
        personality_path = self.config_dir / "personalities" / f"{name.lower()}.toml"
        return personality_path.exists()

    def get_full(self, name: str) -> dict[str, Any]:
        """Get the full personality data as a dict (for editing)"""
        normalized = name.lower()

        # Try user config first
        if self.config_dir:
            personality_path = self.config_dir / "personalities" / f"{normalized}.toml"
            if personality_path.exists():
                return tomllib.loads(personality_path.read_text())

        # Fall back to embedded
        personalities_dir = self._embedded_dir()
        personality_path = personalities_dir / f"{normalized}.toml"
        if personality_path.exists():
            return tomllib.loads(personality_path.read_text())

        # Search embedded by alias
        if personalities_dir.exists():
            for file_path in personalities_dir.iterdir():
                if file_path.is_file() and file_path.name.endswith(".toml"):
                    data = file_path.read_text()
                    parsed = tomllib.loads(data)
                    personality = self._parse_toml(data)
                    if self._matches(personality, normalized):
                        return parsed

        raise ValueError(f"Personality '{name}' not found")

    def _embedded_dir(self) -> Path:
        env_dir = os.getenv("DERE_EMBEDDED_PERSONALITIES_DIR")
        if env_dir:
            return Path(env_dir)
        repo_root = Path(__file__).resolve().parents[2]
        return repo_root / "packages" / "shared-assets" / "personalities"

    def save_to_user_config(self, name: str, data: dict[str, Any]) -> None:
        """Save personality to user config directory"""
        if not self.config_dir:
            raise ValueError("No config directory configured")

        personalities_dir = self.config_dir / "personalities"
        personalities_dir.mkdir(parents=True, exist_ok=True)

        personality_path = personalities_dir / f"{name.lower()}.toml"

        # Build TOML document
        doc = tomlkit.document()

        # Metadata section
        metadata = tomlkit.table()
        metadata["name"] = data.get("metadata", {}).get("name", name)
        metadata["short_name"] = data.get("metadata", {}).get("short_name", name)
        if aliases := data.get("metadata", {}).get("aliases", []):
            metadata["aliases"] = aliases
        doc["metadata"] = metadata

        # Display section
        display = tomlkit.table()
        display_data = data.get("display", {})
        display["color"] = display_data.get("color", "white")
        display["icon"] = display_data.get("icon", "●")
        if avatar := display_data.get("avatar"):
            display["avatar"] = avatar
        if announcement := display_data.get("announcement"):
            display["announcement"] = announcement
        doc["display"] = display

        # Prompt section
        prompt = tomlkit.table()
        prompt_content = data.get("prompt", {}).get("content", "")
        # Use multiline string for prompt content
        prompt["content"] = tomlkit.string(prompt_content, multiline=True)
        doc["prompt"] = prompt

        personality_path.write_text(tomlkit.dumps(doc))

        # Clear cache for this personality
        normalized = name.lower()
        if normalized in self._cache:
            del self._cache[normalized]

    def delete_from_user_config(self, name: str) -> bool:
        """Delete user config personality file. Returns True if deleted, False if not found."""
        if not self.config_dir:
            return False

        personality_path = self.config_dir / "personalities" / f"{name.lower()}.toml"
        if not personality_path.exists():
            return False

        personality_path.unlink()

        # Clear cache for this personality
        normalized = name.lower()
        if normalized in self._cache:
            del self._cache[normalized]

        return True
