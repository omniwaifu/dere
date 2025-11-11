"""Configuration for dere_ambient service."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from dere_shared.config import load_dere_config


@dataclass
class AmbientConfig:
    """Configuration for ambient monitoring service."""

    enabled: bool = True
    check_interval_minutes: int = 30
    idle_threshold_minutes: int = 60
    activity_lookback_hours: int = 6
    embedding_search_limit: int = 20
    context_change_threshold: float = 0.7
    notification_method: Literal["notify-send", "daemon", "both"] = "both"
    daemon_url: str = "http://localhost:8787"
    user_id: str = "default_user"


def load_ambient_config() -> AmbientConfig:
    """Load ambient configuration from dere config file.

    Returns:
        AmbientConfig with settings from config.toml [ambient] section
    """
    config = load_dere_config()
    ambient_section = config.get("ambient", {})

    return AmbientConfig(
        enabled=ambient_section.get("enabled", True),
        check_interval_minutes=ambient_section.get("check_interval_minutes", 30),
        idle_threshold_minutes=ambient_section.get("idle_threshold_minutes", 60),
        activity_lookback_hours=ambient_section.get("activity_lookback_hours", 6),
        embedding_search_limit=ambient_section.get("embedding_search_limit", 20),
        context_change_threshold=ambient_section.get("context_change_threshold", 0.7),
        notification_method=ambient_section.get("notification_method", "both"),
        daemon_url=ambient_section.get("daemon_url", "http://localhost:8787"),
        user_id=ambient_section.get("user_id", "default_user"),
    )
