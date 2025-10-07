import pytest

from dere_discord.config import ConfigError, load_discord_config


def test_load_config_prefers_cli_over_env(monkeypatch):
    monkeypatch.setenv("DERE_DISCORD_TOKEN", "env-token")
    monkeypatch.setattr("dere_discord.config.load_dere_config", lambda: {})

    config = load_discord_config(token_override="cli-token", persona_override="tsun,kuu")

    assert config.token == "cli-token"
    assert config.default_personas == ("tsun", "kuu")
    assert config.allowed_guilds == frozenset()
    assert config.idle_timeout_seconds == 1200
    assert config.context_enabled is True


def test_load_config_reads_env_and_lists(monkeypatch):
    monkeypatch.setattr("dere_discord.config.load_dere_config", lambda: {})
    monkeypatch.setenv("DERE_DISCORD_TOKEN", "env-token")
    monkeypatch.setenv("DERE_DISCORD_ALLOWED_GUILDS", "123,456")
    monkeypatch.setenv("DERE_DISCORD_ALLOWED_CHANNELS", "999")
    monkeypatch.setenv("DERE_DISCORD_IDLE_TIMEOUT", "90")
    monkeypatch.setenv("DERE_DISCORD_SUMMARY_GRACE", "5")
    monkeypatch.setenv("DERE_DISCORD_CONTEXT", "0")

    config = load_discord_config()

    assert config.token == "env-token"
    assert config.default_personas == ("tsun",)
    assert config.allowed_guilds == frozenset({"123", "456"})
    assert config.allowed_channels == frozenset({"999"})
    assert config.idle_timeout_seconds == 90
    assert config.summary_grace_seconds == 5
    assert config.context_enabled is False


def test_missing_token_raises(monkeypatch):
    monkeypatch.setattr("dere_discord.config.load_dere_config", lambda: {})
    monkeypatch.delenv("DERE_DISCORD_TOKEN", raising=False)

    with pytest.raises(ConfigError):
        load_discord_config()
