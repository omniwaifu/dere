import asyncio
import sys
import types

import pytest

if "claude_agent_sdk" not in sys.modules:
    dummy_module = types.ModuleType("claude_agent_sdk")

    class _PlaceholderAssistantMessage:  # pragma: no cover - placeholder for imports
        content: list[str] = []

    class _PlaceholderSystemMessage:  # pragma: no cover - placeholder for imports
        subtype: str | None = None
        session_id: str | None = None

    dummy_module.ClaudeAgentOptions = object
    dummy_module.ClaudeSDKClient = object
    dummy_module.AssistantMessage = _PlaceholderAssistantMessage
    dummy_module.SystemMessage = _PlaceholderSystemMessage
    sys.modules["claude_agent_sdk"] = dummy_module

from dere_discord.config import DiscordBotConfig
from dere_discord.persona import PersonaService
from dere_discord.session import SessionManager


class DummyDaemon:
    def __init__(self):
        self.created: list[tuple[str, str]] = []
        self.captured: list[dict] = []
        self.ended: list[dict] = []
        self.claude_session_updates: list[tuple[int, str]] = []

    async def create_session(self, working_dir: str, personality: str) -> int:
        self.created.append((working_dir, personality))
        return 42

    async def find_or_create_session(
        self, working_dir: str, personality: str, max_age_hours: int | None = None
    ) -> tuple[int, bool, str | None]:
        self.created.append((working_dir, personality))
        return (42, False, None)

    async def update_claude_session_id(self, session_id: int, claude_session_id: str) -> None:
        self.claude_session_updates.append((session_id, claude_session_id))

    async def capture_message(self, payload: dict) -> None:
        self.captured.append(payload)

    async def end_session(self, payload: dict) -> dict:
        self.ended.append(payload)
        return {"status": "queued"}


class DummyClient:
    def __init__(self, options):
        self.options = options

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def query(self, content: str) -> None:  # pragma: no cover - unused in tests
        self.last_prompt = content

    async def receive_response(self):  # pragma: no cover - stub for interface
        if False:
            yield None


class DummyOptions:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


@pytest.mark.asyncio
async def test_session_lifecycle(monkeypatch):
    config = DiscordBotConfig(
        token="test",
        default_personas=("tsun",),
        allowed_guilds=frozenset(),
        allowed_channels=frozenset(),
        idle_timeout_seconds=0,
        summary_grace_seconds=0,
        context_enabled=True,
    )

    persona_service = PersonaService(("tsun",))
    daemon = DummyDaemon()

    monkeypatch.setattr("dere_discord.session.ClaudeAgentOptions", DummyOptions)
    monkeypatch.setattr("dere_discord.session.ClaudeSDKClient", DummyClient)

    sessions = SessionManager(config, daemon, persona_service)

    session = await sessions.ensure_session(guild_id=None, channel_id=123, user_id=999)
    assert session.session_id == 42
    assert daemon.created == [("discord://dm/999", "tsun")]

    await sessions.capture_message(session, content="hello", role="user")
    assert daemon.captured[-1]["prompt"] == "hello"

    await sessions.schedule_summary(session, delay_seconds=0)
    await asyncio.sleep(0)

    assert daemon.ended[-1]["exit_reason"] == "idle_timeout"
    assert sessions.get_session(guild_id=None, channel_id=123) is None


@pytest.mark.asyncio
async def test_persona_override_resets_session(monkeypatch):
    config = DiscordBotConfig(
        token="test",
        default_personas=("tsun",),
        allowed_guilds=frozenset(),
        allowed_channels=frozenset(),
        idle_timeout_seconds=10,
        summary_grace_seconds=0,
        context_enabled=True,
    )

    persona_service = PersonaService(("tsun",))
    daemon = DummyDaemon()

    monkeypatch.setattr("dere_discord.session.ClaudeAgentOptions", DummyOptions)
    monkeypatch.setattr("dere_discord.session.ClaudeSDKClient", DummyClient)

    sessions = SessionManager(config, daemon, persona_service)

    session = await sessions.ensure_session(guild_id=1, channel_id=1, user_id=2)
    assert session.personas == ("tsun",)

    await sessions.set_personas(guild_id=1, channel_id=1, personas=("kuu",))
    assert sessions.get_personas(guild_id=1, channel_id=1) == ("kuu",)

    new_session = await sessions.ensure_session(guild_id=1, channel_id=1, user_id=2)
    assert new_session is not session
    assert new_session.personas == ("kuu",)
