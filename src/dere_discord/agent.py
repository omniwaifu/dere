"""Claude Agent integration for Discord messaging."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable

from claude_agent_sdk import (
    AssistantMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from loguru import logger

from dere_shared.context import get_full_context

from .persona import PersonaProfile
from .session import SessionManager


class DiscordAgent:
    """Bridge Discord messages to Claude via the session manager."""

    def __init__(self, sessions: SessionManager, *, context_enabled: bool = True):
        self._sessions = sessions
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._context_enabled = context_enabled

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

            prompt = content
            if self._context_enabled:
                context_text = get_full_context(session_id=session.session_id)
                if context_text:
                    prompt = f"{context_text}\n\n{content}"

            await send_initial()

            try:
                await session.client.query(prompt)
            except Exception:
                logger.exception("Claude query failed for channel {}", key)
                raise

            pre_tool_chunks: list[str] = []
            post_tool_chunks: list[str] = []
            tool_events: list[str] = []
            tool_seen = False

            try:
                async for message in session.client.receive_response():
                    # Capture Claude session ID from init message
                    if isinstance(message, SystemMessage):
                        subtype = getattr(message, "subtype", None)
                        logger.debug(
                            "Received SystemMessage: subtype={}, data={}", subtype, message.data
                        )
                        if subtype == "init":
                            claude_session_id = message.data.get("session_id")
                            logger.info("Found init message with session_id: {}", claude_session_id)
                            if claude_session_id:
                                await self._sessions.capture_claude_session_id(
                                    session, claude_session_id
                                )
                        continue

                    if isinstance(message, AssistantMessage | UserMessage):
                        for block in getattr(message, "content", []) or []:
                            if isinstance(block, TextBlock | ThinkingBlock):
                                text = getattr(block, "text", "")
                                if text:
                                    if tool_seen:
                                        post_tool_chunks.append(text)
                                    else:
                                        pre_tool_chunks.append(text)

                            elif isinstance(block, ToolUseBlock | ToolResultBlock):
                                if not tool_seen:
                                    tool_seen = True
                                    initial_text = "".join(pre_tool_chunks).strip()
                                    if initial_text:
                                        await send_text_message(
                                            initial_text, session.persona_profile
                                        )
                                        await self._sessions.capture_message(
                                            session,
                                            content=initial_text,
                                            role="assistant",
                                        )
                                    pre_tool_chunks.clear()

                                event = self._summarize_tool_message(block)
                                if event:
                                    tool_events.append(event)

                    else:
                        text = self._extract_text(message)
                        if text:
                            if tool_seen:
                                post_tool_chunks.append(text)
                            else:
                                pre_tool_chunks.append(text)
                            continue

                        event = self._summarize_tool_message(message)
                        if event:
                            if not tool_seen:
                                tool_seen = True
                                initial_text = "".join(pre_tool_chunks).strip()
                                if initial_text:
                                    await send_text_message(initial_text, session.persona_profile)
                                    await self._sessions.capture_message(
                                        session,
                                        content=initial_text,
                                        role="assistant",
                                    )
                                pre_tool_chunks.clear()
                            tool_events.append(event)
            except Exception:
                logger.exception("Failed while streaming response for channel {}", key)
                await finalize()
                raise
            else:
                await finalize()

                persona_profile = session.persona_profile

                if not tool_seen:
                    response_text = "".join(pre_tool_chunks).strip()
                    await send_text_message(response_text, persona_profile)
                    if response_text:
                        await self._sessions.capture_message(
                            session,
                            content=response_text,
                            role="assistant",
                        )
                else:
                    final_text = "".join(post_tool_chunks).strip()

                    if tool_events:
                        await send_tool_summary(tool_events, persona_profile)

                    if final_text:
                        await send_text_message(final_text, persona_profile)
                        await self._sessions.capture_message(
                            session,
                            content=final_text,
                            role="assistant",
                        )

                await self._sessions.schedule_summary(session)

    def _make_key(self, guild_id: int | None, channel_id: int) -> str:
        return f"{guild_id or 'dm'}:{channel_id}"

    def _extract_text(self, message: object) -> str:
        if isinstance(message, AssistantMessage):
            return _extract_from_assistant(message)

        if isinstance(message, TextBlock | ThinkingBlock):
            return getattr(message, "text", "")

        content = getattr(message, "content", None)
        if isinstance(content, str):
            return content
        return ""

    def _summarize_tool_message(self, message: object) -> str | None:
        if isinstance(message, ToolUseBlock):
            tool_name = getattr(message, "name", "unknown")
            tool_id = getattr(message, "id", "")
            tool_input = getattr(message, "input", {})
            preview = self._preview(tool_input)
            return f"Running `{tool_name}`: {preview}"

        if isinstance(message, ToolResultBlock):
            content = getattr(message, "content", None)
            is_error = getattr(message, "is_error", False)

            formatted_output = self._preview(content, limit=400)
            if is_error:
                return f"Tool failed\n{formatted_output}".strip()
            return f"Tool completed\n{formatted_output}".strip()

        if isinstance(message, AssistantMessage):
            for block in getattr(message, "content", []) or []:
                if isinstance(block, ToolUseBlock | ToolResultBlock):
                    return self._summarize_tool_message(block)

        return None

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


def _extract_from_assistant(message: AssistantMessage) -> str:
    segments: list[str] = []
    for block in getattr(message, "content", []) or []:
        if isinstance(block, TextBlock | ThinkingBlock):
            text = getattr(block, "text", "")
            if text:
                segments.append(text)
    return "".join(segments)
