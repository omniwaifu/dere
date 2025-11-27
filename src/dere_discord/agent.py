"""Claude Agent integration for Discord messaging via centralized daemon."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable

from loguru import logger

from dere_shared.agent_models import SessionConfig, StreamEventType

from .daemon_agent import DaemonAgentClient
from .persona import PersonaProfile
from .session import SessionManager


class DiscordAgent:
    """Bridge Discord messages to Claude via the centralized daemon agent."""

    def __init__(
        self,
        sessions: SessionManager,
        daemon_client: DaemonAgentClient,
        *,
        context_enabled: bool = True,
    ):
        self._sessions = sessions
        self._daemon = daemon_client
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._context_enabled = context_enabled

    async def _stream_response(
        self,
        session,
        send_text_message: Callable,
        send_tool_summary: Callable,
    ) -> tuple[bool, list[str], list[str], list[str]]:
        """Stream response from daemon and handle text/tool blocks."""
        pre_tool_chunks: list[str] = []
        post_tool_chunks: list[str] = []
        tool_events: list[str] = []
        tool_seen = False

        try:
            async for event in self._daemon.query(session.pending_prompt):
                if event.type == StreamEventType.TEXT:
                    text = event.data.get("text", "")
                    if text:
                        if tool_seen:
                            post_tool_chunks.append(text)
                        else:
                            pre_tool_chunks.append(text)

                elif event.type == StreamEventType.THINKING:
                    text = event.data.get("text", "")
                    if text:
                        if tool_seen:
                            post_tool_chunks.append(text)
                        else:
                            pre_tool_chunks.append(text)

                elif event.type == StreamEventType.TOOL_USE:
                    if not tool_seen:
                        tool_seen = True
                        initial_text = "".join(pre_tool_chunks).strip()
                        if initial_text:
                            await send_text_message(initial_text, session.persona_profile)
                            await self._sessions.capture_message(
                                session, content=initial_text, role="assistant"
                            )
                        pre_tool_chunks.clear()

                    name = event.data.get("name", "unknown")
                    tool_input = event.data.get("input", {})
                    preview = self._preview(tool_input)
                    tool_events.append(f"Running `{name}`: {preview}")

                elif event.type == StreamEventType.TOOL_RESULT:
                    output = event.data.get("output", "")
                    is_error = event.data.get("is_error", False)
                    formatted = self._preview(output, limit=400)
                    if is_error:
                        tool_events.append(f"Tool failed\n{formatted}".strip())
                    else:
                        tool_events.append(f"Tool completed\n{formatted}".strip())

                elif event.type == StreamEventType.ERROR:
                    msg = event.data.get("message", "Unknown error")
                    logger.error("Agent error: {}", msg)
                    if not event.data.get("recoverable", True):
                        break

                elif event.type == StreamEventType.DONE:
                    break

        except Exception:
            logger.exception("Failed while streaming response")
            raise

        return tool_seen, pre_tool_chunks, post_tool_chunks, tool_events

    async def _finalize_response(
        self,
        session,
        tool_seen: bool,
        pre_tool_chunks: list[str],
        post_tool_chunks: list[str],
        tool_events: list[str],
        send_text_message: Callable,
        send_tool_summary: Callable,
    ) -> None:
        """Finalize response by sending remaining text and tool summaries."""
        persona_profile = session.persona_profile

        if not tool_seen:
            response_text = "".join(pre_tool_chunks).strip()
            await send_text_message(response_text, persona_profile)
            if response_text:
                await self._sessions.capture_message(
                    session, content=response_text, role="assistant"
                )
        else:
            final_text = "".join(post_tool_chunks).strip()

            if tool_events:
                await send_tool_summary(tool_events, persona_profile)

            if final_text:
                await send_text_message(final_text, persona_profile)
                await self._sessions.capture_message(
                    session, content=final_text, role="assistant"
                )

        await self._sessions.schedule_summary(session)

    async def handle_message(
        self,
        *,
        guild_id: int | None,
        channel_id: int,
        user_id: int | None,
        content: str,
        send_initial: Callable[[], Awaitable[None]],
        send_text_message: Callable[[str, PersonaProfile], Awaitable[None]],
        send_tool_summary: Callable[[list[str], PersonaProfile], Awaitable[None]],
        finalize: Callable[[], Awaitable[None]],
    ) -> None:
        """Handle a Discord user message and stream response back.

        Callbacks:
            send_initial() -> Awaitable[None]                  - invoked before streaming begins.
            send_text_message(text, profile) -> Awaitable[None] - send assistant text message.
            send_tool_summary(events, profile) -> Awaitable[None] - send tool activity summary.
            finalize() -> Awaitable[None]                      - cleanup (e.g., stop typing).
        """
        key = self._make_key(guild_id, channel_id)
        lock = self._locks[key]

        async with lock:
            session = await self._sessions.ensure_session(
                guild_id=guild_id,
                channel_id=channel_id,
                user_id=user_id,
            )

            await self._sessions.capture_message(session, content=content, role="user")

            session.pending_prompt = content

            config = SessionConfig(
                working_dir=session.project_path,
                output_style="discord",
                personality=",".join(session.personas),
                user_id=session.user_id,
                include_context=self._context_enabled,
            )

            try:
                await self._daemon.ensure_session(
                    config=config,
                    session_id=session.daemon_session_id,
                )
                session.daemon_session_id = self._daemon.session_id
            except Exception:
                logger.exception("Failed to ensure daemon session")
                raise

            await send_initial()

            try:
                tool_seen, pre_tool_chunks, post_tool_chunks, tool_events = (
                    await self._stream_response(session, send_text_message, send_tool_summary)
                )
            except Exception:
                await finalize()
                raise
            else:
                await finalize()

                await self._finalize_response(
                    session,
                    tool_seen,
                    pre_tool_chunks,
                    post_tool_chunks,
                    tool_events,
                    send_text_message,
                    send_tool_summary,
                )

    def _make_key(self, guild_id: int | None, channel_id: int) -> str:
        return f"{guild_id or 'dm'}:{channel_id}"

    def _preview(self, data: object, *, limit: int = 120) -> str:
        if isinstance(data, str):
            text = data.strip()
            if not text:
                return "(no output)"
            if len(text) > limit:
                return text[: limit - 3] + "..."
            return text

        if isinstance(data, dict):
            for key in ("text", "content", "stdout", "output", "result", "command"):
                if key in data and data[key]:
                    return self._preview(data[key], limit=limit)
            return "(no output)"

        if isinstance(data, list | tuple):
            if not data:
                return "(no output)"
            parts = [self._preview(item, limit=limit) for item in data]
            text = "\n".join(part for part in parts if part and part != "(no output)")
            if not text:
                return "(no output)"
            if len(text) > limit:
                return text[: limit - 3] + "..."
            return text

        text = str(data).strip()
        if not text:
            return "(no output)"
        if len(text) > limit:
            return text[: limit - 3] + "..."
        return text
