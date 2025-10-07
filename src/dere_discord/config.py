"""Configuration helpers for dere-discord."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable

from dere_shared.config import load_dere_config


class ConfigError(RuntimeError):
    """Raised when dere-discord configuration is invalid."""


def _split_csv(value: str | Iterable[str] | None) -> frozenset[str]:
    """Normalize comma or iterable values into a frozen set of strings."""
    if value is None:
        return frozenset()
    if isinstance(value, str):
        parts = [segment.strip() for segment in value.split(",")]
    else:
        parts = [segment.strip() for segment in value]
    return frozenset(part for part in parts if part)


def _coerce_int(field: str, value: object, default: int) -> int:
    """Parse integer configuration values with helpful errors."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"Invalid integer for {field}: {value!r}") from exc


def _coerce_bool(field: str, value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    raise ConfigError(f"Invalid boolean for {field}: {value!r}")


def _normalize_personas(value: str | Iterable[str] | None, fallback: str) -> tuple[str, ...]:
    """Convert persona configuration into a normalized tuple."""
    if value is None:
        return (fallback,)

    if isinstance(value, str):
        raw = [segment.strip() for segment in value.split(",")]
    else:
        raw = [segment.strip() for segment in value]

    personas = tuple(persona for persona in raw if persona)
    if not personas:
        return (fallback,)
    return personas


@dataclass(slots=True)
class DiscordBotConfig:
    """Resolved Discord bot configuration."""

    token: str
    default_personas: tuple[str, ...]
    allowed_guilds: frozenset[str]
    allowed_channels: frozenset[str]
    idle_timeout_seconds: int
    summary_grace_seconds: int
    context_enabled: bool


def load_discord_config(
    *,
    token_override: str | None = None,
    persona_override: str | None = None,
    allow_guilds: Iterable[str] | None = None,
    allow_channels: Iterable[str] | None = None,
    idle_timeout_override: int | None = None,
    summary_grace_override: int | None = None,
    context_override: bool | None = None,
) -> DiscordBotConfig:
    """Load configuration from TOML/overrides/environment."""

    raw = load_dere_config()
    discord_section = raw.get("discord", {})

    token = token_override or os.getenv("DERE_DISCORD_TOKEN")
    if token is None:
        token = (
            discord_section.get("token")
            or discord_section.get("bot_token")
            or discord_section.get("api_token")
        )
    if token is None:
        raise ConfigError(
            "Discord bot token missing. Provide --token, set DERE_DISCORD_TOKEN, "
            "or add [discord].token to config.toml.",
        )

    default_personas = _normalize_personas(
        persona_override
        or os.getenv("DERE_DISCORD_PERSONA")
        or discord_section.get("default_persona")
        or discord_section.get("personas")
        or discord_section.get("persona"),
        fallback="tsun",
    )

    allowed_guilds = _split_csv(
        allow_guilds
        or os.getenv("DERE_DISCORD_ALLOWED_GUILDS")
        or discord_section.get("allowed_guilds"),
    )
    allowed_channels = _split_csv(
        allow_channels
        or os.getenv("DERE_DISCORD_ALLOWED_CHANNELS")
        or discord_section.get("allowed_channels"),
    )

    idle_timeout_seconds = _coerce_int(
        "idle_timeout_seconds",
        idle_timeout_override
        or os.getenv("DERE_DISCORD_IDLE_TIMEOUT")
        or discord_section.get("idle_timeout_seconds"),
        default=1200,
    )

    summary_grace_seconds = _coerce_int(
        "summary_grace_seconds",
        summary_grace_override
        or os.getenv("DERE_DISCORD_SUMMARY_GRACE")
        or discord_section.get("summary_grace_seconds"),
        default=30,
    )

    context_enabled = _coerce_bool(
        "context_enabled",
        context_override
        if context_override is not None
        else os.getenv("DERE_DISCORD_CONTEXT")
        or discord_section.get("context_enabled")
        or discord_section.get("context")
        or True,
    )

    return DiscordBotConfig(
        token=token,
        default_personas=default_personas,
        allowed_guilds=allowed_guilds,
        allowed_channels=allowed_channels,
        idle_timeout_seconds=idle_timeout_seconds,
        summary_grace_seconds=summary_grace_seconds,
        context_enabled=context_enabled,
    )
