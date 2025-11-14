from __future__ import annotations

import asyncio
import json
import os
import platform
import sys
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlmodel import select

from dere_daemon.task_processor import TaskProcessor
from dere_shared.config import load_dere_config
from dere_shared.database import create_engine, create_session_factory, get_session
from dere_shared.models import (
    ContextCache,
    Conversation,
    EmotionState,
    MessageType,
    Notification,
    Presence,
    Session,
    SessionSummary,
    StimulusHistory,
    TaskQueue,
    TaskStatus,
)


# Request/Response models
class ConversationCaptureRequest(BaseModel):
    session_id: int
    personality: str
    project_path: str
    prompt: str
    message_type: str = "user"
    command_name: str | None = None
    command_args: str | None = None
    exit_code: int = 0
    is_command: bool = False
    medium: str | None = None
    user_id: str | None = None
    speaker_name: str | None = None


class SessionEndRequest(BaseModel):
    session_id: int
    exit_reason: str
    duration_seconds: int = 0


class StatusRequest(BaseModel):
    personality: str | None = None
    mcp_servers: list[str] = []
    context: bool = False
    session_type: str | None = None


class QueueAddRequest(BaseModel):
    task_type: str
    model_name: str
    content: str
    metadata: dict[str, Any] | None = None
    priority: int = 5
    session_id: int | None = None


class ContextBuildRequest(BaseModel):
    session_id: int
    project_path: str
    personality: str
    user_id: str | None = None
    context_depth: int = 5
    include_entities: bool = False
    max_tokens: int = 2000
    context_mode: str = "smart"
    current_prompt: str


class ContextGetRequest(BaseModel):
    session_id: int
    max_age_minutes: int = 30


# Response models
class CreateSessionRequest(BaseModel):
    working_dir: str
    personality: str | None = None
    medium: str = "cli"


class CreateSessionResponse(BaseModel):
    session_id: int


class FindOrCreateSessionRequest(BaseModel):
    working_dir: str
    personality: str | None = None
    medium: str = "cli"
    max_age_hours: int | None = None
    user_id: str | None = None


class FindOrCreateSessionResponse(BaseModel):
    session_id: int
    resumed: bool
    claude_session_id: str | None


class StoreMessageRequest(BaseModel):
    message: str
    role: str = "user"


class StoreMessageResponse(BaseModel):
    message_id: int


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    threshold: float = 0.7
    user_id: str | None = None


class HybridSearchRequest(BaseModel):
    query: str
    entity_values: list[str] = []
    limit: int = 10
    entity_weight: float = 0.6
    session_id: int | None = None
    user_session_id: int | None = None
    user_id: str | None = None  # For knowledge graph partitioning
    # Temporal parameters
    since: str | None = None  # ISO datetime string
    before: str | None = None  # ISO datetime string
    as_of: str | None = None  # ISO datetime string
    only_valid: bool = False  # Only currently valid facts
    # Reranking parameters
    rerank_method: str | None = None  # "mmr" or "distance"
    center_entity: str | None = None  # For distance reranking
    diversity: float = 0.5  # MMR lambda parameter  # MMR lambda parameter


class HookCaptureRequest(BaseModel):
    data: dict[str, Any]


class LLMGenerateRequest(BaseModel):
    prompt: str
    model: str = "claude-haiku-4-5"
    session_id: int | None = None
    include_context: bool = False
    medium: str | None = None  # "cli", "discord", or None for any
    isolate_session: bool = (
        False  # Use dedicated session ID to avoid polluting conversation history
    )


class PresenceRegisterRequest(BaseModel):
    medium: str
    user_id: str
    available_channels: list[dict[str, Any]]


class PresenceHeartbeatRequest(BaseModel):
    medium: str
    user_id: str


class PresenceUnregisterRequest(BaseModel):
    medium: str
    user_id: str


class RoutingDecideRequest(BaseModel):
    user_id: str
    message: str
    priority: str
    user_activity: dict[str, Any] | None = None


class NotificationDeliveredRequest(BaseModel):
    notification_id: int


class NotificationFailedRequest(BaseModel):
    notification_id: int
    error_message: str


class NotificationCreateRequest(BaseModel):
    user_id: str
    target_medium: str
    target_location: str
    message: str
    priority: str
    routing_reasoning: str
    parent_notification_id: int | None = None
    context_snapshot: dict[str, Any] | None = None
    trigger_type: str | None = None
    trigger_id: str | None = None
    trigger_data: dict[str, Any] | None = None


class SynthesisRunRequest(BaseModel):
    personality_combo: list[str]
    user_session_id: int | None = None


class SynthesisRunResponse(BaseModel):
    success: bool
    total_sessions: int
    insights_generated: int
    patterns_detected: int
    entity_collisions: int


class SynthesisInsightsRequest(BaseModel):
    personality_combo: list[str]
    limit: int = 10
    format_with_personality: bool = True


class SynthesisPatternsRequest(BaseModel):
    personality_combo: list[str]
    limit: int = 10
    format_with_personality: bool = True


class EmotionDBAdapter:
    """Adapter to provide database interface for emotion manager using SQLModel."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self.session_factory = session_factory

    async def load_emotion_state(self, session_id: int) -> dict | None:
        """Load emotion state from database."""
        async with self.session_factory() as db:
            from dere_shared.emotion.models import EmotionInstance, OCCEmotionType

            stmt = (
                select(EmotionState)
                .where(EmotionState.session_id == session_id)
                .order_by(EmotionState.last_update.desc())
                .limit(1)
            )
            result = await db.execute(stmt)
            state = result.scalar_one_or_none()
            if state and state.appraisal_data:
                # Deserialize: strings → enum keys, dict → EmotionInstance
                loaded_data = state.appraisal_data
                deserialized_emotions = {
                    OCCEmotionType(key): EmotionInstance(**value)
                    for key, value in loaded_data["active_emotions"].items()
                }
                return {
                    "active_emotions": deserialized_emotions,
                    "last_decay_time": loaded_data["last_decay_time"],
                }
            return None

    async def store_stimulus(self, session_id: int, stimulus_record) -> None:
        """Store stimulus record in database."""
        async with self.session_factory() as db:
            stimulus = StimulusHistory(
                session_id=session_id,
                stimulus_type=stimulus_record.type,
                valence=stimulus_record.valence,
                intensity=stimulus_record.intensity,
                timestamp=stimulus_record.timestamp,
                context_data=stimulus_record.context,
            )
            db.add(stimulus)
            await db.commit()

    async def store_emotion_state(
        self, session_id: int, active_emotions: dict, last_decay_time: int
    ) -> None:
        """Store emotion state in database."""
        async with self.session_factory() as db:
            from datetime import datetime

            # Serialize: enum keys → strings, EmotionInstance → dict
            serialized_emotions = {
                emotion_type.value: emotion_instance.model_dump()
                for emotion_type, emotion_instance in active_emotions.items()
            }

            state = EmotionState(
                session_id=session_id,
                appraisal_data={
                    "active_emotions": serialized_emotions,
                    "last_decay_time": last_decay_time,
                },
                last_update=datetime.now(UTC),
            )
            db.add(state)
            await db.commit()


# Global state
class AppState:
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    processor: TaskProcessor
    emotion_managers: dict[int, Any]  # session_id -> OCCEmotionManager
    ambient_monitor: Any  # AmbientMonitor
    personality_loader: Any  # PersonalityLoader
    db: Any  # EmotionDBAdapter
    dere_graph: Any  # DereGraph - knowledge graph for context


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown"""
    match platform.system():
        case "Windows":
            data_dir = Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            data_dir = Path.home() / "Library" / "Application Support" / "dere"
        case _:
            data_dir = Path.home() / ".local" / "share" / "dere"

    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "dere.db"
    pid_file = data_dir / "daemon.pid"

    # Write PID file
    pid_file.write_text(str(os.getpid()))

    # Load config
    config = load_dere_config()
    db_url = config.get("database", {}).get("url", "postgresql://postgres:dere@localhost/dere")

    # Convert to asyncpg URL if needed
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    app.state = AppState()  # type: ignore[assignment]

    # Initialize async database engine
    try:
        app.state.engine = create_engine(db_url)
        app.state.session_factory = create_session_factory(app.state.engine)
        app.state.db = EmotionDBAdapter(app.state.session_factory)
        print(f"✓ Database connected: {db_url}")
    except Exception as e:
        print("❌ FATAL: Failed to connect to database")
        print(f"   URL: {db_url}")
        print(f"   Error: {e}")
        print("\n   Make sure PostgreSQL is running:")
        print("   docker ps | grep postgres")
        raise

    app.state.processor = TaskProcessor(app.state.session_factory)
    app.state.emotion_managers = {}
    app.state.config = config

    # Initialize DereGraph for knowledge management
    graph_config = config.get("dere_graph", {})
    if graph_config.get("enabled", True):
        try:
            from dere_graph import DereGraph

            openai_key = os.getenv("OPENAI_API_KEY")
            if not openai_key:
                print("Warning: OPENAI_API_KEY not set, knowledge graph disabled")
                app.state.dere_graph = None
            else:
                # Convert asyncpg URL back to standard postgres URL for dere_graph
                postgres_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

                app.state.dere_graph = DereGraph(
                    falkor_host=graph_config.get("falkor_host", "localhost"),
                    falkor_port=graph_config.get("falkor_port", 6379),
                    falkor_database=graph_config.get("falkor_database", "dere_graph"),
                    openai_api_key=openai_key,
                    claude_model=graph_config.get("claude_model", "claude-haiku-4-5"),
                    embedding_dim=graph_config.get("embedding_dim", 1536),
                    postgres_db_url=postgres_url,
                    enable_reflection=graph_config.get("enable_reflection", True),
                    idle_threshold_minutes=graph_config.get("idle_threshold_minutes", 15),
                )
                await app.state.dere_graph.build_indices()
                print("✓ DereGraph initialized")
        except Exception as e:
            print(f"Warning: Failed to initialize DereGraph: {e}")
            app.state.dere_graph = None
    else:
        app.state.dere_graph = None

    # Initialize personality loader
    from dere_shared.personalities import PersonalityLoader

    config_dir = data_dir  # Use same dir as database for user personalities
    app.state.personality_loader = PersonalityLoader(config_dir)

    # Initialize ambient monitor
    try:
        from dere_ambient import AmbientMonitor, load_ambient_config

        ambient_config = load_ambient_config()
        # Pass llm_client from dere_graph for structured outputs
        llm_client = app.state.dere_graph.llm_client if app.state.dere_graph else None
        app.state.ambient_monitor = AmbientMonitor(
            ambient_config, llm_client=llm_client, personality_loader=app.state.personality_loader
        )
    except Exception as e:
        print(f"Warning: Failed to initialize ambient monitor: {e}")
        app.state.ambient_monitor = None

    # NOTE: Stuck task reset was removed during database simplification
    # Tasks now use proper status management and don't get stuck

    # Start task processor
    await app.state.processor.start()

    # Start ambient monitor
    if app.state.ambient_monitor:
        await app.state.ambient_monitor.start()

    # Start presence cleanup background task
    # NOTE: Automatic presence cleanup removed - heartbeat mechanism handles stale detection
    async def cleanup_presence_loop():
        """Background task placeholder for future presence maintenance."""
        while True:
            try:
                await asyncio.sleep(30)  # Every 30s
                # Presence records now cleaned up via heartbeat timeout mechanism
                pass
            except Exception as e:
                from loguru import logger

                logger.error("Presence cleanup failed: {}", e)

    cleanup_task = asyncio.create_task(cleanup_presence_loop())

    # Start emotion decay background task
    async def periodic_emotion_decay_loop():
        """Background task to apply decay to emotions during idle time and cleanup stale managers."""
        from datetime import timedelta

        from sqlalchemy import select

        while True:
            try:
                await asyncio.sleep(60)  # Every 60 seconds

                if not app.state.emotion_managers:
                    continue

                current_time = int(time.time() * 1000)
                ttl_threshold = datetime.now(UTC) - timedelta(days=7)  # 7 day TTL

                # Fetch last_activity times for all managed sessions in one query
                async with app.state.session_factory() as db:
                    stmt = select(Session.id, Session.last_activity).where(
                        Session.id.in_(list(app.state.emotion_managers.keys()))
                    )
                    result = await db.execute(stmt)
                    session_activities = {row[0]: row[1] for row in result}

                for session_id, manager in list(app.state.emotion_managers.items()):
                    # TTL cleanup: remove managers for inactive sessions
                    last_activity = session_activities.get(session_id)
                    if last_activity and last_activity < ttl_threshold:
                        from loguru import logger

                        logger.info(
                            "Removing emotion manager for inactive session {} (last active: {})",
                            session_id,
                            last_activity,
                        )
                        del app.state.emotion_managers[session_id]
                        continue

                    # Only apply decay if there are active emotions
                    if not manager.active_emotions:
                        continue

                    # Check if enough time has passed (avoid micro-decays)
                    time_since_last_decay = (current_time - manager.last_decay_time) / (1000 * 60)
                    if time_since_last_decay < 1.0:  # At least 1 minute
                        continue

                    # Apply decay
                    await manager._apply_smart_decay(current_time)

            except Exception as e:
                from loguru import logger

                logger.error("Periodic emotion decay failed: {}", e)

    emotion_decay_task = asyncio.create_task(periodic_emotion_decay_loop())

    print(f"🚀 Dere daemon started - database: {db_path}")

    yield

    # Shutdown - collect all exceptions
    errors = []

    # Cancel presence cleanup task
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

    # Cancel emotion decay task
    emotion_decay_task.cancel()
    try:
        await emotion_decay_task
    except asyncio.CancelledError:
        pass

    # Shutdown ambient monitor
    if app.state.ambient_monitor:
        try:
            await app.state.ambient_monitor.shutdown()
        except Exception as e:
            errors.append(e)

    try:
        await app.state.processor.shutdown()
    except Exception as e:
        errors.append(e)

    # Shutdown DereGraph
    if app.state.dere_graph:
        try:
            await app.state.dere_graph.close()
        except Exception as e:
            errors.append(e)

    try:
        await app.state.engine.dispose()
    except Exception as e:
        errors.append(e)

    try:
        pid_file.unlink()
    except FileNotFoundError:
        pass
    except Exception as e:
        errors.append(e)

    if errors:
        raise ExceptionGroup("Errors during shutdown", errors)

    print("👋 Dere daemon shutdown")


app = FastAPI(title="Dere Daemon", version="0.1.0", lifespan=lifespan)


# Database session dependency
async def get_db() -> AsyncSession:
    """FastAPI dependency for database sessions."""
    async for session in get_session(app.state.session_factory):
        yield session


def _get_time_of_day(hour: int) -> str:
    """Convert hour to time of day description"""
    if 5 <= hour < 12:
        return "morning"
    elif 12 <= hour < 17:
        return "afternoon"
    elif 17 <= hour < 21:
        return "evening"
    else:
        return "night"


# Helper functions for emotion system
async def get_or_create_emotion_manager(session_id: int, personality: str | None = None):
    """Get or create emotion manager for a session"""
    import json
    from pathlib import Path

    from loguru import logger

    from dere_shared.emotion.manager import OCCEmotionManager
    from dere_shared.emotion.models import OCCAttitude, OCCGoal, OCCStandard

    if session_id in app.state.emotion_managers:
        return app.state.emotion_managers[session_id]

    # Load user OCC profile from config
    goals = []
    standards = []
    attitudes = []

    user_occ_path = Path.home() / ".config" / "dere" / "user_occ.json"
    if user_occ_path.exists():
        try:
            with open(user_occ_path) as f:
                user_occ = json.load(f)

            goals = [OCCGoal(**g) for g in user_occ.get("goals", [])]
            standards = [OCCStandard(**s) for s in user_occ.get("standards", [])]
            attitudes = [OCCAttitude(**a) for a in user_occ.get("attitudes", [])]

            logger.info(
                f"[Emotion] Loaded user OCC profile: {len(goals)} goals, "
                f"{len(standards)} standards, {len(attitudes)} attitudes"
            )
        except Exception as e:
            logger.warning(f"Failed to load user OCC profile: {e}")

    # Fall back to generic user-focused defaults if no profile exists
    if not goals:
        goals = [
            OCCGoal(
                id="accomplish_tasks",
                description="Complete tasks and get things done",
                active=True,
                importance=8,
            ),
            OCCGoal(
                id="learn_and_grow",
                description="Learn new things and develop skills",
                active=True,
                importance=7,
            ),
            OCCGoal(
                id="maintain_balance",
                description="Balance work, rest, and personal life",
                active=True,
                importance=6,
            ),
        ]

    if not standards:
        standards = [
            OCCStandard(
                id="be_productive",
                description="Use time effectively and accomplish goals",
                importance=8,
                praiseworthiness=7,
            ),
            OCCStandard(
                id="be_thoughtful",
                description="Consider consequences and make good decisions",
                importance=7,
                praiseworthiness=8,
            ),
            OCCStandard(
                id="be_persistent",
                description="Keep trying despite difficulties",
                importance=6,
                praiseworthiness=7,
            ),
        ]

    if not attitudes:
        attitudes = [
            OCCAttitude(
                id="challenges",
                target_object="unexpected_challenges",
                description="Attitude toward unexpected challenges",
                appealingness=-2,
            ),
            OCCAttitude(
                id="learning",
                target_object="learning_opportunities",
                description="Attitude toward learning new things",
                appealingness=5,
            ),
            OCCAttitude(
                id="interruptions",
                target_object="interruptions",
                description="Attitude toward being interrupted during work",
                appealingness=-5,
            ),
        ]

    # Get LLM client from dere_graph if available
    llm_client = app.state.dere_graph.llm_client if app.state.dere_graph else None

    manager = OCCEmotionManager(
        goals=goals,
        standards=standards,
        attitudes=attitudes,
        session_id=session_id,
        db=app.state.db,
        llm_client=llm_client,
    )

    await manager.initialize()
    app.state.emotion_managers[session_id] = manager

    return manager


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "dere_graph": "available" if app.state.dere_graph else "unavailable",
    }


@app.post("/sessions/create", response_model=CreateSessionResponse)
async def create_session(req: CreateSessionRequest, db: AsyncSession = Depends(get_db)):
    """Create a new session"""
    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
        personality=req.personality,
        medium=req.medium,
    )

    db.add(session)
    await db.flush()
    await db.refresh(session)

    return CreateSessionResponse(session_id=session.id)


@app.post("/sessions/find_or_create", response_model=FindOrCreateSessionResponse)
async def find_or_create_session(
    req: FindOrCreateSessionRequest, db: AsyncSession = Depends(get_db)
):
    """Find existing session or create new one with continuity support.

    If an existing session is found within max_age_hours, it will be resumed.
    If an old session exists but is outside max_age_hours, a new session will
    be created with continued_from linkage for historical continuity.
    """
    from sqlmodel import select

    # Find latest session for this working_dir
    stmt = (
        select(Session)
        .where(Session.working_dir == req.working_dir)
        .order_by(Session.start_time.desc())
    )
    if req.max_age_hours is not None:
        cutoff_time = int(time.time()) - (req.max_age_hours * 3600)
        stmt = stmt.where(Session.start_time >= cutoff_time)

    result = await db.execute(stmt)
    existing = result.scalars().first()

    if existing and req.max_age_hours is not None:
        return FindOrCreateSessionResponse(
            session_id=existing.id,
            resumed=True,
            claude_session_id=existing.claude_session_id,
        )

    if existing and req.max_age_hours is None:
        return FindOrCreateSessionResponse(
            session_id=existing.id,
            resumed=True,
            claude_session_id=existing.claude_session_id,
        )

    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
        continued_from=existing.id if existing else None,
        personality=req.personality,
        medium=req.medium,
        user_id=req.user_id,
    )

    db.add(session)
    await db.flush()
    await db.refresh(session)

    return FindOrCreateSessionResponse(session_id=session.id, resumed=False, claude_session_id=None)


@app.post("/sessions/{session_id}/claude_session")
async def update_claude_session(
    session_id: int, claude_session_id: str = Body(...), db: AsyncSession = Depends(get_db)
):
    """Update the Claude SDK session ID for a daemon session.

    This is called after creating a ClaudeSDKClient and capturing its session ID
    from the first system init message.
    """
    from sqlmodel import select

    logger.info(
        "Received claude_session_id update: session_id={}, claude_session_id={}",
        session_id,
        claude_session_id,
    )

    stmt = select(Session).where(Session.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one()

    session.claude_session_id = claude_session_id
    await db.flush()

    logger.info("Successfully updated claude_session_id for session {}", session_id)
    return {"status": "updated"}


def should_extract_bot_message(message: str) -> tuple[bool, str]:
    """Check if bot message is worth extracting and return filtered version.

    Returns:
        (should_extract, filtered_message)
    """
    import re

    # Count code blocks
    code_blocks = len(re.findall(r"```[\s\S]*?```", message))

    # Remove code blocks for analysis
    filtered = re.sub(r"```[\s\S]*?```", "", message)
    filtered = re.sub(r"`[^`]+`", "", filtered)

    # Strip whitespace
    filtered = filtered.strip()

    # Skip if mostly code (little text left after filtering)
    if len(filtered) < 50 and code_blocks > 0:
        return (False, "")

    # Skip if just acknowledgment/tool output
    if filtered.lower() in ["done", "ok", "completed", "fixed"]:
        return (False, "")

    return (True, filtered)


@app.post("/sessions/{session_id}/message", response_model=StoreMessageResponse)
async def store_message(
    session_id: int,
    req: StoreMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    """Store a message"""
    conv = Conversation(
        session_id=session_id,
        prompt=req.message,
        message_type=req.role,
        timestamp=int(time.time()),
    )

    db.add(conv)
    await db.flush()
    await db.refresh(conv)

    # Add assistant messages to knowledge graph (filtered)
    if req.role == "assistant" and app.state.dere_graph:
        should_extract, filtered_msg = should_extract_bot_message(req.message)
        if should_extract:
            import asyncio

            async def process_bot_message():
                from datetime import datetime

                from loguru import logger

                try:
                    from dere_graph.models import EpisodeType

                    # Extract context from most recent user message
                    stmt_conv = (
                        select(Conversation)
                        .where(
                            Conversation.session_id == session_id,
                            Conversation.message_type == MessageType.user,
                        )
                        .order_by(Conversation.timestamp.desc())
                        .limit(1)
                    )
                    result_conv = await db.execute(stmt_conv)
                    last_user_msg = result_conv.scalar_one_or_none()

                    # Determine medium, personality, and user_id
                    medium = last_user_msg.medium if last_user_msg else "cli"
                    user_id = last_user_msg.user_id if last_user_msg else "default"
                    personality = "assistant"  # Default, could extract from context

                    await app.state.dere_graph.add_episode(
                        episode_body=filtered_msg,
                        source_description=f"{medium} conversation",
                        reference_time=datetime.fromtimestamp(conv.timestamp),
                        source=EpisodeType.message,
                        group_id=user_id or "default",
                        speaker_id=personality,
                        speaker_name=personality,
                        personality=personality,
                    )
                except Exception as e:
                    logger.error(f"Failed to add bot message to knowledge graph: {e}")

            asyncio.create_task(process_bot_message())

    return StoreMessageResponse(message_id=conv.id)


@app.get("/sessions/{session_id}/history")
async def get_history(session_id: int, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Get conversation history for a session"""
    from sqlmodel import select

    stmt = (
        select(Conversation)
        .where(Conversation.session_id == session_id)
        .order_by(Conversation.timestamp.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()

    return {
        "messages": [
            {
                "id": msg.id,
                "prompt": msg.prompt,
                "message_type": msg.message_type,
                "timestamp": msg.timestamp,
            }
            for msg in messages
        ]
    }


@app.get("/sessions/{session_id}/last_message_time")
async def get_last_message_time(session_id: int, db: AsyncSession = Depends(get_db)):
    """Get timestamp of most recent conversation message in session"""
    from sqlmodel import select

    stmt = (
        select(Conversation.created_at)
        .where(Conversation.session_id == session_id)
        .order_by(Conversation.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    timestamp = result.scalar_one_or_none()

    if timestamp:
        return {"session_id": session_id, "last_message_time": int(timestamp.timestamp())}
    return {"session_id": session_id, "last_message_time": None}


@app.post("/search/similar")
async def search_similar(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Search for similar conversations using vector similarity"""

    if not app.state.dere_graph:
        return {"results": []}

    try:
        search_results = await app.state.dere_graph.search(
            query=req.query,
            group_id=req.user_id or "default",
            limit=req.limit,
        )

        # Format as conversation-like results
        results = []
        for edge in search_results.edges:
            results.append(
                {
                    "id": edge.uuid,
                    "session_id": None,
                    "prompt": edge.fact,
                    "message_type": "knowledge",
                    "timestamp": int(edge.created_at.timestamp()) if edge.created_at else 0,
                    "similarity": 0.9,
                }
            )

        return {"results": results}
    except Exception as e:
        from loguru import logger

        logger.error(f"Knowledge graph search failed: {e}")
        return {"results": []}


@app.post("/embeddings/generate")
async def generate_embedding(text: str):
    """Generate embedding for text using dere_graph"""
    if not app.state.dere_graph:
        return {"error": "dere_graph not available"}, 503

    try:
        embedding = await app.state.dere_graph.embedder.create(text)
        return {"embedding": embedding, "model": "text-embedding-3-small"}
    except Exception as e:
        from loguru import logger

        logger.error(f"Embedding generation failed: {e}")
        return {"error": str(e)}, 500


@app.post("/search/hybrid")
async def search_hybrid(req: HybridSearchRequest, db: AsyncSession = Depends(get_db)):
    """Hybrid search using entities and embeddings.

    Supports cross-medium search:
    - If user_session_id provided: search across all sessions in user_session
    - If session_id provided: resolve user_session_id and search across all sessions
    - Otherwise: search all conversations
    """

    # Use knowledge graph search instead of embeddings
    if not app.state.dere_graph:
        return {"results": []}

    try:
        from datetime import datetime

        from dere_graph.filters import ComparisonOperator, DateFilter, SearchFilters

        # Build temporal filters
        filters = None
        if req.since or req.before or req.as_of or req.only_valid:
            filters = SearchFilters()

            if req.since:
                filters.created_at = DateFilter(
                    operator=ComparisonOperator.GREATER_THAN_EQUAL,
                    value=datetime.fromisoformat(req.since.replace("Z", "+00:00")),
                )

            if req.before:
                filters.created_at = DateFilter(
                    operator=ComparisonOperator.LESS_THAN_EQUAL,
                    value=datetime.fromisoformat(req.before.replace("Z", "+00:00")),
                )

            if req.only_valid:
                filters.invalid_at = DateFilter(operator=ComparisonOperator.IS_NULL)

        # Resolve center entity if provided
        center_node_uuid = None
        if req.center_entity and req.rerank_method == "distance":
            entity_search = await app.state.dere_graph.search(
                query=req.center_entity,
                group_id=req.user_id or "default",
                limit=1,
            )
            if entity_search.nodes:
                center_node_uuid = entity_search.nodes[0].uuid

        # Execute search with filters and reranking
        search_results = await app.state.dere_graph.search(
            query=req.query,
            group_id=req.user_id or "default",
            limit=req.limit,
            filters=filters,
            center_node_uuid=center_node_uuid,
            rerank_method=req.rerank_method,
            lambda_param=req.diversity if req.rerank_method == "mmr" else 0.5,
            recency_weight=0.3,  # Always give slight boost to recent
        )

        # Format results
        results = []
        for edge in search_results.edges:
            results.append(
                {
                    "id": edge.uuid,
                    "session_id": None,
                    "prompt": edge.fact,
                    "message_type": "knowledge",
                    "timestamp": int(edge.created_at.timestamp()) if edge.created_at else 0,
                    "working_dir": None,
                    "medium": None,
                    "entity_score": 0.0,
                    "semantic_score": 0.9,
                    "recency_score": 0.5,
                    "combined_score": 0.8,
                }
            )

        return {"results": results, "entity_values": req.entity_values}
    except Exception as e:
        from loguru import logger

        logger.error(f"Hybrid search failed: {e}")
        return {"results": [], "entity_values": req.entity_values}


@app.get("/kg/entity/{entity_name}")
async def get_entity_info(entity_name: str, user_id: str | None = None):
    """Get information about an entity from the knowledge graph"""
    if not app.state.dere_graph:
        return {"error": "Knowledge graph not available"}, 503

    try:
        # Search for the entity
        results = await app.state.dere_graph.search(
            query=entity_name,
            group_id=user_id or "default",
            limit=10,
        )

        # Find exact matches in nodes
        entity_nodes = [n for n in results.nodes if entity_name.lower() in n.name.lower()]

        if not entity_nodes:
            return {"entity": entity_name, "found": False, "nodes": [], "edges": []}

        # Get the primary entity node
        primary_node = entity_nodes[0]

        # Get related entities via BFS
        related_results = await app.state.dere_graph.bfs_search_nodes(
            origin_uuids=[primary_node.uuid],
            group_id=user_id or "default",
            max_depth=1,
            limit=20,
        )

        return {
            "entity": entity_name,
            "found": True,
            "primary_node": {
                "uuid": primary_node.uuid,
                "name": primary_node.name,
                "labels": primary_node.labels,
                "created_at": primary_node.created_at.isoformat()
                if primary_node.created_at
                else None,
            },
            "related_nodes": [
                {
                    "uuid": n.uuid,
                    "name": n.name,
                    "labels": n.labels,
                }
                for n in related_results.nodes
                if n.uuid != primary_node.uuid
            ],
            "relationships": [
                {
                    "uuid": e.uuid,
                    "fact": e.fact,
                    "source": e.source_node_uuid,
                    "target": e.target_node_uuid,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in related_results.edges
            ],
        }
    except Exception as e:
        logger.error(f"Entity info retrieval failed: {e}")
        return {"error": str(e)}, 500


@app.get("/kg/entity/{entity_name}/related")
async def get_related_entities(entity_name: str, user_id: str | None = None, limit: int = 20):
    """Get entities related to the given entity via knowledge graph"""
    if not app.state.dere_graph:
        return {"error": "Knowledge graph not available"}, 503

    try:
        # Search for the entity
        search_results = await app.state.dere_graph.search(
            query=entity_name,
            group_id=user_id or "default",
            limit=1,
        )

        if not search_results.nodes:
            return {"entity": entity_name, "found": False, "related": []}

        primary_node = search_results.nodes[0]

        # Get related entities via BFS
        related_results = await app.state.dere_graph.bfs_search_nodes(
            origin_uuids=[primary_node.uuid],
            group_id=user_id or "default",
            max_depth=2,
            limit=limit,
        )

        return {
            "entity": entity_name,
            "found": True,
            "related": [
                {
                    "name": n.name,
                    "labels": n.labels,
                    "uuid": n.uuid,
                }
                for n in related_results.nodes
                if n.uuid != primary_node.uuid
            ],
        }
    except Exception as e:
        logger.error(f"Related entities retrieval failed: {e}")
        return {"error": str(e)}, 500


@app.post("/conversation/capture")
async def conversation_capture(req: ConversationCaptureRequest, db: AsyncSession = Depends(get_db)):
    """Capture conversation and queue background tasks"""
    from sqlalchemy import select

    # Ensure session exists
    stmt = select(Session).where(Session.id == req.session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        session = Session(
            id=req.session_id,
            working_dir=req.project_path or "",
            start_time=int(time.time()),
            last_activity=datetime.now(UTC),
        )
        db.add(session)
        await db.flush()

    # Store conversation
    conv = Conversation(
        session_id=req.session_id,
        prompt=req.prompt,
        message_type=MessageType(req.message_type),
        embedding_text="",
        processing_mode="raw",
        timestamp=int(time.time()),
        medium=req.medium,
        user_id=req.user_id,
    )
    db.add(conv)
    await db.flush()
    conversation_id = conv.id

    # Queue background processing (don't block response)
    if req.message_type == "user":
        import asyncio

        async def process_background():
            from datetime import datetime

            from loguru import logger

            # Add to knowledge graph if enabled
            if app.state.dere_graph:
                try:
                    from dere_graph.models import EpisodeType

                    # Use canonical user name from config
                    canonical_user_name = app.state.config.get("user", {}).get("name", "User")

                    await app.state.dere_graph.add_episode(
                        episode_body=req.prompt,
                        source_description=f"{req.medium or 'cli'} conversation",
                        reference_time=datetime.fromtimestamp(conv.timestamp),
                        source=EpisodeType.message,
                        group_id=req.user_id or "default",
                        speaker_id=req.user_id,
                        speaker_name=canonical_user_name,
                        personality=req.personality,
                    )
                except Exception:
                    logger.exception("Failed to add episode to knowledge graph")

            # Process emotion
            try:
                emotion_manager = await get_or_create_emotion_manager(
                    req.session_id, req.personality
                )

                # Build stimulus from conversation
                stimulus = {
                    "type": "user_message",
                    "content": req.prompt,
                    "message_type": req.message_type,
                }

                # Enrich context with temporal and session information
                now = datetime.now()

                # Get session info using session_factory
                async with app.state.session_factory() as bg_session:
                    stmt = select(Session).where(Session.id == req.session_id)
                    result = await bg_session.execute(stmt)
                    session_obj = result.scalar_one_or_none()
                    session_start = session_obj.start_time if session_obj else None

                # Calculate session duration
                session_duration_minutes = 0
                if session_start:
                    session_duration_minutes = (now.timestamp() - session_start) / 60

                context = {
                    "conversation_id": conversation_id,
                    "personality": req.personality,
                    "temporal": {
                        "hour": now.hour,
                        "day_of_week": now.strftime("%A"),
                        "time_of_day": _get_time_of_day(now.hour),
                    },
                    "session": {
                        "duration_minutes": int(session_duration_minutes),
                        "working_dir": session_obj.working_dir if session_obj else None,
                    },
                }

                # Process stimulus through emotion system
                await emotion_manager.process_stimulus(stimulus, context, req.personality or "AI")

            except Exception as e:
                logger.error(f"[conversation_capture] Emotion processing failed: {e}")

        # Fire and forget - don't await
        asyncio.create_task(process_background())

    return {"status": "stored"}


@app.post("/session/end")
async def session_end(req: SessionEndRequest, db: AsyncSession = Depends(get_db)):
    """Handle session end and queue summarization"""
    from sqlalchemy import select, update

    # Get recent session content (last 30 minutes or last 50 messages)
    thirty_minutes_ago = int(time.time()) - 1800

    stmt = (
        select(Conversation.prompt, Conversation.message_type)
        .where(Conversation.session_id == req.session_id)
        .where(Conversation.timestamp >= thirty_minutes_ago)
        .order_by(Conversation.timestamp.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return {"status": "skipped", "reason": "no_content"}

    # Build content from messages
    content = "\n".join([f"{row.message_type}: {row.prompt}" for row in reversed(rows)])

    # Mark session as ended first
    stmt = update(Session).where(Session.id == req.session_id).values(end_time=int(time.time()))
    await db.execute(stmt)

    # Generate summary directly if dere_graph available
    if app.state.dere_graph:
        try:
            summary_prompt = f"""Summarize this conversation session in 2-3 concise sentences:

{content[:2000]}

Focus on:
1. Main topics discussed
2. Key outcomes or decisions
3. What should be followed up on

Summary:"""

            summary = await app.state.dere_graph.llm_client.generate_text_response(summary_prompt)
            summary = summary.strip()
            if summary.startswith("Summary:"):
                summary = summary.replace("Summary:", "").strip()

            # Store in SessionSummary table
            session_summary = SessionSummary(
                session_id=req.session_id,
                summary_type="session_end",
                summary=summary,
                model_used=app.state.dere_graph.llm_client.model,
            )
            db.add(session_summary)
            await db.flush()

            logger.info(f"Generated session summary for session {req.session_id}")
        except Exception as e:
            logger.error(f"Failed to generate session summary: {e}")
            # Continue anyway - summary is nice-to-have

    return {"status": "ended", "summary_generated": app.state.dere_graph is not None}


@app.post("/status/get")
async def status_get(req: StatusRequest, db: AsyncSession = Depends(get_db)):
    """Get daemon and queue status"""
    from sqlalchemy import func, select

    # Get queue stats
    stmt = select(
        TaskQueue.status,
        func.count(TaskQueue.id).label("count"),
    ).group_by(TaskQueue.status)
    result = await db.execute(stmt)
    rows = result.all()

    queue_stats = {row.status: row.count for row in rows}
    queue_stats.setdefault(TaskStatus.PENDING, 0)
    queue_stats.setdefault(TaskStatus.PROCESSING, 0)
    queue_stats.setdefault(TaskStatus.COMPLETED, 0)
    queue_stats.setdefault(TaskStatus.FAILED, 0)

    status = {"daemon": "running", "queue": queue_stats}

    if req.personality:
        status["personality"] = req.personality
    if req.mcp_servers:
        status["mcp_servers"] = req.mcp_servers
    if req.context:
        status["context_enabled"] = True
    if req.session_type:
        status["session_type"] = req.session_type

    return status


@app.post("/queue/add")
async def queue_add(req: QueueAddRequest, db: AsyncSession = Depends(get_db)):
    """Add task to processing queue"""
    task = TaskQueue(
        task_type=req.task_type,
        model_name=req.model_name,
        content=req.content,
        task_metadata=req.metadata,
        priority=req.priority,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    db.add(task)
    await db.flush()

    return {"task_id": task.id, "status": "queued"}


@app.get("/queue/status")
async def queue_status(db: AsyncSession = Depends(get_db)):
    """Get queue statistics"""
    from sqlalchemy import func, select

    stmt = select(
        TaskQueue.status,
        func.count(TaskQueue.id).label("count"),
    ).group_by(TaskQueue.status)
    result = await db.execute(stmt)
    rows = result.all()

    stats = {row.status: row.count for row in rows}
    stats.setdefault(TaskStatus.PENDING, 0)
    stats.setdefault(TaskStatus.PROCESSING, 0)
    stats.setdefault(TaskStatus.COMPLETED, 0)
    stats.setdefault(TaskStatus.FAILED, 0)

    return stats


@app.post("/context/build")
async def context_build(req: ContextBuildRequest, db: AsyncSession = Depends(get_db)):
    """Build context using knowledge graph search"""
    from sqlalchemy import select

    # Ensure session exists
    stmt = select(Session).where(Session.id == req.session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        session = Session(
            id=req.session_id,
            working_dir=req.project_path or "",
            start_time=int(time.time()),
            last_activity=datetime.now(UTC),
        )
        db.add(session)
        await db.flush()

    # Set defaults
    context_depth = req.context_depth or 5

    # Use knowledge graph if available
    if app.state.dere_graph:
        try:
            from datetime import timedelta

            from dere_graph.filters import ComparisonOperator, DateFilter, SearchFilters

            # Build temporal filter for last 7 days
            filters = SearchFilters(
                created_at=DateFilter(
                    operator=ComparisonOperator.GREATER_THAN,
                    value=datetime.now() - timedelta(days=7),
                )
            )

            # Step 1: Get relevant recent facts with episode-mentions reranking
            # This prioritizes frequently mentioned entities for better context
            search_results = await app.state.dere_graph.search(
                query=req.current_prompt,
                group_id=req.user_id or "default",
                limit=context_depth * 2,  # Get more for BFS expansion
                filters=filters,
                rerank_method="episode_mentions",  # Boost frequently mentioned entities
                rerank_alpha=0.5,  # Balance between frequency and base relevance
                recency_weight=0.3,  # Slight recency boost
            )

            # Step 2: BFS expansion for related concepts
            if search_results.nodes:
                origin_uuids = [n.uuid for n in search_results.nodes[:3]]
                related_nodes = await app.state.dere_graph.bfs_search_nodes(
                    origin_uuids=origin_uuids,
                    group_id=req.user_id or "default",
                    max_depth=2,
                    limit=context_depth,
                )

                # Merge and deduplicate
                all_nodes = search_results.nodes + related_nodes
                seen_uuids = set()
                unique_nodes = []
                for node in all_nodes:
                    if node.uuid not in seen_uuids:
                        seen_uuids.add(node.uuid)
                        unique_nodes.append(node)

                search_results.nodes = unique_nodes[:context_depth]

            # Format results into context text
            context_parts = []

            # Add entity context
            if search_results.nodes:
                context_parts.append("# Relevant Entities")
                for node in search_results.nodes:
                    context_parts.append(f"- {node.name}: {node.summary}")

            # Add relationship context
            if search_results.edges:
                context_parts.append("\n# Relevant Facts")
                for edge in search_results.edges:
                    context_parts.append(f"- {edge.fact}")

            context_text = "\n".join(context_parts) if context_parts else ""

            # Cache the result
            cache = ContextCache(
                session_id=req.session_id,
                context_text=context_text,
                created_at=datetime.now(),
            )
            db.add(cache)
            await db.commit()

            return {"status": "ready", "context": context_text}

        except Exception as e:
            from loguru import logger

            logger.error(f"Knowledge graph search failed: {e}")
            return {"status": "error", "context": "", "error": str(e)}

    # Fallback: return empty context if graph unavailable
    return {"status": "unavailable", "context": ""}


@app.post("/context/get")
async def context_get(req: ContextGetRequest, db: AsyncSession = Depends(get_db)):
    """Get cached context for session (body)"""
    from sqlalchemy import select

    max_age = req.max_age_minutes or 30
    max_age_seconds = max_age * 60
    min_timestamp = datetime.fromtimestamp(int(time.time()) - max_age_seconds)

    stmt = (
        select(ContextCache.context_text)
        .where(ContextCache.session_id == req.session_id)
        .where(ContextCache.created_at >= min_timestamp)
        .order_by(ContextCache.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    context = result.scalar_one_or_none()

    return {"found": context is not None, "context": context or ""}


@app.get("/emotion/state/{session_id}")
async def emotion_get_state(session_id: int):
    """Get current emotional state for a session"""
    try:
        emotion_manager = await get_or_create_emotion_manager(session_id)
        mood = emotion_manager.get_current_mood()

        if not mood:
            return {"has_emotion": False, "state": "neutral"}

        return {
            "has_emotion": True,
            "dominant_emotion": mood.dominant_emotion_type,
            "intensity": mood.intensity,
            "last_updated": mood.last_updated,
            "active_emotions": {
                str(k): {"intensity": v.intensity, "last_updated": v.last_updated}
                for k, v in emotion_manager.get_active_emotions().items()
            },
        }
    except Exception as e:
        from loguru import logger

        logger.error(f"[emotion_get_state] Error: {e}")
        return {"error": str(e)}, 500


@app.get("/emotion/summary/{session_id}")
async def emotion_get_summary(session_id: int):
    """Get human-readable emotion summary for prompt injection"""
    try:
        emotion_manager = await get_or_create_emotion_manager(session_id)
        summary = emotion_manager.get_emotional_state_summary()

        return {"summary": summary}
    except Exception as e:
        from loguru import logger

        logger.error(f"[emotion_get_summary] Error: {e}")
        return {"summary": "Currently in a neutral emotional state."}


@app.post("/hooks/capture")
async def hook_capture(req: HookCaptureRequest):
    """Hook endpoint for capturing conversation data"""
    # Store the hook data
    return {"status": "received"}


@app.post("/llm/generate")
async def llm_generate(req: LLMGenerateRequest):
    """Generate LLM response with optional personality/emotion context using Claude CLI."""
    import asyncio

    from dere_daemon.context import compose_session_context

    try:
        prompt = req.prompt

        # Optionally inject personality + emotion context
        if req.include_context:
            context, resolved_session_id = await compose_session_context(
                session_id=req.session_id,
                session_factory=app.state.session_factory,
                personality_loader=app.state.personality_loader,
                medium=req.medium,
                include_emotion=True,
            )
            if context:
                prompt = f"{context}\n\n{prompt}"
                logger.debug(
                    "Injected context for session {} (medium: {})",
                    resolved_session_id,
                    req.medium or "any",
                )

        # Build claude command
        cmd = [
            "claude",
            "--print",
            "--output-format",
            "json",
            "-p",
            prompt,
            "--model",
            req.model,
        ]

        # For isolated calls (ambient, emotion), run from temp dir to avoid polluting history
        # This ensures internal LLM calls don't interfere with user's -c
        temp_dir = None
        if req.isolate_session:
            import tempfile

            temp_dir = Path(tempfile.gettempdir()) / "dere_internal"
            temp_dir.mkdir(exist_ok=True)

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(temp_dir) if temp_dir else None,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode()
            logger.error("Claude CLI failed: {}", error_msg)
            return {"error": error_msg}

        response_text = stdout.decode()
        return {"response": response_text}
    except Exception as e:
        logger.error("LLM generation failed: {}", e)
        return {"error": str(e)}


@app.post("/presence/register")
async def presence_register(req: PresenceRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a medium as online with available channels.

    Used by Discord/Telegram/etc bots to announce they are online and ready to receive messages.

    Future: Telegram integration
    Pattern for implementing additional mediums (e.g., Telegram, Slack, etc.):
    1. Create bot client similar to Discord's DereDiscordClient
    2. Call this endpoint on startup with medium="telegram"
    3. Provide available_channels with chat IDs and metadata
    4. Send heartbeats every 30s via /presence/heartbeat
    5. Poll /notifications/pending with medium="telegram" query param
    6. Deliver notifications via bot API (e.g., Telegram send_message)
    7. Link sessions with user_id for cross-medium continuity
    """
    from sqlalchemy import select, update

    logger.info(
        "Presence registered: {} for user {} with {} channels",
        req.medium,
        req.user_id,
        len(req.available_channels),
    )

    # Check if presence already exists
    stmt = select(Presence).where(
        Presence.medium == req.medium,
        Presence.user_id == req.user_id,
    )
    result = await db.execute(stmt)
    presence = result.scalar_one_or_none()

    if presence:
        stmt = (
            update(Presence)
            .where(Presence.medium == req.medium, Presence.user_id == req.user_id)
            .values(
                available_channels=req.available_channels,
                last_heartbeat=datetime.now(UTC),
            )
        )
        await db.execute(stmt)
    else:
        presence = Presence(
            medium=req.medium,
            user_id=req.user_id,
            available_channels=req.available_channels,
            last_heartbeat=datetime.now(UTC),
        )
        db.add(presence)

    return {"status": "registered"}


@app.post("/presence/heartbeat")
async def presence_heartbeat(req: PresenceHeartbeatRequest, db: AsyncSession = Depends(get_db)):
    """Heartbeat to keep medium alive.

    Bots should call this every 30s to maintain presence.
    """
    from sqlalchemy import update

    stmt = (
        update(Presence)
        .where(Presence.medium == req.medium, Presence.user_id == req.user_id)
        .values(last_heartbeat=datetime.now(UTC))
    )
    await db.execute(stmt)
    return {"status": "ok"}


@app.post("/presence/unregister")
async def presence_unregister(req: PresenceUnregisterRequest, db: AsyncSession = Depends(get_db)):
    """Cleanly unregister a medium on shutdown."""
    from sqlalchemy import delete

    logger.info("Presence unregistered: {} for user {}", req.medium, req.user_id)

    stmt = delete(Presence).where(
        Presence.medium == req.medium,
        Presence.user_id == req.user_id,
    )
    await db.execute(stmt)
    return {"status": "unregistered"}


@app.get("/presence/available")
async def presence_available(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get all online mediums for a user.

    Returns mediums that can currently receive messages.
    """
    from datetime import timedelta

    from sqlalchemy import select

    # Consider presence stale after 60 seconds
    stale_threshold = datetime.now(UTC) - timedelta(seconds=60)

    stmt = (
        select(Presence)
        .where(Presence.user_id == user_id)
        .where(Presence.last_heartbeat >= stale_threshold)
    )
    result = await db.execute(stmt)
    presences = result.scalars().all()

    mediums = [
        {
            "medium": p.medium,
            "available_channels": json.loads(p.available_channels) if p.available_channels else [],
            "last_heartbeat": p.last_heartbeat,
        }
        for p in presences
    ]
    return {"mediums": mediums}


@app.post("/routing/decide")
async def routing_decide(req: RoutingDecideRequest, db: AsyncSession = Depends(get_db)):
    """Use LLM to decide where to route a message based on context.

    This is the core of omnipresent routing - NO hardcoded rules.
    LLM analyzes available mediums, user activity, recent conversations,
    and makes an intelligent decision about where to deliver the message.
    """
    from datetime import timedelta

    from sqlalchemy import select

    from dere_daemon.routing import decide_routing

    # Get available mediums
    stale_threshold = datetime.now(UTC) - timedelta(seconds=60)
    stmt = (
        select(Presence)
        .where(Presence.user_id == req.user_id)
        .where(Presence.last_heartbeat >= stale_threshold)
    )
    result = await db.execute(stmt)
    presences = result.scalars().all()

    available_mediums = [
        {
            "medium": p.medium,
            "available_channels": p.available_channels if p.available_channels else [],
            "last_heartbeat": p.last_heartbeat,
        }
        for p in presences
    ]

    # Get recent conversations to understand where user has been active
    stmt = (
        select(Conversation.medium, Conversation.timestamp, Conversation.prompt)
        .where(Conversation.user_id == req.user_id)
        .where(Conversation.medium.is_not(None))
        .order_by(Conversation.timestamp.desc())
        .limit(10)
    )
    result = await db.execute(stmt)
    rows = result.all()

    recent_conversations = [
        {"medium": row.medium, "timestamp": row.timestamp, "prompt": row.prompt} for row in rows
    ]

    # Make routing decision (pass session_factory instead of db)
    llm_client = app.state.dere_graph.llm_client if app.state.dere_graph else None
    decision = await decide_routing(
        user_id=req.user_id,
        message=req.message,
        priority=req.priority,
        available_mediums=available_mediums,
        user_activity=req.user_activity,
        recent_conversations=recent_conversations,
        session_factory=app.state.session_factory,
        llm_client=llm_client,
    )

    return {
        "medium": decision.medium,
        "location": decision.location,
        "reasoning": decision.reasoning,
        "fallback": decision.fallback,
    }


@app.post("/notifications/create")
async def notifications_create(req: NotificationCreateRequest, db: AsyncSession = Depends(get_db)):
    """Create a notification in the queue for delivery.

    Called by ambient monitor when it decides to engage.
    """
    from dere_shared.models import NotificationContext

    notification = Notification(
        user_id=req.user_id,
        target_medium=req.target_medium,
        target_location=req.target_location,
        message=req.message,
        priority=req.priority,
        routing_reasoning=req.routing_reasoning,
        status="pending",
        created_at=datetime.now(UTC),
        parent_notification_id=req.parent_notification_id,
    )
    db.add(notification)
    await db.flush()

    if req.context_snapshot or req.trigger_type:
        notif_context = NotificationContext(
            notification_id=notification.id,
            trigger_type=req.trigger_type,
            trigger_id=req.trigger_id,
            trigger_data=req.trigger_data,
            context_snapshot=req.context_snapshot,
        )
        db.add(notif_context)

    await db.commit()

    # Truncate message for logging
    message_preview = req.message[:100] + "..." if len(req.message) > 100 else req.message
    logger.info(
        "Notification {} created: {} -> {} ({}) | \"{}\"",
        notification.id,
        req.target_medium,
        req.target_location,
        req.priority,
        message_preview,
    )
    return {"notification_id": notification.id, "status": "queued"}


class NotificationQueryRequest(BaseModel):
    user_id: str
    since: str


@app.post("/notifications/recent_unacknowledged")
async def notifications_recent_unacknowledged(
    req: NotificationQueryRequest, db: AsyncSession = Depends(get_db)
):
    """Query recent unacknowledged notifications for escalation context.

    Returns notifications that were delivered but not acknowledged within the lookback period.
    """
    from datetime import datetime

    from sqlalchemy import select

    since_time = datetime.fromisoformat(req.since)

    stmt = (
        select(Notification)
        .where(
            Notification.user_id == req.user_id,
            Notification.created_at >= since_time,
            Notification.status == "delivered",
            ~Notification.acknowledged,
        )
        .order_by(Notification.created_at.desc())
        .limit(10)
    )

    result = await db.execute(stmt)
    notifications = result.scalars().all()

    return {
        "notifications": [
            {
                "id": n.id,
                "message": n.message,
                "priority": n.priority,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "delivered_at": n.delivered_at.isoformat() if n.delivered_at else None,
                "status": n.status,
                "acknowledged": n.acknowledged,
                "parent_notification_id": n.parent_notification_id,
            }
            for n in notifications
        ]
    }


@app.get("/conversations/last_dm/{user_id}")
async def get_last_dm_message(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get the last message exchanged in Discord DMs with this user.

    Used by ambient monitor to provide conversation continuity context.
    """
    from sqlalchemy import select

    stmt = (
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .where(Conversation.medium == "discord")
        .order_by(Conversation.timestamp.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    last_msg = result.scalar_one_or_none()

    if last_msg:
        import time

        minutes_ago = int((time.time() - last_msg.timestamp) / 60)
        return {
            "message": last_msg.prompt,
            "message_type": last_msg.message_type,
            "timestamp": last_msg.timestamp,
            "minutes_ago": minutes_ago,
            "session_id": last_msg.session_id,
        }
    return {"message": None}


@app.get("/notifications/pending")
async def notifications_pending(medium: str, db: AsyncSession = Depends(get_db)):
    """Get pending notifications for a specific medium.

    Bots poll this endpoint to retrieve messages that need to be delivered.
    """
    from sqlalchemy import select

    stmt = (
        select(Notification)
        .where(Notification.target_medium == medium)
        .where(Notification.status == "pending")
        .order_by(Notification.priority.desc(), Notification.created_at.asc())
    )
    result = await db.execute(stmt)
    notifications = result.scalars().all()

    return {
        "notifications": [
            {
                "id": n.id,
                "user_id": n.user_id,
                "target_location": n.target_location,
                "message": n.message,
                "priority": n.priority,
                "routing_reasoning": n.routing_reasoning,
                "created_at": n.created_at,
            }
            for n in notifications
        ]
    }


@app.post("/notifications/{notification_id}/delivered")
async def notification_delivered(notification_id: int, db: AsyncSession = Depends(get_db)):
    """Mark a notification as successfully delivered.

    Called by bots after successfully sending a message.
    """
    from sqlalchemy import update

    stmt = (
        update(Notification)
        .where(Notification.id == notification_id)
        .values(
            status="delivered",
            delivered_at=datetime.now(UTC),
        )
    )
    await db.execute(stmt)

    logger.info("Notification {} marked as delivered", notification_id)
    return {"status": "delivered"}


@app.post("/notifications/{notification_id}/acknowledge")
async def notification_acknowledge(notification_id: int, db: AsyncSession = Depends(get_db)):
    """Mark a notification as acknowledged by the user.

    Called when user responds/interacts after receiving notification.
    This prevents escalation of the notification.
    """
    from sqlalchemy import update

    stmt = (
        update(Notification)
        .where(Notification.id == notification_id)
        .values(
            acknowledged=True,
            acknowledged_at=datetime.now(UTC),
        )
    )
    await db.execute(stmt)
    await db.commit()

    logger.info("Notification {} acknowledged by user", notification_id)
    return {"status": "acknowledged"}


@app.post("/notifications/{notification_id}/failed")
async def notification_failed(
    notification_id: int, req: NotificationFailedRequest, db: AsyncSession = Depends(get_db)
):
    """Mark a notification as failed with error message.

    Called by bots when message delivery fails.
    """
    from sqlalchemy import update

    stmt = (
        update(Notification)
        .where(Notification.id == notification_id)
        .values(
            status="failed",
            error_message=req.error_message,
            delivered_at=datetime.now(UTC),
        )
    )
    await db.execute(stmt)

    logger.warning("Notification {} failed: {}", notification_id, req.error_message)
    return {"status": "failed"}


@app.post("/api/consolidate/memory")
async def consolidate_memory(
    user_id: str,
    recency_days: int = 30,
    model: str = "gemma3n:latest",
    db: AsyncSession = Depends(get_db),
):
    """Trigger memory consolidation for a user.

    Analyzes entity patterns, generates LLM summary, stores insights.

    Args:
        user_id: User ID to consolidate memory for
        recency_days: Number of days to look back
        model: Model to use for summary generation

    Returns:
        Consolidation summary and statistics
    """
    # Queue memory consolidation task
    task = TaskQueue(
        task_type="memory_consolidation",
        model_name=model,
        content=f"Memory consolidation for user {user_id}",
        session_id=None,
        task_metadata={"user_id": user_id, "recency_days": recency_days},
        priority=5,
        status=TaskStatus.PENDING,
    )
    db.add(task)
    await db.flush()

    # Wait for task to complete (or return immediately for async processing)
    # For now, return task ID for async processing
    return {
        "success": True,
        "task_id": task.id,
        "message": f"Memory consolidation queued for user {user_id}",
    }


def _configure_logging() -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level="INFO",
        format="<level>{level: <8}</level> | <cyan>{name}</cyan> | {message}",
        colorize=True,
    )


def main():
    """Main entry point for the daemon"""
    import uvicorn

    _configure_logging()
    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info")


if __name__ == "__main__":
    main()
