"""Session management bridging Discord, Claude SDK, and the dere daemon."""

from __future__ import annotations

import asyncio
import json
import tempfile
import time
from collections import defaultdict
from collections.abc import Iterable
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from loguru import logger

from .config import DiscordBotConfig
from .daemon import ConversationCapturePayload, DaemonClient
from .paths import format_project_path
from .persona import PersonaProfile, PersonaService

MessageRole = Literal["user", "assistant", "system"]


def _now() -> float:
    return time.monotonic()


def _ensure_discord_output_style() -> None:
    """Ensure discord output style exists in global Claude folder."""
    import platform

    system = platform.system()
    if system == "Darwin":  # macOS
        claude_dir = Path.home() / "Library" / "Application Support" / "Claude" / "output-styles"
    elif system == "Windows":
        import os

        appdata = os.getenv("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))
        claude_dir = Path(appdata) / "Claude" / "output-styles"
    else:  # Linux/Unix
        claude_dir = Path.home() / ".claude" / "output-styles"

    claude_dir.mkdir(parents=True, exist_ok=True)

    discord_style = claude_dir / "discord.md"
    if not discord_style.exists():
        content = """---
name: Discord Chat
description: Brief conversational responses for Discord
---

# Discord Communication Style

Keep responses SHORT and conversational:
- 1-2 sentences for simple answers
- Brief paragraph for complex topics
- Direct answers only, no preamble
- Don't explain what tools you're using
- Chat style, not technical docs"""
        discord_style.write_text(content)


@dataclass(slots=True)
class ChannelSession:
    """Active Discord conversation bridged to the daemon + Claude SDK."""

    key: str
    session_id: int
    personas: tuple[str, ...]
    persona_profile: PersonaProfile
    project_path: str
    created_at: float
    last_activity: float
    client: ClaudeSDKClient
    exit_stack: AsyncExitStack
    summary_task: asyncio.Task | None = None
    needs_session_id_capture: bool = False
    settings_file: str | None = None

    def touch(self) -> None:
        self.last_activity = _now()

    async def close_client(self) -> None:
        if self.summary_task:
            self.summary_task.cancel()
            self.summary_task = None
        try:
            await self.exit_stack.aclose()
        except RuntimeError as exc:  # pragma: no cover - defensive guard
            logger.warning("Error closing Claude session {}: {}", self.key, exc)
        finally:
            # Clean up temporary settings file
            if self.settings_file:
                try:
                    Path(self.settings_file).unlink(missing_ok=True)
                except Exception as exc:
                    logger.debug("Failed to cleanup settings file {}: {}", self.settings_file, exc)


class SessionManager:
    """Coordinator for channel-scoped sessions."""

    def __init__(
        self,
        config: DiscordBotConfig,
        daemon: DaemonClient,
        persona_service: PersonaService,
    ):
        self._config = config
        self._daemon = daemon
        self._persona_service = persona_service
        self._sessions: dict[str, ChannelSession] = {}
        self._persona_overrides: dict[str, tuple[str, ...]] = {}
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._bot_identity: str | None = None

    def _make_key(self, guild_id: int | None, channel_id: int) -> str:
        return f"{guild_id or 'dm'}:{channel_id}"

    def get_personas(
        self,
        *,
        guild_id: int | None,
        channel_id: int,
    ) -> tuple[str, ...]:
        key = self._make_key(guild_id, channel_id)
        return self._persona_overrides.get(key, self._persona_service.default_personas)

    def set_bot_identity(self, identity: str | None) -> None:
        self._bot_identity = identity
        self._persona_service.set_identity(identity)

    async def set_personas(
        self,
        *,
        guild_id: int | None,
        channel_id: int,
        personas: Iterable[str],
    ) -> tuple[str, ...]:
        key = self._make_key(guild_id, channel_id)
        resolved = tuple(personas)
        if not resolved:
            resolved = self._persona_service.default_personas

        profile = self._persona_service.resolve(resolved)

        self._persona_overrides[key] = profile.names

        # Reset any active session so new persona takes effect immediately
        if key in self._sessions:
            await self._close_session(key, reason="persona_change")

        return profile.names

    async def ensure_session(
        self,
        *,
        guild_id: int | None,
        channel_id: int,
        user_id: int | None = None,
    ) -> ChannelSession:
        """Ensure channel session exists and return it."""

        key = self._make_key(guild_id, channel_id)
        async with self._locks[key]:
            session = self._sessions.get(key)
            if session:
                return session

            personas = self._persona_overrides.get(key, self._persona_service.default_personas)
            profile = self._persona_service.resolve(personas)

            project_path = format_project_path(
                guild_id=guild_id,
                channel_id=channel_id,
                user_id=user_id,
            )
            persona_label = ",".join(profile.names)
            session_id, resumed, claude_session_id = await self._daemon.find_or_create_session(
                project_path, persona_label, max_age_hours=self._config.session_expiry_hours
            )

            if resumed and claude_session_id:
                logger.info(
                    "Resumed session {} (Claude session: {}) for channel {}",
                    session_id,
                    claude_session_id,
                    key,
                )
            elif resumed:
                logger.info(
                    "Resumed session {} for channel {} (no Claude session yet)", session_id, key
                )
            else:
                logger.info("Created new session {} for channel {}", session_id, key)

            # Ensure discord output style exists
            _ensure_discord_output_style()

            # Create temporary settings file with output style
            # Using settings file with setting_sources to enable output styles
            settings_data = {"outputStyle": "discord"}
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                json.dump(settings_data, f)
                settings_path = f.name

            options = ClaudeAgentOptions(
                settings=settings_path,
                setting_sources=["user", "project", "local"],  # Required for settings to work
                system_prompt={"type": "preset", "append": profile.prompt or ""},
                allowed_tools=["Read", "Write", "Bash"],
                permission_mode="acceptEdits",
                resume=claude_session_id,  # Resume Claude SDK session if available
            )

            exit_stack = AsyncExitStack()
            client = ClaudeSDKClient(options=options)
            await exit_stack.enter_async_context(client)

            now = _now()
            session = ChannelSession(
                key=key,
                session_id=session_id,
                personas=profile.names,
                persona_profile=profile,
                project_path=project_path,
                created_at=now,
                last_activity=now,
                client=client,
                exit_stack=exit_stack,
                needs_session_id_capture=(claude_session_id is None),
                settings_file=settings_path,
            )
            self._sessions[key] = session
            return session

    def get_session(
        self,
        *,
        guild_id: int | None,
        channel_id: int,
    ) -> ChannelSession | None:
        """Return the active session if one exists."""

        key = self._make_key(guild_id, channel_id)
        return self._sessions.get(key)

    async def capture_message(
        self,
        session: ChannelSession,
        *,
        content: str,
        role: MessageRole,
    ) -> None:
        """Capture a message to the daemon and update activity timestamp."""

        payload: ConversationCapturePayload = {
            "session_id": session.session_id,
            "personality": ",".join(session.personas),
            "project_path": session.project_path,
            "prompt": content,
            "message_type": role,
            "is_command": False,
            "exit_code": 0,
        }
        await self._daemon.capture_message(payload)
        await self.cancel_summary(session)
        session.touch()

    async def capture_claude_session_id(
        self,
        session: ChannelSession,
        claude_session_id: str,
    ) -> None:
        """Capture and store the Claude SDK session ID."""

        if not session.needs_session_id_capture:
            return

        await self._daemon.update_claude_session_id(session.session_id, claude_session_id)
        session.needs_session_id_capture = False
        logger.info(
            "Captured Claude session ID {} for daemon session {}",
            claude_session_id,
            session.session_id,
        )

    async def schedule_summary(
        self,
        session: ChannelSession,
        *,
        delay_seconds: int | None = None,
    ) -> None:
        """Schedule summary for a channel session if idle."""

        if session.summary_task and not session.summary_task.done():
            return

        if delay_seconds is not None:
            delay = delay_seconds
        else:
            delay = self._config.idle_timeout_seconds + self._config.summary_grace_seconds

        async def _request_summary() -> None:
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return

            duration = int(max(0, _now() - session.created_at))
            await self._daemon.end_session(
                {
                    "session_id": session.session_id,
                    "exit_reason": "idle_timeout",
                    "duration_seconds": duration,
                }
            )
            await self._close_session(session.key, reason="idle_timeout", queue_summary=False)

        session.summary_task = asyncio.create_task(
            _request_summary(), name=f"dere-summary-{session.key}"
        )

    async def cancel_summary(self, session: ChannelSession) -> None:
        """Cancel scheduled summary task if it exists."""

        if session.summary_task and not session.summary_task.done():
            session.summary_task.cancel()
            try:
                await session.summary_task
            except asyncio.CancelledError:
                pass
        session.summary_task = None

    async def close_session(
        self,
        *,
        guild_id: int | None,
        channel_id: int,
        reason: str = "manual",
    ) -> None:
        key = self._make_key(guild_id, channel_id)
        async with self._locks[key]:
            await self._close_session(key, reason=reason)

    async def _close_session(self, key: str, *, reason: str, queue_summary: bool = True) -> None:
        session = self._sessions.pop(key, None)
        if not session:
            return

        if queue_summary:
            duration = int(max(0, _now() - session.created_at))
            try:
                await self._daemon.end_session(
                    {
                        "session_id": session.session_id,
                        "exit_reason": reason,
                        "duration_seconds": duration,
                    }
                )
            except Exception as exc:  # pragma: no cover - log unexpected daemon failures
                logger.warning("Failed to queue summary for session {}: {}", key, exc)

        await session.close_client()

    async def close_all(self) -> None:
        """Close all active sessions."""

        keys = list(self._sessions.keys())
        for key in keys:
            try:
                await self._close_session(key, reason="shutdown")
            except RuntimeError as exc:  # pragma: no cover - defensive guard
                logger.warning("Failed to close session {} cleanly: {}", key, exc)
