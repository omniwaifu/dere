from __future__ import annotations

import importlib.resources
import tomllib
from pathlib import Path

from dere_shared.models import Personality


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
        # Try direct match first
        try:
            data = (
                importlib.resources.files("dere_shared")
                .joinpath(f"personalities/{name}.toml")
                .read_text()
            )
            return self._parse_toml(data)
        except FileNotFoundError:
            pass

        # Search all embedded personalities by alias
        try:
            personalities_path = importlib.resources.files("dere_shared").joinpath("personalities")
            for file_path in personalities_path.iterdir():
                if file_path.suffix == ".toml":
                    data = file_path.read_text()
                    personality = self._parse_toml(data)
                    if self._matches(personality, name):
                        return personality
        except FileNotFoundError:
            pass

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
        try:
            personalities_path = importlib.resources.files("dere_shared").joinpath("personalities")
            for file_path in personalities_path.iterdir():
                if file_path.suffix == ".toml":
                    personalities.append(file_path.stem)
        except (FileNotFoundError, AttributeError):
            pass

        # User config personalities
        if self.config_dir:
            personalities_dir = self.config_dir / "personalities"
            if personalities_dir.exists():
                for path in personalities_dir.glob("*.toml"):
                    personalities.append(path.stem)

        return sorted(set(personalities))
