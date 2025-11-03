from __future__ import annotations

import asyncio
import json
import os
import platform
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Body, Depends, FastAPI
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlmodel import select

from dere_daemon.ollama_client import OllamaClient
from dere_daemon.task_processor import TaskProcessor
from dere_shared.config import load_dere_config
from dere_shared.database import create_engine, create_session_factory, get_session
from dere_shared.models import (
    ContextCache,
    Conversation,
    EmotionState,
    Entity,
    MessageType,
    Notification,
    Presence,
    Session,
    StimulusHistory,
    TaskQueue,
    TaskStatus,
    UserSession,
    WellnessSession,
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
    context_depth: int = 5
    include_entities: bool = False
    max_tokens: int = 2000
    context_mode: str = "smart"
    current_prompt: str


class ContextGetRequest(BaseModel):
    session_id: int
    max_age_minutes: int = 30


class ModePreviousSessionRequest(BaseModel):
    mode: str
    project_path: str
    user_id: str | None = None


class WellnessExtractRequest(BaseModel):
    mode: str
    conversation: str
    session_id: int


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


class HybridSearchRequest(BaseModel):
    query: str
    entity_values: list[str] = []
    limit: int = 10
    entity_weight: float = 0.6
    session_id: int | None = None
    user_session_id: int | None = None


class EntityTimelineResponse(BaseModel):
    entity: str
    sessions: list[dict[str, Any]]


class RelatedEntitiesResponse(BaseModel):
    entity: str
    related: list[dict[str, Any]]


class HookCaptureRequest(BaseModel):
    data: dict[str, Any]


class AmbientNotifyRequest(BaseModel):
    message: str
    priority: str = "alert"


class LLMGenerateRequest(BaseModel):
    prompt: str
    model: str = "claude-3-5-haiku-20241022"
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
                last_update=datetime.utcnow(),
            )
            db.add(state)
            await db.commit()


# Global state
class AppState:
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    ollama: OllamaClient
    processor: TaskProcessor
    emotion_managers: dict[int, Any]  # session_id -> OCCEmotionManager
    ambient_monitor: Any  # AmbientMonitor
    personality_loader: Any  # PersonalityLoader
    db: Any  # EmotionDBAdapter


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
    ollama_config = config["ollama"]
    db_url = config.get("database", {}).get("url", "postgresql://postgres:dere@localhost/dere")

    # Convert to asyncpg URL if needed
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    app.state = AppState()

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

    app.state.ollama = OllamaClient(
        base_url=ollama_config["url"],
        embedding_model=ollama_config["embedding_model"],
        summarization_model=ollama_config["summarization_model"],
    )
    app.state.processor = TaskProcessor(app.state.session_factory, app.state.ollama)
    app.state.emotion_managers = {}

    # Initialize personality loader
    from dere_shared.personalities import PersonalityLoader

    config_dir = data_dir  # Use same dir as database for user personalities
    app.state.personality_loader = PersonalityLoader(config_dir)

    # Initialize ambient monitor
    try:
        from dere_ambient import AmbientMonitor, load_ambient_config

        ambient_config = load_ambient_config()
        app.state.ambient_monitor = AmbientMonitor(ambient_config)
    except Exception as e:
        print(f"Warning: Failed to initialize ambient monitor: {e}")
        app.state.ambient_monitor = None

    # Reset any stuck tasks from previous runs
    # TODO: Reimplement with SQLModel
    # try:
    #     stuck_count = await reset_stuck_tasks(app.state.session_factory)
    #     if stuck_count > 0:
    #         print(f"Reset {stuck_count} stuck tasks to pending")
    # except Exception as e:
    #     print(f"Warning: Failed to reset stuck tasks: {e}")

    # Start Ollama health checks
    await app.state.ollama.start()

    # Start task processor
    await app.state.processor.start()

    # Start ambient monitor
    if app.state.ambient_monitor:
        await app.state.ambient_monitor.start()

    # Start presence cleanup background task
    async def cleanup_presence_loop():
        """Background task to cleanup stale presence records."""
        while True:
            try:
                await asyncio.sleep(30)  # Every 30s
                # TODO: Reimplement with SQLModel
                # cleaned = await cleanup_stale_presence(app.state.session_factory, stale_seconds=60)
                # if cleaned > 0:
                #     from loguru import logger
                #     logger.debug("Cleaned up {} stale presence records", cleaned)
            except Exception as e:
                from loguru import logger

                logger.error("Presence cleanup failed: {}", e)

    cleanup_task = asyncio.create_task(cleanup_presence_loop())

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

    try:
        await app.state.ollama.shutdown()
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
    from dere_shared.emotion.manager import OCCEmotionManager
    from dere_shared.emotion.models import OCCAttitude, OCCGoal, OCCStandard
    from dere_shared.personalities import PersonalityLoader

    if session_id in app.state.emotion_managers:
        return app.state.emotion_managers[session_id]

    # Load personality-specific OCC config if available
    goals = []
    standards = []
    attitudes = []

    if personality:
        try:
            loader = PersonalityLoader()
            persona = loader.load(personality)

            # Convert personality OCC config to OCC models
            if persona.occ_goals:
                goals = [OCCGoal(**goal_dict) for goal_dict in persona.occ_goals]
            if persona.occ_standards:
                standards = [OCCStandard(**std_dict) for std_dict in persona.occ_standards]
            if persona.occ_attitudes:
                attitudes = [OCCAttitude(**att_dict) for att_dict in persona.occ_attitudes]
        except Exception as e:
            from loguru import logger

            logger.warning(f"Failed to load personality OCC config for '{personality}': {e}")

    # Fall back to defaults if no personality-specific config
    if not goals:
        goals = [
            OCCGoal(
                id="help_user",
                description="Successfully help the user accomplish their task",
                active=True,
                importance=9,
            ),
            OCCGoal(
                id="understand_intent",
                description="Accurately understand user's intent and needs",
                active=True,
                importance=8,
            ),
            OCCGoal(
                id="maintain_rapport",
                description="Maintain positive relationship with the user",
                active=True,
                importance=7,
            ),
        ]

    if not standards:
        standards = [
            OCCStandard(
                id="be_helpful",
                description="Provide useful, accurate assistance",
                importance=9,
                praiseworthiness=8,
            ),
            OCCStandard(
                id="be_respectful",
                description="Treat user with respect and consideration",
                importance=8,
                praiseworthiness=7,
            ),
            OCCStandard(
                id="be_honest",
                description="Be truthful and transparent",
                importance=9,
                praiseworthiness=9,
            ),
        ]

    if not attitudes:
        attitudes = [
            OCCAttitude(
                id="user_appreciation",
                target_object="user",
                description="Positive regard for the user",
                appealingness=7,
            ),
            OCCAttitude(
                id="coding_tasks",
                target_object="coding",
                description="Interest in programming and technical work",
                appealingness=8,
            ),
        ]

    manager = OCCEmotionManager(
        goals=goals,
        standards=standards,
        attitudes=attitudes,
        session_id=session_id,
        db=app.state.db,
    )

    await manager.initialize()
    app.state.emotion_managers[session_id] = manager

    return manager


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    ollama_available = await app.state.ollama.is_available()
    return {
        "status": "healthy",
        "ollama": "available" if ollama_available else "unavailable",
        "embedding_model": app.state.ollama.embedding_model,
    }


@app.post("/sessions/create", response_model=CreateSessionResponse)
async def create_session(req: CreateSessionRequest, db: AsyncSession = Depends(get_db)):
    """Create a new session"""
    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
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

    # Create/find user_session if user_id provided
    user_session_id = None
    if req.user_id:
        stmt = select(UserSession).where(UserSession.user_id == req.user_id)
        result = await db.execute(stmt)
        user_session = result.scalar_one_or_none()

        if not user_session:
            user_session = UserSession(
                user_id=req.user_id,
                default_personality=req.personality,
            )
            db.add(user_session)
            await db.flush()
            await db.refresh(user_session)

        user_session_id = user_session.id

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
        # Update existing session with user_session_id if provided
        if user_session_id:
            existing.user_session_id = user_session_id
            await db.flush()
        return FindOrCreateSessionResponse(
            session_id=existing.id,
            resumed=True,
            claude_session_id=existing.claude_session_id,
        )

    if existing and req.max_age_hours is None:
        # Update existing session with user_session_id if provided
        if user_session_id:
            existing.user_session_id = user_session_id
            await db.flush()
        return FindOrCreateSessionResponse(
            session_id=existing.id,
            resumed=True,
            claude_session_id=existing.claude_session_id,
        )

    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
        continued_from=existing.id if existing else None,
        user_session_id=user_session_id,
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


@app.post("/sessions/{session_id}/message", response_model=StoreMessageResponse)
async def store_message(
    session_id: int,
    req: StoreMessageRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Store a message and queue embedding generation"""
    conv = Conversation(
        session_id=session_id,
        prompt=req.message,
        message_type=req.role,
        timestamp=int(time.time()),
    )

    db.add(conv)
    await db.flush()
    await db.refresh(conv)

    # Queue embedding generation in background
    background_tasks.add_task(generate_embedding_task, conv.id, req.message)

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


@app.post("/search/similar")
async def search_similar(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Search for similar conversations using vector similarity"""
    from sqlalchemy import select

    try:
        # Generate embedding for query
        embedding = await app.state.ollama.get_embedding(req.query)

        # Use pgvector <=> operator for cosine distance
        # Distance of 0 = identical, distance of 2 = opposite
        # Convert to similarity score: 1 - (distance / 2)
        stmt = (
            select(
                Conversation.id,
                Conversation.session_id,
                Conversation.prompt,
                Conversation.message_type,
                Conversation.timestamp,
                (1 - (Conversation.prompt_embedding.cosine_distance(embedding) / 2)).label(
                    "similarity"
                ),
            )
            .where(Conversation.prompt_embedding.is_not(None))
            .where(
                (1 - (Conversation.prompt_embedding.cosine_distance(embedding) / 2))
                >= req.threshold
            )
            .order_by(Conversation.prompt_embedding.cosine_distance(embedding))
            .limit(req.limit)
        )

        result = await db.execute(stmt)
        rows = result.all()

        return {
            "results": [
                {
                    "id": row.id,
                    "session_id": row.session_id,
                    "prompt": row.prompt,
                    "message_type": row.message_type,
                    "timestamp": row.timestamp,
                    "similarity": float(row.similarity),
                }
                for row in rows
            ]
        }
    except RuntimeError:
        # Ollama unavailable, return empty results
        return {"results": []}


@app.post("/embeddings/generate")
async def generate_embedding(text: str):
    """Generate embedding for text"""
    embedding = await app.state.ollama.get_embedding(text)
    return {"embedding": embedding, "model": app.state.ollama.embedding_model}


@app.post("/search/hybrid")
async def search_hybrid(req: HybridSearchRequest, db: AsyncSession = Depends(get_db)):
    """Hybrid search using entities and embeddings.

    Supports cross-medium search:
    - If user_session_id provided: search across all sessions in user_session
    - If session_id provided: resolve user_session_id and search across all sessions
    - Otherwise: search all conversations
    """
    from sqlalchemy import func, literal, select

    # Generate embedding for query
    embedding = await app.state.ollama.get_embedding(req.query)

    # Determine user_session_id
    user_session_id = req.user_session_id
    if not user_session_id and req.session_id:
        stmt = select(Session.user_session_id).where(Session.id == req.session_id)
        result = await db.execute(stmt)
        user_session_id = result.scalar_one_or_none()

    # Perform hybrid search using CTEs
    current_time = int(time.time())
    entity_weight = req.entity_weight
    recency_weight = 0.3
    semantic_weight = 1.0 - entity_weight
    max_entity_count = len(req.entity_values) if req.entity_values else 1

    # Build entity_matches CTE
    entity_matches_cte = (
        select(
            Conversation.id.label("conv_id"),
            func.count(func.distinct(Entity.id)).cast(literal(0.0).type).label("entity_score"),
        )
        .select_from(Conversation)
        .join(Entity, Entity.conversation_id == Conversation.id)
        .where(Entity.normalized_value.in_(req.entity_values) if req.entity_values else False)
    )

    if user_session_id:
        entity_matches_cte = entity_matches_cte.join(
            Session, Session.id == Conversation.session_id
        ).where(Session.user_session_id == user_session_id)

    entity_matches_cte = entity_matches_cte.group_by(Conversation.id).cte("entity_matches")

    # Build semantic_matches CTE
    semantic_matches_cte = select(
        Conversation.id.label("conv_id"),
        (1 - (Conversation.prompt_embedding.cosine_distance(embedding))).label("semantic_score"),
    ).where(Conversation.prompt_embedding.is_not(None))

    if user_session_id:
        semantic_matches_cte = semantic_matches_cte.join(
            Session, Session.id == Conversation.session_id
        ).where(Session.user_session_id == user_session_id)

    semantic_matches_cte = semantic_matches_cte.cte("semantic_matches")

    # Final query joining CTEs
    stmt = (
        select(
            Conversation.id,
            Conversation.session_id,
            Conversation.prompt,
            Conversation.message_type,
            Conversation.timestamp,
            Session.working_dir,
            Session.medium,
            func.coalesce(entity_matches_cte.c.entity_score, 0).label("entity_score"),
            func.coalesce(semantic_matches_cte.c.semantic_score, 0).label("semantic_score"),
            func.exp(
                -((current_time - Conversation.timestamp).cast(literal(0.0).type) / 604800.0)
            ).label("recency_score"),
            (
                (
                    func.coalesce(entity_matches_cte.c.entity_score, 0)
                    / max_entity_count
                    * entity_weight
                    + func.coalesce(semantic_matches_cte.c.semantic_score, 0) * semantic_weight
                )
                * (1 - recency_weight)
                + func.exp(
                    -((current_time - Conversation.timestamp).cast(literal(0.0).type) / 604800.0)
                )
                * recency_weight
            ).label("combined_score"),
        )
        .select_from(Conversation)
        .join(Session, Session.id == Conversation.session_id)
        .outerjoin(entity_matches_cte, entity_matches_cte.c.conv_id == Conversation.id)
        .outerjoin(semantic_matches_cte, semantic_matches_cte.c.conv_id == Conversation.id)
        .order_by(literal("combined_score").desc())
        .limit(req.limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return {
        "results": [
            {
                "id": row.id,
                "session_id": row.session_id,
                "prompt": row.prompt,
                "message_type": row.message_type,
                "timestamp": row.timestamp,
                "working_dir": row.working_dir,
                "medium": row.medium,
                "entity_score": float(row.entity_score),
                "semantic_score": float(row.semantic_score),
                "recency_score": float(row.recency_score),
                "combined_score": float(row.combined_score),
            }
            for row in rows
        ],
        "entity_values": req.entity_values,
    }


@app.get("/entities/session/{session_id}")
async def get_session_entities(
    session_id: int, entity_type: str | None = None, db: AsyncSession = Depends(get_db)
):
    """Get all entities for a session"""
    from sqlmodel import select

    stmt = select(Entity).where(Entity.session_id == session_id)
    if entity_type:
        stmt = stmt.where(Entity.entity_type == entity_type)

    result = await db.execute(stmt)
    entities = result.scalars().all()

    return {
        "session_id": session_id,
        "entities": [
            {
                "id": e.id,
                "entity_type": e.entity_type,
                "entity_value": e.entity_value,
                "normalized_value": e.normalized_value,
                "confidence": e.confidence,
            }
            for e in entities
        ],
    }


@app.get("/entities/timeline/{entity}")
async def get_entity_timeline(entity: str, db: AsyncSession = Depends(get_db)):
    """Get timeline of entity mentions across sessions"""
    from sqlalchemy import func
    from sqlmodel import select

    stmt = (
        select(
            Session.id,
            Session.working_dir,
            Session.start_time,
            func.count(Entity.id).label("mention_count"),
        )
        .select_from(Entity)
        .join(Session, Session.id == Entity.session_id)
        .where(Entity.normalized_value == entity)
        .group_by(Session.id, Session.working_dir, Session.start_time)
        .order_by(Session.start_time.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    return EntityTimelineResponse(
        entity=entity,
        sessions=[
            {
                "session_id": row.id,
                "working_dir": row.working_dir,
                "start_time": row.start_time,
                "mention_count": row.mention_count,
            }
            for row in rows
        ],
    )


@app.get("/entities/related/{entity}")
async def get_related_entities(entity: str, limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Get entities that co-occur with the given entity"""
    from sqlalchemy import and_, func, select

    # Find conversations containing the target entity
    # Then find other entities in those conversations
    e1 = Entity.__table__.alias("e1")
    e2 = Entity.__table__.alias("e2")

    stmt = (
        select(
            e2.c.normalized_value,
            e2.c.entity_type,
            func.count(func.distinct(e2.c.conversation_id)).label("co_occurrence_count"),
        )
        .select_from(e1)
        .join(e2, and_(e1.c.conversation_id == e2.c.conversation_id, e1.c.id != e2.c.id))
        .where(e1.c.normalized_value == entity)
        .group_by(e2.c.normalized_value, e2.c.entity_type)
        .order_by(func.count(func.distinct(e2.c.conversation_id)).desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return RelatedEntitiesResponse(
        entity=entity,
        related=[
            {
                "entity": row.normalized_value,
                "entity_type": row.entity_type,
                "co_occurrence_count": row.co_occurrence_count,
            }
            for row in rows
        ],
    )


@app.get("/entities/importance")
async def get_entity_importance(
    user_id: str | None = None,
    limit: int = 50,
    recency_days: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """Get entity importance scores based on mention count, recency, and cross-medium presence"""
    from sqlalchemy import distinct, func, select

    cutoff_time = int(time.time()) - (recency_days * 86400)

    stmt = (
        select(
            Entity.normalized_value,
            Entity.entity_type,
            func.count(Entity.id).label("mention_count"),
            func.count(distinct(Session.medium)).label("medium_count"),
            func.max(Conversation.timestamp).label("last_seen"),
        )
        .select_from(Entity)
        .join(Conversation, Conversation.id == Entity.conversation_id)
        .join(Session, Session.id == Conversation.session_id)
        .where(Conversation.timestamp >= cutoff_time)
    )

    if user_id:
        stmt = stmt.where(Session.user_id == user_id)

    stmt = (
        stmt.group_by(Entity.normalized_value, Entity.entity_type)
        .order_by(func.count(Entity.id).desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return {
        "entities": [
            {
                "entity": row.normalized_value,
                "entity_type": row.entity_type,
                "mention_count": row.mention_count,
                "medium_count": row.medium_count,
                "last_seen": row.last_seen,
            }
            for row in rows
        ]
    }


@app.get("/entities/user/{user_id}")
async def get_user_entities(
    user_id: str,
    entity_type: str | None = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """Get all entities for a user across all sessions and mediums"""
    from sqlmodel import select

    stmt = (
        select(Entity)
        .join(Session, Session.id == Entity.session_id)
        .where(Session.user_id == user_id)
    )

    if entity_type:
        stmt = stmt.where(Entity.entity_type == entity_type)

    stmt = stmt.limit(limit)

    result = await db.execute(stmt)
    entities = result.scalars().all()

    return {
        "user_id": user_id,
        "entities": [
            {
                "id": e.id,
                "entity_type": e.entity_type,
                "entity_value": e.entity_value,
                "normalized_value": e.normalized_value,
                "confidence": e.confidence,
                "session_id": e.session_id,
            }
            for e in entities
        ],
    }


@app.post("/entities/merge/{user_id}")
async def merge_user_entities(user_id: str, db: AsyncSession = Depends(get_db)):
    """Merge duplicate entities for a user across mediums using fingerprints"""
    # TODO: Reimplement entity merging logic
    return {"user_id": user_id, "merged_count": 0, "message": "Not yet implemented"}


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
            last_activity=datetime.utcnow(),
        )
        db.add(session)
        await db.flush()

    # Store conversation without embedding
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

    # Queue embedding task
    embedding_task = TaskQueue(
        task_type="embedding",
        model_name=app.state.ollama.embedding_model,
        content=req.prompt,
        task_metadata={
            "original_length": len(req.prompt),
            "processing_mode": "raw",
            "content_type": "prompt",
            "conversation_id": conversation_id,
        },
        priority=5,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    db.add(embedding_task)
    app.state.processor.trigger()

    # Queue entity extraction task
    entity_task = TaskQueue(
        task_type="entity_extraction",
        model_name="gemma3n:latest",
        content=req.prompt,
        task_metadata={
            "original_length": len(req.prompt),
            "content_type": "prompt",
            "context_hint": "coding",
        },
        priority=3,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    db.add(entity_task)
    app.state.processor.trigger()

    # Queue emotion processing as background task (don't block response)
    if req.message_type == "user":
        import asyncio

        async def process_emotion_background():
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
                from datetime import datetime

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
                # Don't fail if emotion processing fails
                from loguru import logger

                logger.error(f"[conversation_capture] Emotion processing failed: {e}")

        # Fire and forget - don't await
        asyncio.create_task(process_emotion_background())

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

    # Get session personality
    stmt = select(Session.personality).where(Session.id == req.session_id)
    result = await db.execute(stmt)
    personality = result.scalar_one_or_none()

    # Queue summarization task
    summary_task = TaskQueue(
        task_type="summarization",
        model_name="gemma3n:latest",
        content=content,
        task_metadata={
            "original_length": len(content),
            "mode": "session",
            "max_length": 200,
            "personality": personality or "",
        },
        priority=8,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    db.add(summary_task)
    await db.flush()
    task_id = summary_task.id
    app.state.processor.trigger()

    # Mark session as ended
    stmt = update(Session).where(Session.id == req.session_id).values(end_time=int(time.time()))
    await db.execute(stmt)

    return {"summary_task": task_id, "status": "queued"}


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
    """Queue context building task"""
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
            last_activity=datetime.utcnow(),
        )
        db.add(session)
        await db.flush()

    # Set defaults
    context_depth = req.context_depth or 5
    max_tokens = req.max_tokens or 2000
    context_mode = req.context_mode or "smart"

    # Queue context building task
    task = TaskQueue(
        task_type="context_building",
        model_name="",
        content=req.current_prompt,
        task_metadata={
            "session_id": req.session_id,
            "project_path": req.project_path,
            "personality": req.personality,
            "context_depth": context_depth,
            "include_entities": req.include_entities,
            "max_tokens": max_tokens,
            "context_mode": context_mode,
            "current_prompt": req.current_prompt,
        },
        priority=8,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    db.add(task)
    await db.flush()

    return {"task_id": task.id, "status": "queued"}


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


@app.post("/mode/session/previous")
async def mode_session_previous(
    req: ModePreviousSessionRequest, db: AsyncSession = Depends(get_db)
):
    """Find previous session for a mode"""
    from sqlalchemy import select

    stmt = (
        select(Session)
        .where(Session.personality == req.mode)
        .where(Session.working_dir == req.project_path)
        .where(Session.end_time.is_not(None))
        .order_by(Session.start_time.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        return {"found": False}

    session_time = datetime.fromtimestamp(session.start_time)
    days_ago = (datetime.now() - session_time).days
    last_session_date = session_time.strftime("%B %d, %Y")

    # Parse key_topics if it's JSON
    key_topics = session.key_topics or ""
    if key_topics.startswith("["):
        try:
            key_topics = ", ".join(json.loads(key_topics))
        except Exception:
            pass

    return {
        "found": True,
        "session_id": session.id,
        "last_session_date": last_session_date,
        "days_ago": days_ago,
        "summary": session.summary or "",
        "key_topics": key_topics,
        "next_steps": session.next_steps or "",
    }


@app.post("/mode/wellness/extract")
async def mode_wellness_extract(req: WellnessExtractRequest, db: AsyncSession = Depends(get_db)):
    """Extract wellness data from conversation using LLM"""
    from sqlalchemy import update

    # Check if Ollama is available
    if not await app.state.ollama.is_available():
        return {
            "mood": 5,
            "energy": 5,
            "stress": 5,
            "key_themes": ["Unable to analyze - Ollama not available"],
            "notes": "Ollama service not available",
            "homework": [],
            "next_step_notes": "",
        }

    # Build wellness extraction prompt
    prompt = f"""You are a mental health professional analyzing a therapy conversation. Extract structured wellness data from this conversation:

CONVERSATION:
{req.conversation}

Extract the following information in JSON format:
- mood: integer 1-10 (1=very poor, 10=excellent)
- energy: integer 1-10 (1=very low, 10=very high)
- stress: integer 1-10 (1=very low, 10=very high)
- key_themes: array of strings (main emotional/psychological themes discussed)
- notes: string (brief summary of session insights)
- homework: array of strings (suggested activities or practices)
- next_step_notes: string (notes for next session)

Focus on evidence from the conversation. If insufficient information, use reasonable defaults (5 for scales)."""

    # Define JSON schema
    schema = {
        "type": "object",
        "properties": {
            "mood": {"type": "integer", "minimum": 1, "maximum": 10},
            "energy": {"type": "integer", "minimum": 1, "maximum": 10},
            "stress": {"type": "integer", "minimum": 1, "maximum": 10},
            "key_themes": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"},
            "homework": {"type": "array", "items": {"type": "string"}},
            "next_step_notes": {"type": "string"},
        },
        "required": [
            "mood",
            "energy",
            "stress",
            "key_themes",
            "notes",
            "homework",
            "next_step_notes",
        ],
    }

    try:
        # Log content size before generation
        prompt_length = len(prompt)
        logger.info("Wellness extraction: {} chars (~{} tokens)", prompt_length, prompt_length // 4)

        # Generate wellness data with LLM
        response = await app.state.ollama.generate(prompt, schema=schema)
        wellness_data = json.loads(response)

        # Store wellness session
        wellness = WellnessSession(
            session_id=req.session_id,
            mode=req.mode,
            mood=wellness_data["mood"],
            energy=wellness_data["energy"],
            stress=wellness_data["stress"],
            key_themes=json.dumps(wellness_data["key_themes"]),
            notes=wellness_data["notes"],
            homework=json.dumps(wellness_data["homework"]),
            next_step_notes=wellness_data["next_step_notes"],
            timestamp=int(time.time()),
        )
        db.add(wellness)

        # Generate and store session summary
        summary_prompt = f"""Based on this {req.mode} session data, create a brief summary for future session continuity:

Wellness Metrics:
- Mood: {wellness_data["mood"]}/10
- Energy: {wellness_data["energy"]}/10
- Stress: {wellness_data["stress"]}/10

Key Themes: {", ".join(wellness_data["key_themes"])}
Session Notes: {wellness_data["notes"]}
Homework Assigned: {"; ".join(wellness_data["homework"])}
Next Steps: {wellness_data["next_step_notes"]}

Generate a 2-3 sentence summary that captures:
1. The main emotional/psychological state
2. Key issues or progress discussed
3. What should be followed up on next time

Summary:"""

        # Log content size before generation
        prompt_len = len(summary_prompt)
        logger.info(
            "Wellness summary generation: {} chars (~{} tokens)", prompt_len, prompt_len // 4
        )

        summary = await app.state.ollama.generate(summary_prompt)
        summary = summary.strip()
        if summary.startswith("Summary:"):
            summary = summary.replace("Summary:", "").strip()

        # Store session summary
        stmt = (
            update(Session)
            .where(Session.id == req.session_id)
            .values(
                summary=summary,
                key_topics=json.dumps(wellness_data["key_themes"]),
                next_steps=wellness_data["next_step_notes"],
                summarization_model=app.state.ollama.summarization_model,
            )
        )
        await db.execute(stmt)

        return wellness_data

    except Exception as e:
        print(f"Failed to extract wellness data: {e}")
        return {
            "mood": 5,
            "energy": 5,
            "stress": 5,
            "key_themes": ["Analysis failed"],
            "notes": f"LLM analysis error: {e}",
            "homework": [],
            "next_step_notes": "",
        }


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


@app.post("/ambient/notify")
async def ambient_notify(req: AmbientNotifyRequest):
    """Receive ambient notifications for routing to Discord or other channels.

    This endpoint receives notifications from the ambient monitor and can route them
    to connected Discord bots or store them for later retrieval.
    """

    logger.info("Received ambient notification (priority: {}): {}", req.priority, req.message[:100])

    # TODO: Route to Discord bot when implemented
    # For now, just log and acknowledge

    return {"status": "received", "message": "Notification logged"}


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

    TODO: Telegram integration
    When implementing Telegram bot (dere_telegram package):
    1. Create TelegramBotClient similar to Discord's DereDiscordClient
    2. Call this endpoint on startup with medium="telegram"
    3. Provide available_channels with chat IDs and metadata
    4. Send heartbeats every 30s via /presence/heartbeat
    5. Poll /notifications/pending with medium="telegram" query param
    6. Deliver notifications via Telegram Bot API send_message
    7. Link sessions with user_id (Telegram user ID) for cross-medium continuity
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
                last_heartbeat=datetime.utcnow(),
            )
        )
        await db.execute(stmt)
    else:
        presence = Presence(
            medium=req.medium,
            user_id=req.user_id,
            available_channels=req.available_channels,
            last_heartbeat=datetime.utcnow(),
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
        .values(last_heartbeat=datetime.utcnow())
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
    from sqlalchemy import select

    # Consider presence stale after 60 seconds
    stale_threshold = int(time.time()) - 60

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
    from sqlalchemy import select

    from dere_daemon.routing import decide_routing

    # Get available mediums
    stale_threshold = int(time.time()) - 60
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
            "available_channels": json.loads(p.available_channels) if p.available_channels else [],
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
    decision = await decide_routing(
        user_id=req.user_id,
        message=req.message,
        priority=req.priority,
        available_mediums=available_mediums,
        user_activity=req.user_activity,
        recent_conversations=recent_conversations,
        session_factory=app.state.session_factory,
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

    notification = Notification(
        user_id=req.user_id,
        target_medium=req.target_medium,
        target_location=req.target_location,
        message=req.message,
        priority=req.priority,
        routing_reasoning=req.routing_reasoning,
        status="pending",
        created_at=datetime.utcnow(),
    )
    db.add(notification)
    await db.flush()

    logger.info(
        "Notification {} created: {} -> {} ({})",
        notification.id,
        req.target_medium,
        req.target_location,
        req.priority,
    )
    return {"notification_id": notification.id, "status": "queued"}


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
            delivered_at=datetime.utcnow(),
        )
    )
    await db.execute(stmt)

    logger.info("Notification {} marked as delivered", notification_id)
    return {"status": "delivered"}


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
            delivered_at=datetime.utcnow(),
        )
    )
    await db.execute(stmt)

    logger.warning("Notification {} failed: {}", notification_id, req.error_message)
    return {"status": "failed"}


@app.post("/api/synthesis/run", response_model=SynthesisRunResponse)
async def run_synthesis(req: SynthesisRunRequest, db: AsyncSession = Depends(get_db)):
    """Run synthesis across conversations for a personality combination"""
    # TODO: Full synthesis implementation requires ConversationStream conversion
    # For now, return a placeholder response
    logger.warning("Synthesis endpoint not fully implemented yet")

    return SynthesisRunResponse(
        success=True,
        total_sessions=0,
        insights_generated=0,
        patterns_detected=0,
        entity_collisions=0,
    )


@app.post("/api/synthesis/insights")
async def get_insights(req: SynthesisInsightsRequest, db: AsyncSession = Depends(get_db)):
    """Get synthesized insights for a personality combination"""
    from sqlalchemy import select

    from dere_shared.models import ConversationInsight

    personality_combo_str = ",".join(req.personality_combo)

    stmt = (
        select(ConversationInsight)
        .where(ConversationInsight.personality_combo == personality_combo_str)
        .order_by(ConversationInsight.created_at.desc())
        .limit(req.limit)
    )

    result = await db.execute(stmt)
    insights_objs = result.scalars().all()

    insights = [
        {
            "id": i.id,
            "insight_type": i.insight_type,
            "content": i.content,
            "evidence": i.evidence,
            "confidence": i.confidence,
            "created_at": i.created_at,
        }
        for i in insights_objs
    ]

    # Format with personality if requested
    formatted_text = None
    if req.format_with_personality and insights and req.personality_combo:
        try:
            from dere_shared.synthesis.presentation import format_insights_with_personality

            # Load personality config
            personality_name = req.personality_combo[0]  # Use first personality
            personality = app.state.personality_loader.load(personality_name)

            # Build personality config dict
            personality_config = {
                "name": personality.name,
                "occ_goals": personality.occ_goals,
                "occ_standards": personality.occ_standards,
                "occ_attitudes": personality.occ_attitudes,
            }

            # Format insights
            formatted_text = await format_insights_with_personality(
                insights=insights,
                personality_config=personality_config,
                ollama_client=app.state.ollama,
            )
        except Exception:
            # Fallback to raw insights if formatting fails
            pass

    return {"insights": insights, "formatted": formatted_text}


@app.post("/api/synthesis/patterns")
async def get_patterns(req: SynthesisPatternsRequest, db: AsyncSession = Depends(get_db)):
    """Get detected patterns for a personality combination"""
    from sqlalchemy import select

    from dere_shared.models import ConversationPattern

    personality_combo_str = ",".join(req.personality_combo)

    stmt = (
        select(ConversationPattern)
        .where(ConversationPattern.personality_combo == personality_combo_str)
        .order_by(ConversationPattern.frequency.desc())
        .limit(req.limit)
    )

    result = await db.execute(stmt)
    patterns_objs = result.scalars().all()

    patterns = [
        {
            "id": p.id,
            "pattern_type": p.pattern_type,
            "description": p.description,
            "frequency": p.frequency,
            "sessions": p.sessions,
            "first_seen": p.first_seen,
            "last_seen": p.last_seen,
        }
        for p in patterns_objs
    ]

    # Format with personality if requested
    formatted_text = None
    if req.format_with_personality and patterns and req.personality_combo:
        try:
            from dere_shared.synthesis.presentation import format_patterns_with_personality

            # Load personality config
            personality_name = req.personality_combo[0]  # Use first personality
            personality = app.state.personality_loader.load(personality_name)

            # Build personality config dict
            personality_config = {
                "name": personality.name,
                "occ_goals": personality.occ_goals,
                "occ_standards": personality.occ_standards,
                "occ_attitudes": personality.occ_attitudes,
            }

            # Format patterns
            formatted_text = await format_patterns_with_personality(
                patterns=patterns,
                personality_config=personality_config,
                ollama_client=app.state.ollama,
            )
        except Exception:
            # Fallback to raw patterns if formatting fails
            pass

    return {"patterns": patterns, "formatted": formatted_text}


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


async def generate_embedding_task(message_id: int, text: str) -> None:
    """Background task to generate and store embedding"""
    from sqlalchemy import update

    try:
        embedding = await app.state.ollama.get_embedding(text)

        async with app.state.session_factory() as session:
            stmt = (
                update(Conversation)
                .where(Conversation.id == message_id)
                .values(prompt_embedding=embedding)
            )
            await session.execute(stmt)
            await session.commit()

    except Exception as e:
        print(f"Failed to generate embedding for message {message_id}: {e}")


def main():
    """Main entry point for the daemon"""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info")


if __name__ == "__main__":
    main()
