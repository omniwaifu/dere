"""Centralized agent service managing ClaudeSDKClient instances."""

from __future__ import annotations

import asyncio
import json
import tempfile
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import (
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)
from claude_agent_sdk.types import (
    StreamEvent as SDKStreamEvent,
)
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlmodel import select

from dere_shared.config import load_dere_config
from dere_shared.context import get_time_context
from dere_shared.models import Session
from dere_shared.personalities import PersonalityLoader
from dere_shared.weather import get_weather_context

from .models import SessionConfig, StreamEvent, StreamEventType
from .streaming import (
    cancelled_event,
    done_event,
    error_event,
    extract_events_from_message,
    is_init_message,
    permission_request_event,
    text_event,
    thinking_event,
)

if TYPE_CHECKING:
    from dere_shared.emotion.manager import OCCEmotionManager


def _now() -> float:
    return time.monotonic()


EVENT_BUFFER_SIZE = 500
PERMISSION_TIMEOUT = 300  # 5 minutes to respond to permission request


@dataclass
class PendingPermission:
    """A pending permission request waiting for user response."""

    request_id: str
    tool_name: str
    tool_input: dict[str, Any]
    response_event: asyncio.Event = field(default_factory=asyncio.Event)
    allowed: bool = False
    deny_message: str = ""


@dataclass
class AgentSession:
    """Active agent session with Claude SDK client."""

    session_id: int
    config: SessionConfig
    client: ClaudeSDKClient | None
    exit_stack: AsyncExitStack
    settings_file: str | None
    claude_session_id: str | None
    created_at: float
    last_activity: float
    personality_prompt: str = ""
    needs_session_id_capture: bool = True
    event_buffer: deque[StreamEvent] = field(
        default_factory=lambda: deque(maxlen=EVENT_BUFFER_SIZE)
    )
    event_seq: int = 0
    pending_permissions: dict[str, PendingPermission] = field(default_factory=dict)
    # Queue for permission events that need to be sent to client
    permission_event_queue: asyncio.Queue[StreamEvent] = field(
        default_factory=asyncio.Queue
    )

    def touch(self) -> None:
        self.last_activity = _now()

    def add_event(self, event: StreamEvent) -> StreamEvent:
        """Add event to buffer with sequence number."""
        self.event_seq += 1
        event.seq = self.event_seq
        self.event_buffer.append(event)
        return event

    def get_events_since(self, last_seq: int) -> list[StreamEvent]:
        """Get all events with seq > last_seq."""
        return [e for e in self.event_buffer if e.seq is not None and e.seq > last_seq]

    def resolve_permission(
        self, request_id: str, allowed: bool, deny_message: str = ""
    ) -> bool:
        """Resolve a pending permission request. Returns True if request existed."""
        if request_id not in self.pending_permissions:
            return False
        pending = self.pending_permissions[request_id]
        pending.allowed = allowed
        pending.deny_message = deny_message
        pending.response_event.set()
        return True


@dataclass
class CentralizedAgentService:
    """Manages Claude SDK sessions centrally in the daemon."""

    session_factory: async_sessionmaker[AsyncSession]
    personality_loader: PersonalityLoader
    emotion_managers: dict[int, Any]
    dere_graph: Any | None = None
    config: dict[str, Any] = field(default_factory=dict)

    _sessions: dict[int, AgentSession] = field(default_factory=dict)
    _locks: dict[int, asyncio.Lock] = field(default_factory=dict)
    _cancel_events: dict[int, asyncio.Event] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.config:
            self.config = load_dere_config()

    def _get_lock(self, session_id: int) -> asyncio.Lock:
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    def _get_cancel_event(self, session_id: int) -> asyncio.Event:
        if session_id not in self._cancel_events:
            self._cancel_events[session_id] = asyncio.Event()
        return self._cancel_events[session_id]

    def _make_permission_callback(
        self, session: AgentSession
    ):
        """Create a can_use_tool callback for a session.

        The callback emits a permission request event and waits for user response.
        """

        async def can_use_tool(
            tool_name: str,
            tool_input: dict[str, Any],
            context: ToolPermissionContext,
        ) -> PermissionResultAllow | PermissionResultDeny:
            request_id = str(uuid.uuid4())

            # Create pending permission
            pending = PendingPermission(
                request_id=request_id,
                tool_name=tool_name,
                tool_input=tool_input,
            )
            session.pending_permissions[request_id] = pending

            # Queue the permission event for the caller to send
            event = permission_request_event(request_id, tool_name, tool_input)
            await session.permission_event_queue.put(session.add_event(event))

            # Wait for user response with timeout
            try:
                await asyncio.wait_for(
                    pending.response_event.wait(), timeout=PERMISSION_TIMEOUT
                )
            except TimeoutError:
                # Timeout - deny by default
                del session.pending_permissions[request_id]
                return PermissionResultDeny(
                    message="Permission request timed out (no response from user)"
                )

            # Clean up and return result
            del session.pending_permissions[request_id]

            if pending.allowed:
                return PermissionResultAllow()
            else:
                return PermissionResultDeny(
                    message=pending.deny_message or "Permission denied by user"
                )

        return can_use_tool

    async def cancel_query(self, session_id: int) -> bool:
        """Cancel an active query for a session.

        Returns True if a cancellation was signaled, False if no active query.
        """
        if session_id not in self._sessions:
            return False
        event = self._get_cancel_event(session_id)
        if not event.is_set():
            event.set()
            return True
        return False

    def get_missed_events(self, session_id: int, last_seq: int) -> list[StreamEvent]:
        """Get events missed during disconnect.

        Args:
            session_id: The session to get events for
            last_seq: The last sequence number the client received

        Returns:
            List of events with seq > last_seq, or empty list if session not found
        """
        session = self._sessions.get(session_id)
        if not session:
            return []
        return session.get_events_since(last_seq)

    async def _get_global_emotion_manager(self) -> OCCEmotionManager | None:
        """Get the global emotion manager."""
        try:
            from dere_daemon.main import get_global_emotion_manager

            return await get_global_emotion_manager()
        except Exception as e:
            logger.debug("Failed to get global emotion manager: {}", e)
            return None

    async def _get_emotion_summary(self, session_id: int) -> str:
        """Get emotion summary for prompt injection (uses global emotions)."""
        try:
            manager = await self._get_global_emotion_manager()
            if manager:
                summary = manager.get_emotional_state_summary()
                if summary and summary != "Currently in a neutral emotional state.":
                    return summary
        except Exception as e:
            logger.debug("Failed to get emotion summary: {}", e)
        return ""

    def _build_environmental_context(self, session_id: int) -> str:
        """Build environmental context for system prompt."""
        parts = []

        try:
            if self.config.get("context", {}).get("time", True):
                time_ctx = get_time_context()
                if time_ctx:
                    parts.append(f"Current time: {time_ctx['time']}, {time_ctx['date']}")
        except Exception:
            pass

        try:
            if self.config.get("context", {}).get("weather", False):
                weather_ctx = get_weather_context(self.config)
                if weather_ctx:
                    parts.append(
                        f"Weather in {weather_ctx['location']}: "
                        f"{weather_ctx['conditions']}, {weather_ctx['temperature']}"
                    )
        except Exception:
            pass

        if parts:
            return "\n\n## Environmental Context\n" + " | ".join(parts)
        return ""

    def _build_personality_prompt(self, config: SessionConfig) -> str:
        """Build personality prompt from config."""
        personalities = config.personality
        if isinstance(personalities, str):
            personalities = [p.strip() for p in personalities.split(",") if p.strip()]
        if not personalities:
            return ""

        prompts: list[str] = []
        for name in personalities:
            try:
                personality = self.personality_loader.load(name)
                prompts.append(personality.prompt_content)
            except ValueError as e:
                logger.warning("Failed to load personality {}: {}", name, e)

        return "\n\n".join(prompts)

    async def _create_db_session(
        self,
        config: SessionConfig,
    ) -> tuple[int, str | None]:
        """Create a new session in the database."""
        async with self.session_factory() as db:
            personality_str = (
                config.personality
                if isinstance(config.personality, str)
                else ",".join(config.personality) if config.personality else ""
            )

            session = Session(
                working_dir=config.working_dir,
                start_time=int(time.time()),
                personality=personality_str,
                medium="agent_api",
                user_id=config.user_id,
            )
            db.add(session)
            await db.flush()
            await db.refresh(session)
            await db.commit()

            return session.id, None

    async def _update_claude_session_id(self, session_id: int, claude_session_id: str) -> None:
        """Store Claude session ID in database."""
        async with self.session_factory() as db:
            stmt = select(Session).where(Session.id == session_id)
            result = await db.execute(stmt)
            session = result.scalar_one_or_none()

            if session:
                session.claude_session_id = claude_session_id
                await db.commit()
                logger.info(
                    "Stored claude_session_id {} for session {}",
                    claude_session_id,
                    session_id,
                )

    async def create_session(self, config: SessionConfig) -> AgentSession:
        """Create a new agent session with the given configuration.

        This creates a new database row and then initializes the Claude SDK client.
        """
        session_id, claude_session_id = await self._create_db_session(config)
        return await self._create_agent_session(
            session_id=session_id,
            claude_session_id=claude_session_id,
            config=config,
        )

    async def _create_agent_session(
        self,
        session_id: int,
        claude_session_id: str | None,
        config: SessionConfig,
    ) -> AgentSession:
        """Create the in-memory AgentSession with Claude SDK client.

        This does NOT create a database row - use create_session for new sessions
        or resume_session to load existing ones.
        """
        lock = self._get_lock(session_id)

        async with lock:
            if session_id in self._sessions:
                old_session = self._sessions[session_id]
                await self._close_session_internal(old_session)

            # Build system prompt components
            personality_prompt = self._build_personality_prompt(config)

            env_context = ""
            emotion_context = ""
            if config.include_context:
                env_context = self._build_environmental_context(session_id)
                emotion_summary = await self._get_emotion_summary(session_id)
                if emotion_summary:
                    emotion_context = f"\n\n## Emotional State\n{emotion_summary}"

            full_prompt = personality_prompt + env_context + emotion_context

            settings_data = {"outputStyle": config.output_style}
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                json.dump(settings_data, f)
                settings_path = f.name

            allowed_tools = config.allowed_tools
            if allowed_tools is None:
                allowed_tools = ["Read", "Write", "Bash", "Edit", "Glob", "Grep"]

            # Load dere-core plugin for output styles
            dere_core_plugin_path = str(
                Path(__file__).parent.parent.parent / "dere_plugins" / "dere_core"
            )

            now = _now()
            exit_stack = AsyncExitStack()

            # Create session first (without client) so callback can reference it
            agent_session = AgentSession(
                session_id=session_id,
                config=config,
                client=None,  # Set after creating ClaudeSDKClient with permission callback
                exit_stack=exit_stack,
                settings_file=settings_path,
                claude_session_id=claude_session_id,
                created_at=now,
                last_activity=now,
                personality_prompt=personality_prompt,
                needs_session_id_capture=(claude_session_id is None),
            )

            # Create permission callback that references the session
            permission_callback = self._make_permission_callback(agent_session)

            options = ClaudeAgentOptions(
                cwd=config.working_dir,
                settings=settings_path,
                setting_sources=["user", "project", "local"],
                system_prompt={
                    "type": "preset",
                    "preset": config.output_style,
                    "append": full_prompt,
                },
                allowed_tools=allowed_tools,
                permission_mode="acceptEdits",
                resume=claude_session_id,
                plugins=[{"type": "local", "path": dere_core_plugin_path}],
                model=config.model,
                include_partial_messages=config.enable_streaming,
                can_use_tool=permission_callback,
                max_thinking_tokens=config.thinking_budget,
            )

            client = ClaudeSDKClient(options=options)
            await exit_stack.enter_async_context(client)
            agent_session.client = client

            self._sessions[session_id] = agent_session
            logger.info(
                "Created agent session {} with output_style={}, personality={}, model={}, thinking_budget={}",
                session_id,
                config.output_style,
                config.personality,
                config.model or "default",
                config.thinking_budget,
            )

            return agent_session

    async def get_session(self, session_id: int) -> AgentSession | None:
        """Get existing session by ID."""
        return self._sessions.get(session_id)

    async def resume_session(self, session_id: int) -> AgentSession | None:
        """Resume an existing session from database.

        Unlike create_session, this does NOT create a new database row.
        It loads the existing session and creates a Claude SDK client for it.
        """
        if session_id in self._sessions:
            return self._sessions[session_id]

        async with self.session_factory() as db:
            stmt = select(Session).where(Session.id == session_id)
            result = await db.execute(stmt)
            db_session = result.scalar_one_or_none()

            if not db_session:
                return None

            config = SessionConfig(
                working_dir=db_session.working_dir,
                output_style="default",
                personality=db_session.personality or "",
                user_id=db_session.user_id,
            )

            return await self._create_agent_session(
                session_id=session_id,
                claude_session_id=db_session.claude_session_id,
                config=config,
            )

    async def update_session_config(
        self, session_id: int, new_config: SessionConfig
    ) -> AgentSession | None:
        """Update session configuration, recreating client if needed."""
        session = self._sessions.get(session_id)
        if not session:
            return None

        lock = self._get_lock(session_id)
        async with lock:
            needs_recreate = (
                session.config.output_style != new_config.output_style
                or session.config.personality != new_config.personality
                or session.config.allowed_tools != new_config.allowed_tools
            )

            if needs_recreate:
                await self._close_session_internal(session)
                new_config_with_dir = SessionConfig(
                    working_dir=new_config.working_dir or session.config.working_dir,
                    output_style=new_config.output_style,
                    personality=new_config.personality,
                    user_id=new_config.user_id or session.config.user_id,
                    allowed_tools=new_config.allowed_tools,
                    include_context=new_config.include_context,
                )
                return await self.create_session(new_config_with_dir)

            session.config = new_config
            session.touch()
            return session

    async def query(
        self,
        session: AgentSession,
        prompt: str,
    ) -> AsyncIterator[StreamEvent]:
        """Send a query to Claude and yield streaming events.

        This method handles both SDK messages and permission requests. When the
        SDK's can_use_tool callback is waiting for user response, permission
        events are yielded so the UI can display the prompt.
        """
        session.touch()

        cancel_event = self._get_cancel_event(session.session_id)
        cancel_event.clear()

        if session.client is None:
            yield session.add_event(error_event("Session not initialized", recoverable=False))
            return

        try:
            await session.client.query(prompt)
        except Exception as e:
            logger.error("Claude query failed: {}", e)
            yield session.add_event(error_event(str(e), recoverable=False))
            return

        response_chunks: list[str] = []
        tool_count = 0
        tool_id_to_name: dict[str, str] = {}
        was_cancelled = False

        # Queue to collect events from both sources
        event_queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()
        response_done = asyncio.Event()

        async def process_sdk_messages() -> None:
            """Process SDK messages and put events on the queue."""
            nonlocal was_cancelled, tool_count
            try:
                async for message in session.client.receive_response():
                    if cancel_event.is_set():
                        was_cancelled = True
                        break

                    is_init, claude_session_id = is_init_message(message)
                    if is_init and claude_session_id:
                        if session.needs_session_id_capture:
                            await self._update_claude_session_id(
                                session.session_id, claude_session_id
                            )
                            session.claude_session_id = claude_session_id
                            session.needs_session_id_capture = False
                        continue

                    # Handle partial streaming events (token-level)
                    if isinstance(message, SDKStreamEvent):
                        raw = message.event
                        if raw.get("type") == "content_block_delta":
                            delta = raw.get("delta", {})
                            delta_type = delta.get("type", "")
                            if delta_type == "text_delta":
                                text = delta.get("text", "")
                                if text:
                                    logger.info("Stream text chunk: {!r}", text)
                                    response_chunks.append(text)
                                    await event_queue.put(
                                        session.add_event(text_event(text))
                                    )
                            elif delta_type == "thinking_delta":
                                thinking_text = delta.get("thinking", "")
                                if thinking_text:
                                    logger.info("Stream thinking chunk: {!r}", thinking_text)
                                    await event_queue.put(
                                        session.add_event(thinking_event(thinking_text))
                                    )
                        continue

                    events = extract_events_from_message(message, tool_id_to_name)
                    for event in events:
                        if event.type == StreamEventType.TEXT:
                            # Skip TEXT from final message if we already streamed
                            if session.config.enable_streaming:
                                continue
                            response_chunks.append(event.data.get("text", ""))
                        elif event.type in (
                            StreamEventType.TOOL_USE,
                            StreamEventType.TOOL_RESULT,
                        ):
                            tool_count += 1
                        await event_queue.put(session.add_event(event))
            except Exception as e:
                logger.exception("Error streaming response")
                await event_queue.put(
                    session.add_event(error_event(str(e), recoverable=True))
                )
            finally:
                response_done.set()
                await event_queue.put(None)  # Sentinel to signal completion

        async def process_permission_events() -> None:
            """Forward permission events from the callback to the queue."""
            while not response_done.is_set():
                try:
                    # Short timeout to check response_done periodically
                    event = await asyncio.wait_for(
                        session.permission_event_queue.get(), timeout=0.1
                    )
                    await event_queue.put(event)
                except TimeoutError:
                    continue

        # Start both tasks
        sdk_task = asyncio.create_task(process_sdk_messages())
        permission_task = asyncio.create_task(process_permission_events())

        try:
            # Yield events from the combined queue
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                yield event
        finally:
            # Cleanup
            permission_task.cancel()
            try:
                await permission_task
            except asyncio.CancelledError:
                pass
            await sdk_task

        if was_cancelled:
            yield session.add_event(cancelled_event())
            return

        response_text = "".join(response_chunks)
        yield session.add_event(done_event(response_text, tool_count))

    async def _close_session_internal(self, session: AgentSession) -> None:
        """Close session without lock (called from within locked context)."""
        try:
            await session.exit_stack.aclose()
        except Exception as e:
            logger.warning("Error closing session {}: {}", session.session_id, e)

        if session.settings_file:
            try:
                Path(session.settings_file).unlink(missing_ok=True)
            except Exception as e:
                logger.debug("Failed to cleanup settings file: {}", e)

        self._sessions.pop(session.session_id, None)

    async def close_session(self, session_id: int) -> None:
        """Close and cleanup a session."""
        session = self._sessions.get(session_id)
        if not session:
            return

        lock = self._get_lock(session_id)
        async with lock:
            await self._close_session_internal(session)

        logger.info("Closed agent session {}", session_id)

    async def list_sessions(self) -> list[tuple[int, SessionConfig]]:
        """List all active sessions."""
        return [(sid, s.config) for sid, s in self._sessions.items()]

    async def close_all(self) -> None:
        """Close all active sessions."""
        session_ids = list(self._sessions.keys())
        for session_id in session_ids:
            try:
                await self.close_session(session_id)
            except Exception as e:
                logger.warning("Failed to close session {}: {}", session_id, e)
