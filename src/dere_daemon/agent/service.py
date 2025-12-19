"""Centralized agent service managing session runners."""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

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
from dere_shared.models import Conversation, ConversationBlock, MessageType, Session
from dere_shared.personalities import PersonalityLoader
from dere_shared.weather import get_weather_context

from .models import SessionConfig, StreamEvent, StreamEventType
from .runners import DockerSessionRunner, LocalSessionRunner, SessionRunner
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
SANDBOX_IDLE_TIMEOUT = 1800  # 30 minutes before auto-closing idle sandbox sessions
SANDBOX_CLEANUP_INTERVAL = 60  # Check for idle sandboxes every minute


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
    """Active agent session with a session runner."""

    session_id: int
    config: SessionConfig
    runner: SessionRunner | None
    claude_session_id: str | None
    created_at: float
    last_activity: float
    name: str | None = None  # Session display name
    personality_prompt: str = ""
    needs_session_id_capture: bool = True
    is_locked: bool = False  # Locked sandbox sessions can't accept new queries
    event_buffer: deque[StreamEvent] = field(
        default_factory=lambda: deque(maxlen=EVENT_BUFFER_SIZE)
    )
    event_seq: int = 0
    pending_permissions: dict[str, PendingPermission] = field(default_factory=dict)
    # Queue for permission events that need to be sent to client
    permission_event_queue: asyncio.Queue[StreamEvent] = field(
        default_factory=asyncio.Queue
    )
    # Store initial prompt for name generation (especially for sandbox sessions)
    initial_prompt: str | None = None
    first_response_text: str | None = None

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
    _cleanup_task: asyncio.Task | None = field(default=None, init=False)

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
        If session.config.auto_approve is True, all permissions are automatically granted.
        """

        async def can_use_tool(
            tool_name: str,
            tool_input: dict[str, Any],
            context: ToolPermissionContext,
        ) -> PermissionResultAllow | PermissionResultDeny:
            # Auto-approve for autonomous sessions (e.g., missions)
            if session.config.auto_approve:
                logger.debug("Auto-approving tool {} for autonomous session", tool_name)
                return PermissionResultAllow()

            request_id = str(uuid.uuid4())
            logger.info(
                "Permission requested: session_id={} tool={} request_id={}",
                session.session_id,
                tool_name,
                request_id,
            )

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
                logger.warning(
                    "Permission timed out: session_id={} tool={} request_id={}",
                    session.session_id,
                    tool_name,
                    request_id,
                )
                return PermissionResultDeny(
                    message="Permission request timed out (no response from user)"
                )

            # Clean up and return result
            del session.pending_permissions[request_id]

            if pending.allowed:
                logger.info(
                    "Permission allowed: session_id={} tool={} request_id={}",
                    session.session_id,
                    tool_name,
                    request_id,
                )
                return PermissionResultAllow()
            else:
                logger.info(
                    "Permission denied: session_id={} tool={} request_id={}",
                    session.session_id,
                    tool_name,
                    request_id,
                )
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

    async def _process_interaction_complete(
        self,
        session: AgentSession,
        prompt: str,
        response_text: str,
        tool_count: int,
        response_time_ms: float | None,
    ) -> None:
        """Process completed interaction for emotion system.

        Called after each successful query completion. Runs in background
        to not block the response stream.
        """
        async def process_background() -> None:
            try:
                emotion_manager = await self._get_global_emotion_manager()
                if emotion_manager:
                    try:
                        from datetime import UTC, datetime

                        now = datetime.now(UTC)

                        stimulus = {
                            "type": "agent_interaction",
                            "role": "user",
                            "message": prompt,
                            "response": response_text[:500] if response_text else "",
                            "tool_usage": tool_count > 0,
                        }

                        context = {
                            "conversation_id": str(session.session_id),
                            "personality": session.config.personality,
                            "temporal": {
                                "hour": now.hour,
                                "day_of_week": now.strftime("%A"),
                            },
                            "session": {
                                "working_dir": session.config.working_dir,
                            },
                        }

                        personality_name = session.config.personality
                        if isinstance(personality_name, list):
                            personality_name = personality_name[0] if personality_name else None

                        persona_prompt = ""
                        if personality_name:
                            try:
                                personality = self.personality_loader.load(personality_name)
                                persona_prompt = personality.prompt_content
                            except ValueError:
                                pass

                        emotion_manager.buffer_stimulus(stimulus, context, persona_prompt)
                        logger.debug("[emotion] Buffered interaction stimulus")
                    except Exception as e:
                        logger.error(f"[emotion] Failed to process stimulus: {e}")

                if self.dere_graph and response_text:
                    try:
                        from dere_daemon.context_tracking import extract_cited_entity_uuids
                        from dere_shared.models import ContextCache

                        async with self.session_factory() as db:
                            cache = await db.get(ContextCache, session.session_id)

                        if cache and cache.context_metadata:
                            cited = extract_cited_entity_uuids(
                                response_text, cache.context_metadata
                            )
                            if cited:
                                await self.dere_graph.track_entity_citations(cited)
                                logger.debug(
                                    "[kg] Tracked {} cited entities for session {}",
                                    len(cited),
                                    session.session_id,
                                )
                    except Exception as e:
                        logger.debug("[kg] Failed to track citations: {}", e)

            except Exception as e:
                logger.error(f"[interaction] Background processing failed: {e}")

        asyncio.create_task(process_background())

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
                name=config.session_name,
                working_dir=config.working_dir,
                start_time=int(time.time()),
                personality=personality_str,
                medium="agent_api",
                user_id=config.user_id,
                thinking_budget=config.thinking_budget,
                sandbox_mode=config.sandbox_mode,
                sandbox_settings=config.sandbox_settings,
                mission_id=config.mission_id,
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

    async def _lock_session(self, session_id: int) -> None:
        """Mark a session as locked (sandbox container stopped)."""
        async with self.session_factory() as db:
            stmt = select(Session).where(Session.id == session_id)
            result = await db.execute(stmt)
            session = result.scalar_one_or_none()

            if session:
                session.is_locked = True
                await db.commit()
                logger.info("Locked sandbox session {}", session_id)

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
        *,
        _already_locked: bool = False,
    ) -> AgentSession:
        """Create the in-memory AgentSession with a session runner.

        This does NOT create a database row - use create_session for new sessions
        or resume_session to load existing ones.

        Args:
            _already_locked: If True, caller already holds the session lock.
                            Used internally to avoid deadlock when called from
                            update_session_config.
        """

        async def _create_inner() -> AgentSession:
            if session_id in self._sessions:
                old_session = self._sessions[session_id]
                await self._close_session_internal(old_session)

            # Build system prompt components
            personality_prompt = self._build_personality_prompt(config)

            env_context = ""
            emotion_context = ""
            # Skip context injection for lean mode (swarm agents) or when explicitly disabled
            if config.include_context and not config.lean_mode:
                env_context = self._build_environmental_context(session_id)
                emotion_summary = await self._get_emotion_summary(session_id)
                if emotion_summary:
                    emotion_context = f"\n\n## Emotional State\n{emotion_summary}"

            full_prompt = personality_prompt + env_context + emotion_context

            # Determine plugin paths based on config
            # If plugins explicitly specified, use those; otherwise default to dere_core
            plugin_paths: list[str] = []
            plugins_base = Path(__file__).parent.parent.parent

            if config.plugins is not None:
                # Explicit plugin list (empty list = no plugins for lean mode)
                for plugin_name in config.plugins:
                    plugin_path = plugins_base / plugin_name
                    if plugin_path.exists():
                        plugin_paths.append(str(plugin_path))
            else:
                # Default: load dere_core
                dere_core_path = plugins_base / "dere_core"
                if dere_core_path.exists():
                    plugin_paths.append(str(dere_core_path))

            now = _now()

            # Create session first (without runner) so callback can reference it
            agent_session = AgentSession(
                session_id=session_id,
                config=config,
                runner=None,  # Set after creating runner with permission callback
                claude_session_id=claude_session_id,
                created_at=now,
                last_activity=now,
                name=config.session_name,  # From config for new sessions
                personality_prompt=personality_prompt,
                needs_session_id_capture=(claude_session_id is None),
            )

            # Create permission callback that references the session
            permission_callback = self._make_permission_callback(agent_session)

            # Create and start the session runner
            runner: SessionRunner
            if config.sandbox_mode:
                runner = DockerSessionRunner(
                    config=config,
                    system_prompt=full_prompt,
                    resume_session_id=claude_session_id,
                    mount_type=config.sandbox_mount_type,
                )
            else:
                runner = LocalSessionRunner(
                    config=config,
                    system_prompt=full_prompt,
                    permission_callback=permission_callback,
                    resume_session_id=claude_session_id,
                    plugin_paths=plugin_paths,
                )
            await runner.start()
            agent_session.runner = runner

            self._sessions[session_id] = agent_session
            logger.info(
                "Created agent session {} output_style={} personality={} thinking={}",
                session_id,
                config.output_style,
                config.personality,
                config.thinking_budget,
            )

            return agent_session

        if _already_locked:
            return await _create_inner()

        lock = self._get_lock(session_id)
        async with lock:
            return await _create_inner()

    async def get_session(self, session_id: int) -> AgentSession | None:
        """Get existing session by ID."""
        return self._sessions.get(session_id)

    async def resume_session(self, session_id: int) -> AgentSession | None:
        """Resume an existing session from database.

        Unlike create_session, this does NOT create a new database row.
        It loads the existing session and creates a Claude SDK client for it.

        For locked sessions (sandbox container stopped), returns a read-only session
        without a runner - history can be viewed but no new queries accepted.
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
                thinking_budget=db_session.thinking_budget,
                sandbox_mode=db_session.sandbox_mode,
                session_name=db_session.name,  # Restore name from DB
                enable_streaming=True,  # Always enable for UI sessions
            )

            # Locked sessions (dead sandbox containers) are read-only
            if db_session.is_locked:
                now = _now()
                session = AgentSession(
                    session_id=session_id,
                    config=config,
                    runner=None,
                    claude_session_id=db_session.claude_session_id,
                    created_at=now,
                    last_activity=now,
                    name=db_session.name,  # From database
                    is_locked=True,
                )
                self._sessions[session_id] = session
                return session

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
            # TODO: Check if claude-agent-sdk adds set_thinking_budget() runtime control
            # (like set_model/set_permission_mode). Until then, thinking_budget is locked
            # after session creation - changing it requires full subprocess restart.
            # For now, we ignore thinking_budget changes here; UI should disable the toggle.
            needs_recreate = (
                session.config.output_style != new_config.output_style
                or session.config.personality != new_config.personality
                or session.config.allowed_tools != new_config.allowed_tools
            )

            if needs_recreate:
                # Update DB with new config
                await self._update_session_config_in_db(session_id, new_config)

                # Close old client and recreate with same session ID
                claude_session_id = session.claude_session_id
                await self._close_session_internal(session)

                new_config_with_dir = SessionConfig(
                    working_dir=new_config.working_dir or session.config.working_dir,
                    output_style=new_config.output_style,
                    personality=new_config.personality,
                    user_id=new_config.user_id or session.config.user_id,
                    allowed_tools=new_config.allowed_tools,
                    include_context=new_config.include_context,
                    thinking_budget=new_config.thinking_budget,
                )

                return await self._create_agent_session(
                    session_id=session_id,
                    claude_session_id=claude_session_id,
                    config=new_config_with_dir,
                    _already_locked=True,
                )

            session.config = new_config
            session.touch()
            return session

    async def _update_session_config_in_db(
        self, session_id: int, config: SessionConfig
    ) -> None:
        """Update session config fields in database."""
        async with self.session_factory() as db:
            stmt = select(Session).where(Session.id == session_id)
            result = await db.execute(stmt)
            session = result.scalar_one_or_none()

            if session:
                personality_str = (
                    config.personality
                    if isinstance(config.personality, str)
                    else ",".join(config.personality) if config.personality else ""
                )
                session.personality = personality_str
                session.thinking_budget = config.thinking_budget
                await db.commit()

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

        # Store initial prompt for name generation (first query only)
        if session.initial_prompt is None:
            session.initial_prompt = prompt

        cancel_event = self._get_cancel_event(session.session_id)
        cancel_event.clear()

        if session.runner is None:
            yield session.add_event(error_event("Session not initialized", recoverable=False))
            return

        # Persist user prompt immediately (best-effort)
        personality_snapshot = session.config.personality
        if isinstance(personality_snapshot, list):
            personality_snapshot = personality_snapshot[0] if personality_snapshot else None
        try:
            async with self.session_factory() as db:
                conv_user = Conversation(
                    session_id=session.session_id,
                    prompt=prompt,
                    message_type=MessageType.USER,
                    personality=personality_snapshot,
                    timestamp=int(time.time()),
                    medium="agent_api",
                    user_id=session.config.user_id,
                )
                db.add(conv_user)
                await db.flush()
                await db.commit()
        except Exception as e:
            logger.debug("Failed to persist user conversation: {}", e)

        # Track timing
        request_start_time = time.monotonic()
        first_token_time: float | None = None
        thinking_window_start: float | None = None
        thinking_total_ms: float = 0.0
        tool_names: list[str] = []
        tool_name_set: set[str] = set()
        tool_use_count = 0
        ordered_blocks: list[dict[str, Any]] = []
        tool_use_id_to_block_index: dict[str, int] = {}

        def _close_thinking_window(now_t: float) -> None:
            nonlocal thinking_window_start, thinking_total_ms
            if thinking_window_start is not None:
                thinking_total_ms += (now_t - thinking_window_start) * 1000
                thinking_window_start = None

        def _append_or_coalesce_block(block: dict[str, Any]) -> None:
            """Append a block, coalescing consecutive thinking/text blocks."""
            if not ordered_blocks:
                ordered_blocks.append(block)
                return
            last = ordered_blocks[-1]
            if block.get("type") in ("text", "thinking") and last.get("type") == block.get("type"):
                last["text"] = (last.get("text", "") or "") + (block.get("text", "") or "")
                return
            ordered_blocks.append(block)

        def _upsert_tool_use_block(block: dict[str, Any]) -> None:
            """Insert or update a tool_use block by id (docker emits an empty-input start then a full-input later)."""
            tool_id = block.get("id")
            if isinstance(tool_id, str) and tool_id:
                existing_idx = tool_use_id_to_block_index.get(tool_id)
                if existing_idx is not None:
                    existing = ordered_blocks[existing_idx]
                    if existing.get("type") == "tool_use":
                        if existing.get("name") in (None, "", "unknown") and block.get("name"):
                            existing["name"] = block.get("name")
                        if (existing.get("input") in (None, {}, "")) and isinstance(block.get("input"), dict):
                            existing["input"] = block.get("input")
                    return
                tool_use_id_to_block_index[tool_id] = len(ordered_blocks)
            ordered_blocks.append(block)

        try:
            await session.runner.query(prompt)
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
            nonlocal was_cancelled, tool_count, first_token_time, thinking_window_start, tool_use_count
            try:
                async for message in session.runner.receive_response():
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
                                    if first_token_time is None:
                                        first_token_time = time.monotonic()
                                    _close_thinking_window(time.monotonic())
                                    _append_or_coalesce_block({"type": "text", "text": text})
                                    logger.info("Stream text chunk: {!r}", text)
                                    response_chunks.append(text)
                                    await event_queue.put(
                                        session.add_event(text_event(text))
                                    )
                            elif delta_type == "thinking_delta":
                                thinking_text = delta.get("thinking", "")
                                if thinking_text:
                                    if first_token_time is None:
                                        first_token_time = time.monotonic()
                                    now_t = time.monotonic()
                                    if thinking_window_start is None:
                                        thinking_window_start = now_t
                                    _append_or_coalesce_block({"type": "thinking", "text": thinking_text})
                                    logger.info("Stream thinking chunk: {!r}", thinking_text)
                                    await event_queue.put(
                                        session.add_event(thinking_event(thinking_text))
                                    )
                        continue

                    # Handle StreamEvent directly (from Docker runner)
                    if isinstance(message, StreamEvent):
                        event = message
                        if event.type == StreamEventType.TEXT:
                            text = event.data.get("text", "")
                            if text:
                                if first_token_time is None:
                                    first_token_time = time.monotonic()
                                _close_thinking_window(time.monotonic())
                                _append_or_coalesce_block({"type": "text", "text": text})
                                response_chunks.append(text)
                        elif event.type in (
                            StreamEventType.TOOL_USE,
                            StreamEventType.TOOL_RESULT,
                        ):
                            tool_count += 1
                            if event.type == StreamEventType.TOOL_USE:
                                tool_use_count += 1
                                logger.info(
                                    "Tool use: session_id={} name={} id={}",
                                    session.session_id,
                                    event.data.get("name"),
                                    event.data.get("id"),
                                )
                                name = event.data.get("name")
                                if isinstance(name, str) and name not in tool_name_set:
                                    tool_name_set.add(name)
                                    tool_names.append(name)
                                _close_thinking_window(time.monotonic())
                                _upsert_tool_use_block(
                                    {
                                        "type": "tool_use",
                                        "id": event.data.get("id"),
                                        "name": event.data.get("name"),
                                        "input": event.data.get("input"),
                                    }
                                )
                            elif event.type == StreamEventType.TOOL_RESULT:
                                logger.info(
                                    "Tool result: session_id={} name={} tool_use_id={} is_error={}",
                                    session.session_id,
                                    event.data.get("name"),
                                    event.data.get("tool_use_id"),
                                    event.data.get("is_error", False),
                                )
                                _close_thinking_window(time.monotonic())
                                ordered_blocks.append(
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": event.data.get("tool_use_id"),
                                        "name": event.data.get("name"),
                                        "output": event.data.get("output"),
                                        "is_error": event.data.get("is_error", False),
                                    }
                                )
                        elif event.type == StreamEventType.THINKING:
                            now_t = time.monotonic()
                            if thinking_window_start is None:
                                thinking_window_start = now_t
                            text = event.data.get("text", "")
                            if isinstance(text, str) and text:
                                _append_or_coalesce_block({"type": "thinking", "text": text})
                        await event_queue.put(session.add_event(event))
                        continue

                    events = extract_events_from_message(message, tool_id_to_name)
                    for event in events:
                        if event.type == StreamEventType.TEXT:
                            # Skip TEXT from final message if we already streamed
                            if session.config.enable_streaming:
                                continue
                            text = event.data.get("text", "")
                            if isinstance(text, str) and text:
                                _close_thinking_window(time.monotonic())
                                _append_or_coalesce_block({"type": "text", "text": text})
                                response_chunks.append(text)
                        elif event.type in (
                            StreamEventType.TOOL_USE,
                            StreamEventType.TOOL_RESULT,
                        ):
                            tool_count += 1
                            if event.type == StreamEventType.TOOL_USE:
                                tool_use_count += 1
                                name = event.data.get("name")
                                if isinstance(name, str) and name not in tool_name_set:
                                    tool_name_set.add(name)
                                    tool_names.append(name)
                                _close_thinking_window(time.monotonic())
                                _upsert_tool_use_block(
                                    {
                                        "type": "tool_use",
                                        "id": event.data.get("id"),
                                        "name": event.data.get("name"),
                                        "input": event.data.get("input"),
                                    }
                                )
                            elif event.type == StreamEventType.TOOL_RESULT:
                                _close_thinking_window(time.monotonic())
                                ordered_blocks.append(
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": event.data.get("tool_use_id"),
                                        "name": event.data.get("name"),
                                        "output": event.data.get("output"),
                                        "is_error": event.data.get("is_error", False),
                                    }
                                )
                        elif event.type == StreamEventType.THINKING:
                            now_t = time.monotonic()
                            if thinking_window_start is None:
                                thinking_window_start = now_t
                            text = event.data.get("text", "")
                            if isinstance(text, str) and text:
                                _append_or_coalesce_block({"type": "thinking", "text": text})
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

        _close_thinking_window(time.monotonic())

        # Prefer block-based reconstruction for readability (separates post-tool text blocks cleanly).
        text_segments = [
            b.get("text", "")
            for b in ordered_blocks
            if b.get("type") == "text" and isinstance(b.get("text"), str) and b.get("text")
        ]
        response_text = "\n\n".join(text_segments) if text_segments else "".join(response_chunks)

        # Store first response for name generation
        if session.first_response_text is None and response_text:
            session.first_response_text = response_text

        timings: dict[str, float] | None = None
        response_time_ms: float | None = None
        response_ms: int | None = None
        ttft_ms: int | None = None
        if first_token_time is not None:
            response_end_time = time.monotonic()
            response_time_ms = (response_end_time - request_start_time) * 1000
            response_ms = int(response_time_ms)
            ttft_ms = int((first_token_time - request_start_time) * 1000)
            timings = {
                "time_to_first_token": ttft_ms,
                "response_time": response_ms,
            }

        thinking_ms: int | None = None
        if thinking_total_ms > 0:
            thinking_ms = int(thinking_total_ms)

        # Persist assistant message + metrics (best-effort)
        try:
            async with self.session_factory() as db:
                conv_assistant = Conversation(
                    session_id=session.session_id,
                    prompt=response_text,
                    message_type=MessageType.ASSISTANT,
                    personality=personality_snapshot,
                    ttft_ms=ttft_ms,
                    response_ms=response_ms,
                    thinking_ms=thinking_ms,
                    tool_uses=tool_use_count,
                    tool_names=tool_names or None,
                    timestamp=int(time.time()),
                    medium="agent_api",
                    user_id=session.config.user_id,
                )
                db.add(conv_assistant)
                await db.flush()

                blocks: list[ConversationBlock] = []
                ordinal = 0
                for b in ordered_blocks:
                    btype = b.get("type")
                    if btype == "thinking":
                        text = b.get("text", "")
                        if isinstance(text, str) and text:
                            blocks.append(
                                ConversationBlock(
                                    conversation_id=conv_assistant.id,  # type: ignore[arg-type]
                                    ordinal=ordinal,
                                    block_type="thinking",
                                    text=text,
                                )
                            )
                            ordinal += 1
                    elif btype == "text":
                        text = b.get("text", "")
                        if isinstance(text, str) and text:
                            blocks.append(
                                ConversationBlock(
                                    conversation_id=conv_assistant.id,  # type: ignore[arg-type]
                                    ordinal=ordinal,
                                    block_type="text",
                                    text=text,
                                )
                            )
                            ordinal += 1
                    elif btype == "tool_use":
                        blocks.append(
                            ConversationBlock(
                                conversation_id=conv_assistant.id,  # type: ignore[arg-type]
                                ordinal=ordinal,
                                block_type="tool_use",
                                tool_use_id=b.get("id"),
                                tool_name=b.get("name"),
                                tool_input=b.get("input") if isinstance(b.get("input"), dict) else None,
                            )
                        )
                        ordinal += 1
                    elif btype == "tool_result":
                        output = b.get("output", "")
                        blocks.append(
                            ConversationBlock(
                                conversation_id=conv_assistant.id,  # type: ignore[arg-type]
                                ordinal=ordinal,
                                block_type="tool_result",
                                tool_use_id=b.get("tool_use_id"),
                                tool_name=b.get("name"),
                                text=output if isinstance(output, str) else str(output),
                                is_error=bool(b.get("is_error", False)),
                            )
                        )
                        ordinal += 1

                if blocks:
                    db.add_all(blocks)
                await db.commit()
        except Exception as e:
            logger.debug("Failed to persist assistant conversation: {}", e)

        # Process interaction for bond and emotion systems (fire and forget)
        await self._process_interaction_complete(
            session, prompt, response_text, tool_count, response_time_ms
        )

        yield session.add_event(done_event(response_text, tool_count, timings))

    async def _close_session_internal(self, session: AgentSession) -> None:
        """Close session without lock (called from within locked context)."""
        if session.runner:
            try:
                await session.runner.close()
            except Exception as e:
                logger.warning("Error closing session {}: {}", session.session_id, e)

        # Lock sandbox sessions in database (container is dead, can't continue)
        if session.config.sandbox_mode:
            await self._lock_session(session.session_id)

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
        # Stop the cleanup task first
        await self.stop_cleanup_task()

        session_ids = list(self._sessions.keys())
        for session_id in session_ids:
            try:
                await self.close_session(session_id)
            except Exception as e:
                logger.warning("Failed to close session {}: {}", session_id, e)

    def start_cleanup_task(self) -> None:
        """Start the background task that cleans up idle sandbox sessions."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._sandbox_cleanup_loop())
            logger.info("Started sandbox cleanup task (idle timeout: {}s)", SANDBOX_IDLE_TIMEOUT)

    async def stop_cleanup_task(self) -> None:
        """Stop the sandbox cleanup background task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            logger.info("Stopped sandbox cleanup task")

    async def _sandbox_cleanup_loop(self) -> None:
        """Background loop that closes idle sandbox sessions."""
        while True:
            try:
                await asyncio.sleep(SANDBOX_CLEANUP_INTERVAL)
                await self._cleanup_idle_sandboxes()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in sandbox cleanup loop: {}", e)

    async def _cleanup_idle_sandboxes(self) -> None:
        """Check for and close sandbox sessions that have been idle too long."""
        now = _now()
        sessions_to_close: list[int] = []

        for session_id, session in self._sessions.items():
            if not session.config.sandbox_mode:
                continue

            idle_time = now - session.last_activity
            if idle_time > SANDBOX_IDLE_TIMEOUT:
                sessions_to_close.append(session_id)
                logger.info(
                    "Sandbox session {} idle for {:.0f}s, marking for cleanup",
                    session_id,
                    idle_time,
                )

        for session_id in sessions_to_close:
            try:
                await self.close_session(session_id)
                logger.info("Auto-closed idle sandbox session {}", session_id)
            except Exception as e:
                logger.warning("Failed to auto-close sandbox session {}: {}", session_id, e)
