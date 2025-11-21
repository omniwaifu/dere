"""Configuration loading for dere with TOML support."""

from __future__ import annotations

import getpass
import os
from typing import Any

from pydantic import BaseModel, Field


class UserConfig(BaseModel):
    """User identity configuration."""

    name: str = Field(default_factory=getpass.getuser)


class ContextConfig(BaseModel):
    """Context gathering configuration."""

    # Core context flags
    time: bool = True
    weather: bool = True
    recent_files: bool = True
    knowledge_graph: bool = True

    # Productivity context flags
    activity: bool = True
    media_player: bool = True
    tasks: bool = True
    calendar: bool = True

    # Activity tracking settings
    activity_lookback_minutes: int = 10
    activity_differential_enabled: bool = True
    activity_min_lookback_minutes: int = 2
    activity_full_lookback_threshold_minutes: int = 5
    activity_max_duration_hours: int = 6

    # Recent files settings
    recent_files_timeframe: str = "1h"
    recent_files_base_path: str = "/mnt/data/Code"
    recent_files_max_depth: int = 5

    # Display settings
    show_inactive_items: bool = True
    format: str = "concise"
    max_title_length: int = 50
    show_duration_for_short: bool = True

    # Update settings
    update_interval_seconds: int = 0
    weather_cache_minutes: int = 10


class WeatherConfig(BaseModel):
    """Weather context configuration."""

    enabled: bool = False
    city: str | None = None
    units: str = "metric"


class ActivityWatchConfig(BaseModel):
    """ActivityWatch integration configuration."""

    enabled: bool = True
    url: str = "http://localhost:5600"


class AnnouncementsConfig(BaseModel):
    """Personality announcement configuration."""

    messages: list[str] = Field(default_factory=list)


class DiscordConfig(BaseModel):
    """Discord bot configuration."""

    token: str = ""
    default_persona: str = "tsun"
    allowed_guilds: str = ""
    allowed_channels: str = ""
    idle_timeout_seconds: int = 1200
    summary_grace_seconds: int = 30
    context_enabled: bool = True


class DatabaseConfig(BaseModel):
    """Database configuration."""

    url: str = "postgresql://postgres:dere@localhost/dere"


class DereGraphConfigFlat(BaseModel):
    """DereGraph (knowledge graph) configuration - flat structure matching daemon usage."""

    enabled: bool = True
    falkor_host: str = "localhost"
    falkor_port: int = 6379
    falkor_database: str = "dere_graph"
    claude_model: str = "claude-haiku-4-5"
    embedding_dim: int = 1536
    enable_reflection: bool = Field(
        default_factory=lambda: os.getenv("DERE_ENABLE_REFLECTION", "true").lower() == "true"
    )
    idle_threshold_minutes: int = 15


class PluginModeConfig(BaseModel):
    """Plugin mode configuration."""

    mode: str = "never"  # "always", "never", or "auto"
    directories: list[str] = Field(default_factory=list)


class PluginsConfig(BaseModel):
    """All plugin configurations."""

    dere_core: PluginModeConfig = Field(default_factory=lambda: PluginModeConfig(mode="always"))
    dere_productivity: PluginModeConfig = Field(default_factory=PluginModeConfig)
    dere_code: PluginModeConfig = Field(
        default_factory=lambda: PluginModeConfig(mode="auto", directories=["/mnt/data/Code"])
    )
    dere_vault: PluginModeConfig = Field(default_factory=PluginModeConfig)


class DereConfigDict(dict):
    """Wrapper that supports both attribute and dict access for backward compatibility."""

    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError:
            raise AttributeError(f"'DereConfigDict' object has no attribute '{name}'")

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value


class DereConfig(BaseModel):
    """Main dere configuration with validation."""

    default_personality: str = "tsun"
    user_id: str = Field(default_factory=getpass.getuser)
    user: UserConfig = Field(default_factory=UserConfig)
    context: ContextConfig = Field(default_factory=ContextConfig)
    weather: WeatherConfig = Field(default_factory=WeatherConfig)
    activitywatch: ActivityWatchConfig = Field(default_factory=ActivityWatchConfig)
    announcements: AnnouncementsConfig = Field(default_factory=AnnouncementsConfig)
    discord: DiscordConfig = Field(default_factory=DiscordConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    dere_graph: DereGraphConfigFlat = Field(default_factory=DereGraphConfigFlat)
    plugins: PluginsConfig = Field(default_factory=PluginsConfig)

    def to_dict(self) -> DereConfigDict:
        """Convert to dict-like object with attribute access for backward compatibility."""
        data = self.model_dump()
        result = DereConfigDict(data)
        # Make nested dicts also support attribute access
        for key, value in result.items():
            if isinstance(value, dict):
                result[key] = DereConfigDict(value)
                # Handle nested dicts
                for nested_key, nested_value in result[key].items():
                    if isinstance(nested_value, dict):
                        result[key][nested_key] = DereConfigDict(nested_value)
        return result


def load_dere_config() -> DereConfigDict:
    """Load dere configuration from ~/.config/dere/config.toml with validation.

    Returns a validated configuration object that supports both dict and attribute access.
    Falls back to defaults if the config file doesn't exist or cannot be parsed.
    """
    # Start with defaults
    config_data = {}

    # Load user config if it exists
    config_path = os.path.expanduser("~/.config/dere/config.toml")
    if os.path.exists(config_path):
        try:
            import tomllib

            with open(config_path, "rb") as f:
                config_data = tomllib.load(f)

        except (ImportError, OSError, ValueError) as e:
            # Log but continue with defaults
            print(f"Warning: Failed to load config from {config_path}: {e}")

    # Validate and merge with defaults using Pydantic
    try:
        validated_config = DereConfig(**config_data)
        return validated_config.to_dict()
    except Exception as e:
        print(f"Warning: Config validation failed: {e}")
        print("Falling back to defaults")
        # Return defaults if validation fails
        return DereConfig().to_dict()


def _parse_simple_toml(content: str) -> dict[str, Any]:
    """Simple TOML parser for basic key=value pairs.

    Fallback parser for Python <3.11 that handles basic TOML syntax.
    Only supports simple key=value pairs within sections.
    """
    config: dict[str, Any] = {"context": {}, "weather": {}}
    current_section: str | None = None

    for line in content.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("[") and line.endswith("]"):
            current_section = line[1:-1]
            continue

        if "=" in line and current_section in config:
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.split("#")[0].strip().strip("\"'")

            match value.lower():
                case "true":
                    parsed_value: Any = True
                case "false":
                    parsed_value = False
                case _ if value.isdigit():
                    parsed_value = int(value)
                case _:
                    parsed_value = value

            config[current_section][key] = parsed_value

    return config
