"""Configuration for dere_ambient service."""

from __future__ import annotations

from dataclasses import dataclass

from dere_shared.config import load_dere_config


@dataclass
class AmbientConfig:
    """Configuration for ambient monitoring service."""

    enabled: bool = True
    check_interval_minutes: int = 30  # Deprecated: use FSM intervals instead
    idle_threshold_minutes: int = 60
    activity_lookback_hours: int = 6
    embedding_search_limit: int = 20
    context_change_threshold: float = 0.7
    daemon_url: str = "http://localhost:8787"
    user_id: str = "default_user"
    personality: str = "tsun"

    escalation_enabled: bool = True
    escalation_lookback_hours: int = 12

    # FSM Configuration
    fsm_enabled: bool = True

    # FSM State Intervals (min, max) in minutes
    fsm_idle_interval: tuple[int, int] = (60, 120)
    fsm_monitoring_interval: tuple[int, int] = (15, 30)
    fsm_engaged_interval: int = 5
    fsm_cooldown_interval: tuple[int, int] = (45, 90)
    fsm_escalating_interval: tuple[int, int] = (30, 60)
    fsm_suppressed_interval: tuple[int, int] = (90, 180)

    # FSM Signal Weights
    fsm_weight_activity: float = 0.3
    fsm_weight_emotion: float = 0.25
    fsm_weight_responsiveness: float = 0.2
    fsm_weight_temporal: float = 0.15
    fsm_weight_task: float = 0.1


def load_ambient_config() -> AmbientConfig:
    """Load ambient configuration from dere config file.

    Returns:
        AmbientConfig with settings from config.toml [ambient] section
    """
    config = load_dere_config()
    ambient_section = config.get("ambient", {})
    default_personality = config.get("default_personality", "tsun")

    return AmbientConfig(
        enabled=ambient_section.get("enabled", True),
        check_interval_minutes=ambient_section.get("check_interval_minutes", 30),
        idle_threshold_minutes=ambient_section.get("idle_threshold_minutes", 60),
        activity_lookback_hours=ambient_section.get("activity_lookback_hours", 6),
        embedding_search_limit=ambient_section.get("embedding_search_limit", 20),
        context_change_threshold=ambient_section.get("context_change_threshold", 0.7),
        daemon_url=ambient_section.get("daemon_url", "http://localhost:8787"),
        user_id=ambient_section.get("user_id") or config.get("user_id", "default_user"),
        personality=ambient_section.get("personality", default_personality),
        escalation_enabled=ambient_section.get("escalation_enabled", True),
        escalation_lookback_hours=ambient_section.get("escalation_lookback_hours", 12),
        # FSM config
        fsm_enabled=ambient_section.get("fsm_enabled", True),
        fsm_idle_interval=tuple(ambient_section.get("fsm_idle_interval", [60, 120])),
        fsm_monitoring_interval=tuple(ambient_section.get("fsm_monitoring_interval", [15, 30])),
        fsm_engaged_interval=ambient_section.get("fsm_engaged_interval", 5),
        fsm_cooldown_interval=tuple(ambient_section.get("fsm_cooldown_interval", [45, 90])),
        fsm_escalating_interval=tuple(ambient_section.get("fsm_escalating_interval", [30, 60])),
        fsm_suppressed_interval=tuple(ambient_section.get("fsm_suppressed_interval", [90, 180])),
        fsm_weight_activity=ambient_section.get("fsm_weight_activity", 0.3),
        fsm_weight_emotion=ambient_section.get("fsm_weight_emotion", 0.25),
        fsm_weight_responsiveness=ambient_section.get("fsm_weight_responsiveness", 0.2),
        fsm_weight_temporal=ambient_section.get("fsm_weight_temporal", 0.15),
        fsm_weight_task=ambient_section.get("fsm_weight_task", 0.1),
    )
