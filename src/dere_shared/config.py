"""Configuration loading for dere with TOML support."""

from __future__ import annotations

import getpass
import os
from typing import Any, Literal

from pydantic import BaseModel, Field


# UI metadata helpers
def ui_field(
    default: Any = ...,
    *,
    title: str,
    description: str = "",
    ui_type: Literal["toggle", "select", "number", "text", "readonly", "hidden"] = "text",
    ui_group: str = "default",
    ui_order: int = 0,
    options: list[dict[str, str]] | None = None,
    suffix: str = "",
    min_val: float | None = None,
    max_val: float | None = None,
    step: float | None = None,
    **kwargs: Any,
) -> Any:
    """Create a Field with UI metadata."""
    extra: dict[str, Any] = {
        "ui_type": ui_type,
        "ui_group": ui_group,
        "ui_order": ui_order,
    }
    if options:
        extra["options"] = options
    if suffix:
        extra["suffix"] = suffix
    if min_val is not None:
        extra["min"] = min_val
    if max_val is not None:
        extra["max"] = max_val
    if step is not None:
        extra["step"] = step

    return Field(
        default=default,
        title=title,
        description=description,
        json_schema_extra=extra,
        **kwargs,
    )


def ui_field_factory(
    *,
    default_factory: Any,
    title: str,
    description: str = "",
    ui_type: Literal["toggle", "select", "number", "text", "readonly", "hidden"] = "text",
    ui_group: str = "default",
    ui_order: int = 0,
    options: list[dict[str, str]] | None = None,
    suffix: str = "",
    **kwargs: Any,
) -> Any:
    """Create a Field with default_factory and UI metadata."""
    extra: dict[str, Any] = {
        "ui_type": ui_type,
        "ui_group": ui_group,
        "ui_order": ui_order,
    }
    if options:
        extra["options"] = options
    if suffix:
        extra["suffix"] = suffix

    return Field(
        default_factory=default_factory,
        title=title,
        description=description,
        json_schema_extra=extra,
        **kwargs,
    )


PERSONALITY_OPTIONS = [
    {"value": "tsun", "label": "Tsundere"},
    {"value": "dere", "label": "Deredere"},
    {"value": "kuu", "label": "Kuudere"},
    {"value": "yan", "label": "Yandere"},
    {"value": "ero", "label": "Erodere"},
]

PLUGIN_MODE_OPTIONS = [
    {"value": "always", "label": "Always"},
    {"value": "auto", "label": "Auto"},
    {"value": "never", "label": "Never"},
]

NOTIFICATION_METHOD_OPTIONS = [
    {"value": "both", "label": "Both"},
    {"value": "daemon", "label": "Daemon Only"},
    {"value": "notify-send", "label": "System Notify"},
]

UNITS_OPTIONS = [
    {"value": "metric", "label": "Metric (Celsius)"},
    {"value": "imperial", "label": "Imperial (Fahrenheit)"},
]


class UserConfig(BaseModel):
    """User identity configuration."""

    name: str = ui_field_factory(
        default_factory=getpass.getuser,
        title="Display Name",
        description="Your name shown in conversations",
        ui_group="identity",
        ui_order=0,
    )


class ContextConfig(BaseModel):
    """Context gathering configuration."""

    # Core context flags
    time: bool = ui_field(True, title="Time", description="Include current time", ui_type="toggle", ui_group="sources", ui_order=0)
    weather: bool = ui_field(True, title="Weather", description="Include weather info", ui_type="toggle", ui_group="sources", ui_order=1)
    recent_files: bool = ui_field(True, title="Recent Files", description="Show recently modified files", ui_type="toggle", ui_group="sources", ui_order=2)
    knowledge_graph: bool = ui_field(True, title="Knowledge Graph", description="Use knowledge graph context", ui_type="toggle", ui_group="sources", ui_order=3)
    activity: bool = ui_field(True, title="Activity", description="Include ActivityWatch data", ui_type="toggle", ui_group="sources", ui_order=4)
    media_player: bool = ui_field(True, title="Media Player", description="Show currently playing media", ui_type="toggle", ui_group="sources", ui_order=5)
    tasks: bool = ui_field(True, title="Tasks", description="Include Taskwarrior tasks", ui_type="toggle", ui_group="sources", ui_order=6)
    calendar: bool = ui_field(True, title="Calendar", description="Include calendar events", ui_type="toggle", ui_group="sources", ui_order=7)

    # Activity tracking settings
    activity_lookback_minutes: int = ui_field(10, title="Activity Lookback", description="Minutes of activity history", ui_type="number", ui_group="activity", ui_order=0, suffix="min")
    activity_differential_enabled: bool = ui_field(True, title="Differential Mode", description="Use differential lookback between messages", ui_type="toggle", ui_group="activity", ui_order=1)
    activity_min_lookback_minutes: int = ui_field(2, title="Min Lookback", description="Minimum lookback for differential mode", ui_type="number", ui_group="activity", ui_order=2, suffix="min")
    activity_full_lookback_threshold_minutes: int = ui_field(5, title="Full Lookback Threshold", description="Gap threshold to trigger full lookback", ui_type="number", ui_group="activity", ui_order=3, suffix="min")
    activity_max_duration_hours: int = ui_field(6, title="Max Duration", description="Maximum activity duration to show", ui_type="number", ui_group="activity", ui_order=4, suffix="hrs")

    # Recent files settings
    recent_files_timeframe: str = ui_field("1h", title="Recent Files Timeframe", description="How far back to look for files", ui_type="text", ui_group="files", ui_order=0)
    recent_files_base_path: str = ui_field("/mnt/data/Code", title="Base Path", description="Root directory for recent files", ui_type="text", ui_group="files", ui_order=1)
    recent_files_max_depth: int = ui_field(5, title="Max Depth", description="Maximum directory depth", ui_type="number", ui_group="files", ui_order=2)

    # Display settings
    show_inactive_items: bool = ui_field(True, title="Show Inactive", description="Show inactive context items", ui_type="toggle", ui_group="display", ui_order=0)
    format: str = ui_field("concise", title="Format", description="Context output format", ui_type="text", ui_group="display", ui_order=1)
    max_title_length: int = ui_field(50, title="Max Title Length", description="Truncate titles longer than this", ui_type="number", ui_group="display", ui_order=2)
    show_duration_for_short: bool = ui_field(True, title="Show Duration", description="Show duration for short activities", ui_type="toggle", ui_group="display", ui_order=3)

    # Update settings
    update_interval_seconds: int = ui_field(0, title="Update Interval", description="Auto-refresh interval (0 to disable)", ui_type="number", ui_group="updates", ui_order=0, suffix="sec")
    weather_cache_minutes: int = ui_field(10, title="Weather Cache", description="Cache weather data for this long", ui_type="number", ui_group="updates", ui_order=1, suffix="min")


class WeatherConfig(BaseModel):
    """Weather context configuration."""

    enabled: bool = ui_field(False, title="Enable Weather", description="Fetch weather data for context", ui_type="toggle", ui_group="basic", ui_order=0)
    city: str | None = ui_field(None, title="City", description="City name for weather lookup", ui_type="text", ui_group="basic", ui_order=1)
    units: str = ui_field("metric", title="Units", description="Temperature units", ui_type="select", ui_group="basic", ui_order=2, options=UNITS_OPTIONS)


class ActivityWatchConfig(BaseModel):
    """ActivityWatch integration configuration."""

    enabled: bool = ui_field(True, title="Enable ActivityWatch", description="Activity tracking integration", ui_type="toggle", ui_group="basic", ui_order=0)
    url: str = ui_field("http://localhost:5600", title="URL", description="ActivityWatch server URL", ui_type="text", ui_group="basic", ui_order=1)


class AnnouncementsConfig(BaseModel):
    """Personality announcement configuration."""

    messages: list[str] = ui_field_factory(default_factory=list, title="Messages", description="Custom announcement messages", ui_type="hidden", ui_group="basic", ui_order=0)


class DiscordConfig(BaseModel):
    """Discord bot configuration."""

    token: str = ui_field("", title="Token", description="Discord bot token", ui_type="readonly", ui_group="connection", ui_order=0)
    default_persona: str = ui_field("tsun", title="Default Persona", description="Default personality for Discord", ui_type="select", ui_group="basic", ui_order=0, options=PERSONALITY_OPTIONS)
    allowed_guilds: str = ui_field("", title="Allowed Guilds", description="Comma-separated guild IDs", ui_type="text", ui_group="access", ui_order=0)
    allowed_channels: str = ui_field("", title="Allowed Channels", description="Comma-separated channel IDs", ui_type="text", ui_group="access", ui_order=1)
    idle_timeout_seconds: int = ui_field(1200, title="Idle Timeout", description="Session timeout after inactivity", ui_type="number", ui_group="timing", ui_order=0, suffix="sec")
    summary_grace_seconds: int = ui_field(30, title="Summary Grace", description="Grace period before summarizing", ui_type="number", ui_group="timing", ui_order=1, suffix="sec")
    context_enabled: bool = ui_field(True, title="Context Enabled", description="Include context in Discord messages", ui_type="toggle", ui_group="basic", ui_order=1)


class DatabaseConfig(BaseModel):
    """Database configuration."""

    url: str = ui_field("postgresql://postgres:dere@localhost/dere", title="Database URL", description="PostgreSQL connection string", ui_type="readonly", ui_group="connection", ui_order=0)


class DereGraphConfigFlat(BaseModel):
    """DereGraph (knowledge graph) configuration."""

    enabled: bool = ui_field(True, title="Enable Graph", description="Knowledge graph integration", ui_type="toggle", ui_group="basic", ui_order=0)
    falkor_host: str = ui_field("localhost", title="FalkorDB Host", description="FalkorDB server host", ui_type="text", ui_group="connection", ui_order=0)
    falkor_port: int = ui_field(6379, title="FalkorDB Port", description="FalkorDB server port", ui_type="number", ui_group="connection", ui_order=1)
    falkor_database: str = ui_field("dere_graph", title="Database Name", description="FalkorDB database name", ui_type="text", ui_group="connection", ui_order=2)
    claude_model: str = ui_field("claude-haiku-4-5", title="Claude Model", description="Model for graph operations", ui_type="text", ui_group="model", ui_order=0)
    embedding_dim: int = ui_field(1536, title="Embedding Dimension", description="Vector embedding dimension", ui_type="number", ui_group="model", ui_order=1)
    enable_reflection: bool = ui_field_factory(
        default_factory=lambda: os.getenv("DERE_ENABLE_REFLECTION", "true").lower() == "true",
        title="Enable Reflection",
        description="Enable graph reflection processing",
        ui_type="toggle",
        ui_group="basic",
        ui_order=1,
    )
    idle_threshold_minutes: int = ui_field(15, title="Idle Threshold", description="Idle time before reflection", ui_type="number", ui_group="timing", ui_order=0, suffix="min")


class AmbientConfig(BaseModel):
    """Ambient monitoring configuration."""

    # Basic toggles
    enabled: bool = ui_field(True, title="Enable Ambient", description="Proactive notifications and check-ins", ui_type="toggle", ui_group="basic", ui_order=0)
    escalation_enabled: bool = ui_field(True, title="Escalation", description="Follow-up on ignored messages", ui_type="toggle", ui_group="basic", ui_order=1)
    fsm_enabled: bool = ui_field(True, title="FSM Mode", description="State machine scheduling", ui_type="toggle", ui_group="basic", ui_order=2)

    # Personality & notification
    personality: str | None = ui_field(None, title="Personality", description="Personality for ambient messages", ui_type="select", ui_group="basic", ui_order=3, options=PERSONALITY_OPTIONS)
    notification_method: str = ui_field("both", title="Notification Method", description="How to send notifications", ui_type="select", ui_group="basic", ui_order=4, options=NOTIFICATION_METHOD_OPTIONS)

    # Timing
    check_interval_minutes: int = ui_field(30, title="Check Interval", description="How often to check for engagement", ui_type="number", ui_group="timing", ui_order=0, suffix="min")
    idle_threshold_minutes: int = ui_field(60, title="Idle Threshold", description="User idle time before engaging", ui_type="number", ui_group="timing", ui_order=1, suffix="min")
    min_notification_interval_minutes: int = ui_field(120, title="Min Notify Interval", description="Minimum time between notifications", ui_type="number", ui_group="timing", ui_order=2, suffix="min")
    startup_delay_seconds: int = ui_field(0, title="Startup Delay", description="Delay before ambient starts", ui_type="number", ui_group="timing", ui_order=3, suffix="sec")

    # Context analysis
    activity_lookback_hours: int = ui_field(6, title="Activity Lookback", description="Hours of activity to analyze", ui_type="number", ui_group="analysis", ui_order=0, suffix="hrs")
    escalation_lookback_hours: int = ui_field(12, title="Escalation Lookback", description="Hours to check for unanswered messages", ui_type="number", ui_group="analysis", ui_order=1, suffix="hrs")
    embedding_search_limit: int = ui_field(20, title="Embedding Limit", description="Max embeddings to search", ui_type="number", ui_group="analysis", ui_order=2)
    context_change_threshold: float = ui_field(0.7, title="Context Threshold", description="Threshold for context change detection", ui_type="number", ui_group="analysis", ui_order=3, min_val=0.0, max_val=1.0, step=0.1)

    # Connection
    daemon_url: str = ui_field("http://localhost:8787", title="Daemon URL", description="Dere daemon API URL", ui_type="text", ui_group="connection", ui_order=0)
    user_id: str | None = ui_field(None, title="User ID", description="Override user ID", ui_type="hidden", ui_group="connection", ui_order=1)

    # FSM intervals
    fsm_idle_interval: list[int] = ui_field_factory(default_factory=lambda: [60, 120], title="Idle Interval", description="Min/max minutes in idle state", ui_type="hidden", ui_group="fsm", ui_order=0)
    fsm_monitoring_interval: list[int] = ui_field_factory(default_factory=lambda: [15, 30], title="Monitoring Interval", description="Min/max minutes in monitoring state", ui_type="hidden", ui_group="fsm", ui_order=1)
    fsm_engaged_interval: int = ui_field(5, title="Engaged Interval", description="Minutes in engaged state", ui_type="hidden", ui_group="fsm", ui_order=2, suffix="min")
    fsm_cooldown_interval: list[int] = ui_field_factory(default_factory=lambda: [45, 90], title="Cooldown Interval", description="Min/max minutes in cooldown state", ui_type="hidden", ui_group="fsm", ui_order=3)
    fsm_escalating_interval: list[int] = ui_field_factory(default_factory=lambda: [30, 60], title="Escalating Interval", description="Min/max minutes in escalating state", ui_type="hidden", ui_group="fsm", ui_order=4)
    fsm_suppressed_interval: list[int] = ui_field_factory(default_factory=lambda: [90, 180], title="Suppressed Interval", description="Min/max minutes in suppressed state", ui_type="hidden", ui_group="fsm", ui_order=5)

    # FSM weights
    fsm_weight_activity: float = ui_field(0.3, title="Activity Weight", description="Weight for activity signal", ui_type="hidden", ui_group="fsm_weights", ui_order=0, min_val=0.0, max_val=1.0, step=0.05)
    fsm_weight_emotion: float = ui_field(0.25, title="Emotion Weight", description="Weight for emotion signal", ui_type="hidden", ui_group="fsm_weights", ui_order=1, min_val=0.0, max_val=1.0, step=0.05)
    fsm_weight_responsiveness: float = ui_field(0.2, title="Responsiveness Weight", description="Weight for responsiveness signal", ui_type="hidden", ui_group="fsm_weights", ui_order=2, min_val=0.0, max_val=1.0, step=0.05)
    fsm_weight_temporal: float = ui_field(0.15, title="Temporal Weight", description="Weight for temporal signal", ui_type="hidden", ui_group="fsm_weights", ui_order=3, min_val=0.0, max_val=1.0, step=0.05)
    fsm_weight_task: float = ui_field(0.1, title="Task Weight", description="Weight for task signal", ui_type="hidden", ui_group="fsm_weights", ui_order=4, min_val=0.0, max_val=1.0, step=0.05)


class PluginModeConfig(BaseModel):
    """Plugin mode configuration."""

    mode: str = ui_field("never", title="Mode", description="Plugin activation mode", ui_type="select", ui_group="basic", ui_order=0, options=PLUGIN_MODE_OPTIONS)
    directories: list[str] = ui_field_factory(default_factory=list, title="Directories", description="Directories for auto mode", ui_type="hidden", ui_group="basic", ui_order=1)


class PluginsConfig(BaseModel):
    """All plugin configurations."""

    dere_core: PluginModeConfig = ui_field_factory(
        default_factory=lambda: PluginModeConfig(mode="always"),
        title="Dere Core",
        description="Core personality features",
        ui_type="hidden",
        ui_group="plugins",
        ui_order=0,
    )
    dere_productivity: PluginModeConfig = ui_field_factory(
        default_factory=PluginModeConfig,
        title="Dere Productivity",
        description="Taskwarrior and calendar integration",
        ui_type="hidden",
        ui_group="plugins",
        ui_order=1,
    )
    dere_code: PluginModeConfig = ui_field_factory(
        default_factory=lambda: PluginModeConfig(mode="auto", directories=["/mnt/data/Code"]),
        title="Dere Code",
        description="Code-related tools and context",
        ui_type="hidden",
        ui_group="plugins",
        ui_order=2,
    )
    dere_vault: PluginModeConfig = ui_field_factory(
        default_factory=PluginModeConfig,
        title="Dere Vault",
        description="Zotero and document management",
        ui_type="hidden",
        ui_group="plugins",
        ui_order=3,
    )


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

    default_personality: str = ui_field("tsun", title="Default Personality", description="Global default personality", ui_type="select", ui_group="global", ui_order=0, options=PERSONALITY_OPTIONS)
    user_id: str = ui_field_factory(default_factory=getpass.getuser, title="User ID", description="System user identifier", ui_type="readonly", ui_group="global", ui_order=1)

    user: UserConfig = Field(default_factory=UserConfig, title="User", description="User identity settings", json_schema_extra={"ui_section": "user", "ui_icon": "User", "ui_order": 0})
    context: ContextConfig = Field(default_factory=ContextConfig, title="Context", description="Context gathering settings", json_schema_extra={"ui_section": "context", "ui_icon": "Layers", "ui_order": 1})
    weather: WeatherConfig = Field(default_factory=WeatherConfig, title="Weather", description="Weather data source", json_schema_extra={"ui_section": "weather", "ui_icon": "Cloud", "ui_order": 2})
    activitywatch: ActivityWatchConfig = Field(default_factory=ActivityWatchConfig, title="ActivityWatch", description="Activity tracking integration", json_schema_extra={"ui_section": "advanced", "ui_icon": "Activity", "ui_order": 5})
    announcements: AnnouncementsConfig = Field(default_factory=AnnouncementsConfig, json_schema_extra={"ui_section": "hidden"})
    discord: DiscordConfig = Field(default_factory=DiscordConfig, title="Discord", description="Discord bot settings", json_schema_extra={"ui_section": "connections", "ui_icon": "Bot", "ui_order": 7})
    database: DatabaseConfig = Field(default_factory=DatabaseConfig, title="Database", description="Database connection", json_schema_extra={"ui_section": "connections", "ui_icon": "Database", "ui_order": 6})
    dere_graph: DereGraphConfigFlat = Field(default_factory=DereGraphConfigFlat, title="Knowledge Graph", description="Knowledge graph settings", json_schema_extra={"ui_section": "advanced", "ui_icon": "Network", "ui_order": 8})
    ambient: AmbientConfig = Field(default_factory=AmbientConfig, title="Ambient", description="Proactive monitoring settings", json_schema_extra={"ui_section": "ambient", "ui_icon": "Bot", "ui_order": 4})
    plugins: PluginsConfig = Field(default_factory=PluginsConfig, title="Plugins", description="Plugin activation modes", json_schema_extra={"ui_section": "plugins", "ui_icon": "Cog", "ui_order": 3})

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


def save_dere_config(updates: dict[str, Any]) -> DereConfigDict:
    """Save configuration updates to ~/.config/dere/config.toml.

    Uses tomlkit to preserve comments and formatting.
    Deep-merges updates with existing config, validates, and writes.

    Args:
        updates: Partial config dict to merge with existing config.

    Returns:
        The validated, saved configuration.

    Raises:
        ValueError: If the merged config fails validation.
    """
    import tomlkit

    config_path = os.path.expanduser("~/.config/dere/config.toml")

    # Load existing TOML (preserves comments) or create new document
    if os.path.exists(config_path):
        with open(config_path) as f:
            doc = tomlkit.load(f)
    else:
        doc = tomlkit.document()
        # Create config directory if needed
        os.makedirs(os.path.dirname(config_path), exist_ok=True)

    # Deep merge updates into document
    def deep_merge(base: tomlkit.TOMLDocument | tomlkit.items.Table, updates: dict[str, Any]) -> None:
        for key, value in updates.items():
            if isinstance(value, dict):
                if key not in base:
                    base[key] = tomlkit.table()
                deep_merge(base[key], value)
            else:
                base[key] = value

    deep_merge(doc, updates)

    # Validate the merged config
    merged_data = dict(doc)
    validated_config = DereConfig(**merged_data)

    # Write back to file
    with open(config_path, "w") as f:
        tomlkit.dump(doc, f)

    return validated_config.to_dict()


def get_config_schema() -> dict[str, Any]:
    """Get the JSON schema for DereConfig with UI metadata."""
    return DereConfig.model_json_schema()
