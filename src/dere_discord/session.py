"""Session management bridging Discord and the dere daemon.

Sessions no longer manage ClaudeSDKClient directly - that's handled by the
centralized agent service in the daemon. This module tracks Discord-specific
state and coordinates with the daemon for session management.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from loguru import logger

from .config import DiscordBotConfig
from .daemon import ConversationCapturePayload, DaemonClient
from .paths import format_project_path
from .persona import PersonaProfile, PersonaService

MessageRole = Literal["user", "assistant", "system"]


def _now() -> float:
    return time.monotonic()


@dataclass(slots=True)
class ChannelSession:
    """Discord channel session state.

    This tracks Discord-specific session information. The actual Claude
    agent session is managed by the daemon's CentralizedAgentService.
    """

    key: str
    session_id: int  # Daemon session ID
    daemon_session_id: int | None  # Agent service session ID (may differ)
    personas: tuple[str, ...]
    persona_profile: PersonaProfile
    project_path: str
    created_at: float
    last_activity: float
    summary_task: asyncio.Task | None = None
    user_id: str | None = None
    pending_prompt: str = ""  # Current prompt being processed

    def touch(self) -> None:
        self.last_activity = _now()


class SessionManager:
    """Coordinator for channel-scoped sessions.

    Manages Discord session state and coordinates with the daemon for
    conversation capture and session lifecycle. The actual Claude agent
    interactions happen through the centralized daemon service.
    """

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
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._bot_identity: str | None = None

    def _make_key(self, guild_id: int | None, channel_id: int) -> str:
        return f"{guild_id or 'dm'}:{channel_id}"

    def set_bot_identity(self, identity: str | None) -> None:
        self._bot_identity = identity
        self._persona_service.set_identity(identity)

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

            personas = self._persona_service.default_personas
            profile = self._persona_service.resolve(personas)

            project_path = format_project_path(
                guild_id=guild_id,
                channel_id=channel_id,
                user_id=user_id,
            )
            persona_label = ",".join(profile.names)
            user_id_str = str(user_id) if user_id else None

            session_id, resumed, _ = await self._daemon.find_or_create_session(
                project_path,
                persona_label,
                max_age_hours=self._config.session_expiry_hours,
                user_id=user_id_str,
            )

            if resumed:
                logger.info("Resumed session {} for channel {}", session_id, key)
            else:
                logger.info("Created new session {} for channel {}", session_id, key)

            now = _now()
            session = ChannelSession(
                key=key,
                session_id=session_id,
                daemon_session_id=None,  # Will be set when agent connects
                personas=profile.names,
                persona_profile=profile,
                project_path=project_path,
                created_at=now,
                last_activity=now,
                user_id=user_id_str,
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
            "medium": "discord",
            "user_id": session.user_id,
        }
        await self._daemon.capture_message(payload)
        await self.cancel_summary(session)
        session.touch()

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

        if session.summary_task:
            session.summary_task.cancel()
            try:
                await session.summary_task
            except asyncio.CancelledError:
                pass

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
            except Exception as exc:
                logger.warning("Failed to queue summary for session {}: {}", key, exc)

    async def close_all(self) -> None:
        """Close all active sessions."""

        keys = list(self._sessions.keys())
        for key in keys:
            try:
                await self._close_session(key, reason="shutdown")
            except RuntimeError as exc:
                logger.warning("Failed to close session {} cleanly: {}", key, exc)
