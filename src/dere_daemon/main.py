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

from fastapi import BackgroundTasks, Body, FastAPI
from loguru import logger
from pydantic import BaseModel

from dere_daemon.database import Database
from dere_daemon.ollama_client import OllamaClient
from dere_daemon.task_processor import TaskProcessor
from dere_shared.config import load_dere_config
from dere_shared.models import (
    Conversation,
    MessageType,
    Session,
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


# Global state
class AppState:
    db: Database
    ollama: OllamaClient
    processor: TaskProcessor
    emotion_managers: dict[int, Any]  # session_id -> OCCEmotionManager
    ambient_monitor: Any  # AmbientMonitor
    personality_loader: Any  # PersonalityLoader


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

    app.state = AppState()

    # Initialize database with error handling
    embedding_dimension = ollama_config.get("embedding_dimension", 1024)
    try:
        app.state.db = Database(db_url, embedding_dimension=embedding_dimension)
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
    app.state.processor = TaskProcessor(app.state.db, app.state.ollama)
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
    try:
        stuck_count = app.state.db.reset_stuck_tasks()
        if stuck_count > 0:
            print(f"Reset {stuck_count} stuck tasks to pending")
    except Exception as e:
        print(f"Warning: Failed to reset stuck tasks: {e}")

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
                cleaned = app.state.db.cleanup_stale_presence(stale_seconds=60)
                if cleaned > 0:
                    from loguru import logger

                    logger.debug("Cleaned up {} stale presence records", cleaned)
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
        app.state.db.close()
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
async def create_session(req: CreateSessionRequest):
    """Create a new session"""
    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
    )

    session_id = app.state.db.create_session(session)
    return CreateSessionResponse(session_id=session_id)


@app.post("/sessions/find_or_create", response_model=FindOrCreateSessionResponse)
async def find_or_create_session(req: FindOrCreateSessionRequest):
    """Find existing session or create new one with continuity support.

    If an existing session is found within max_age_hours, it will be resumed.
    If an old session exists but is outside max_age_hours, a new session will
    be created with continued_from linkage for historical continuity.
    """
    # Create/find user_session if user_id provided
    user_session_id = None
    if req.user_id:
        user_session_id = app.state.db.find_or_create_user_session(
            user_id=req.user_id, default_personality=req.personality
        )

    existing = app.state.db.get_latest_session_for_channel(
        req.working_dir, max_age_hours=req.max_age_hours
    )

    if existing and req.max_age_hours is not None:
        # Update existing session with user_session_id if provided
        if user_session_id:
            app.state.db.update_session_user_session_id(existing["id"], user_session_id)
        return FindOrCreateSessionResponse(
            session_id=existing["id"],
            resumed=True,
            claude_session_id=existing.get("claude_session_id"),
        )

    if existing and req.max_age_hours is None:
        # Update existing session with user_session_id if provided
        if user_session_id:
            app.state.db.update_session_user_session_id(existing["id"], user_session_id)
        return FindOrCreateSessionResponse(
            session_id=existing["id"],
            resumed=True,
            claude_session_id=existing.get("claude_session_id"),
        )

    session = Session(
        working_dir=req.working_dir,
        start_time=int(time.time()),
        continued_from=existing["id"] if existing else None,
        user_session_id=user_session_id,
        medium=req.medium,
        user_id=req.user_id,
    )

    session_id = app.state.db.create_session(session)
    return FindOrCreateSessionResponse(session_id=session_id, resumed=False, claude_session_id=None)


@app.post("/sessions/{session_id}/claude_session")
async def update_claude_session(session_id: int, claude_session_id: str = Body(...)):
    """Update the Claude SDK session ID for a daemon session.

    This is called after creating a ClaudeSDKClient and capturing its session ID
    from the first system init message.
    """

    logger.info(
        "Received claude_session_id update: session_id={}, claude_session_id={}",
        session_id,
        claude_session_id,
    )
    app.state.db.update_claude_session_id(session_id, claude_session_id)
    logger.info("Successfully updated claude_session_id for session {}", session_id)
    return {"status": "updated"}


@app.post("/sessions/{session_id}/message", response_model=StoreMessageResponse)
async def store_message(
    session_id: int, req: StoreMessageRequest, background_tasks: BackgroundTasks
):
    """Store a message and queue embedding generation"""
    conv = Conversation(
        session_id=session_id,
        prompt=req.message,
        message_type=req.role,
        timestamp=int(time.time()),
    )

    message_id = app.state.db.store_conversation(conv)

    # Queue embedding generation in background
    background_tasks.add_task(generate_embedding_task, message_id, req.message)

    return StoreMessageResponse(message_id=message_id)


@app.get("/sessions/{session_id}/history")
async def get_history(session_id: int, limit: int = 50):
    """Get conversation history for a session"""
    # TODO: Implement query from database
    return {"messages": []}


@app.post("/search/similar")
async def search_similar(req: SearchRequest):
    """Search for similar conversations using vector similarity"""
    try:
        # Generate embedding for query
        embedding = await app.state.ollama.get_embedding(req.query)

        # Search database
        results = app.state.db.search_similar(embedding, limit=req.limit, threshold=req.threshold)

        return {"results": results}
    except RuntimeError:
        # Ollama unavailable, return empty results
        return {"results": []}


@app.post("/embeddings/generate")
async def generate_embedding(text: str):
    """Generate embedding for text"""
    embedding = await app.state.ollama.get_embedding(text)
    return {"embedding": embedding, "model": app.state.ollama.embedding_model}


@app.post("/search/hybrid")
async def search_hybrid(req: HybridSearchRequest):
    """Hybrid search using entities and embeddings.

    Supports cross-medium search:
    - If user_session_id provided: search across all sessions in user_session
    - If session_id provided: resolve user_session_id and search across all sessions
    - Otherwise: search all conversations
    """
    # Generate embedding for query
    embedding = await app.state.ollama.get_embedding(req.query)

    # Determine user_session_id
    user_session_id = req.user_session_id
    if not user_session_id and req.session_id:
        user_session_id = app.state.db.get_user_session_id_for_session(req.session_id)

    # Perform hybrid search
    if user_session_id:
        # Cross-medium search across user_session
        results = app.state.db.search_user_session_context(
            user_session_id,
            req.entity_values,
            embedding,
            limit=req.limit,
            entity_weight=req.entity_weight,
        )
    else:
        # Regular search across all conversations
        results = app.state.db.search_with_entities_and_embeddings(
            req.entity_values, embedding, limit=req.limit, entity_weight=req.entity_weight
        )

    return {"results": results, "entity_values": req.entity_values}


@app.get("/entities/session/{session_id}")
async def get_session_entities(session_id: int, entity_type: str | None = None):
    """Get all entities for a session"""
    entities = app.state.db.get_entities_by_session(session_id, entity_type)
    return {"session_id": session_id, "entities": entities}


@app.get("/entities/timeline/{entity}")
async def get_entity_timeline(entity: str):
    """Get timeline of entity mentions across sessions"""
    timeline = app.state.db.get_entity_timeline(entity)
    return EntityTimelineResponse(entity=entity, sessions=timeline)


@app.get("/entities/related/{entity}")
async def get_related_entities(entity: str, limit: int = 20):
    """Get entities that co-occur with the given entity"""
    related = app.state.db.find_co_occurring_entities(entity, limit)
    return RelatedEntitiesResponse(entity=entity, related=related)


@app.get("/entities/importance")
async def get_entity_importance(
    user_id: str | None = None, limit: int = 50, recency_days: int = 30
):
    """Get entity importance scores based on mention count, recency, and cross-medium presence"""
    entities = app.state.db.get_entity_importance_scores(user_id, limit, recency_days)
    return {"entities": entities}


@app.get("/entities/user/{user_id}")
async def get_user_entities(user_id: str, entity_type: str | None = None, limit: int = 100):
    """Get all entities for a user across all sessions and mediums"""
    entities = app.state.db.get_entities_by_user(user_id, entity_type, limit)
    return {"user_id": user_id, "entities": entities}


@app.post("/entities/merge/{user_id}")
async def merge_user_entities(user_id: str):
    """Merge duplicate entities for a user across mediums using fingerprints"""
    stats = app.state.db.merge_duplicate_entities(user_id)
    return {"user_id": user_id, **stats}


@app.post("/conversation/capture")
async def conversation_capture(req: ConversationCaptureRequest):
    """Capture conversation and queue background tasks"""
    # Ensure session exists
    app.state.db.ensure_session_exists(req.session_id, req.project_path, req.personality)

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
    conversation_id = app.state.db.store_conversation(conv)

    # Queue embedding task
    embedding_task = TaskQueue(
        task_type="embedding",
        model_name=app.state.ollama.embedding_model,
        content=req.prompt,
        metadata={
            "original_length": len(req.prompt),
            "processing_mode": "raw",
            "content_type": "prompt",
            "conversation_id": conversation_id,
        },
        priority=5,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    app.state.db.queue_task(embedding_task)
    app.state.processor.trigger()  # Trigger immediate processing

    # Queue entity extraction task
    entity_task = TaskQueue(
        task_type="entity_extraction",
        model_name="gemma3n:latest",
        content=req.prompt,
        metadata={
            "original_length": len(req.prompt),
            "content_type": "prompt",
            "context_hint": "coding",
        },
        priority=3,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    app.state.db.queue_task(entity_task)
    app.state.processor.trigger()  # Trigger immediate processing

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

                # Get session info
                session_info = app.state.db.get_session(req.session_id)
                session_start = session_info.get("start_time") if session_info else None

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
                        "working_dir": session_info.get("working_dir") if session_info else None,
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
async def session_end(req: SessionEndRequest):
    """Handle session end and queue summarization"""
    # Get recent session content (last 30 minutes or last 50 messages)
    thirty_minutes_ago = int(time.time()) - 1800
    content = app.state.db.get_session_content(
        req.session_id, since_timestamp=thirty_minutes_ago, max_messages=50
    )

    if not content:
        return {"status": "skipped", "reason": "no_content"}

    # Get session personality
    personality = app.state.db.get_session_personality(req.session_id)

    # Queue summarization task
    summary_task = TaskQueue(
        task_type="summarization",
        model_name="gemma3n:latest",
        content=content,
        metadata={
            "original_length": len(content),
            "mode": "session",
            "max_length": 200,
            "personality": personality or "",
        },
        priority=8,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    task_id = app.state.db.queue_task(summary_task)
    app.state.processor.trigger()  # Trigger immediate processing

    # Mark session as ended
    app.state.db.mark_session_ended(req.session_id)

    return {"summary_task": task_id, "status": "queued"}


@app.post("/status/get")
async def status_get(req: StatusRequest):
    """Get daemon and queue status"""
    queue_stats = app.state.db.get_queue_stats()

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
async def queue_add(req: QueueAddRequest):
    """Add task to processing queue"""
    task = TaskQueue(
        task_type=req.task_type,
        model_name=req.model_name,
        content=req.content,
        metadata=req.metadata,
        priority=req.priority,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    task_id = app.state.db.queue_task(task)

    return {"task_id": task_id, "status": "queued"}


@app.get("/queue/status")
async def queue_status():
    """Get queue statistics"""
    stats = app.state.db.get_queue_stats()
    return stats


@app.post("/context/build")
async def context_build(req: ContextBuildRequest):
    """Queue context building task"""
    # Ensure session exists
    app.state.db.ensure_session_exists(req.session_id, req.project_path, req.personality)

    # Set defaults
    context_depth = req.context_depth or 5
    max_tokens = req.max_tokens or 2000
    context_mode = req.context_mode or "smart"

    # Queue context building task
    task = TaskQueue(
        task_type="context_building",
        model_name="",
        content=req.current_prompt,
        metadata={
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
    task_id = app.state.db.queue_task(task)

    return {"task_id": task_id, "status": "queued"}


@app.post("/context/get")
async def context_get(req: ContextGetRequest):
    """Get cached context for session (body)"""
    max_age = req.max_age_minutes or 30
    context, found = app.state.db.get_cached_context(req.session_id, max_age * 60)

    return {"found": found, "context": context or ""}


@app.post("/mode/session/previous")
async def mode_session_previous(req: ModePreviousSessionRequest):
    """Find previous session for a mode"""
    result = app.state.db.get_previous_mode_session(req.mode, req.project_path)

    if not result:
        return {"found": False}

    session_time = datetime.fromtimestamp(result["start_time"])
    days_ago = (datetime.now() - session_time).days
    last_session_date = session_time.strftime("%B %d, %Y")

    # Parse key_topics if it's JSON
    key_topics = result.get("key_topics", "")
    if key_topics.startswith("["):
        try:
            key_topics = ", ".join(json.loads(key_topics))
        except Exception:
            pass

    return {
        "found": True,
        "session_id": result["id"],
        "last_session_date": last_session_date,
        "days_ago": days_ago,
        "summary": result.get("summary", ""),
        "key_topics": key_topics,
        "next_steps": result.get("next_steps", ""),
    }


@app.post("/mode/wellness/extract")
async def mode_wellness_extract(req: WellnessExtractRequest):
    """Extract wellness data from conversation using LLM"""
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
        # Generate wellness data with LLM
        response = await app.state.ollama.generate(prompt, schema=schema)
        wellness_data = json.loads(response)

        # Store wellness session
        app.state.db.store_wellness_session(req.session_id, req.mode, wellness_data)

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

        summary = await app.state.ollama.generate(summary_prompt)
        summary = summary.strip()
        if summary.startswith("Summary:"):
            summary = summary.replace("Summary:", "").strip()

        # Store session summary
        app.state.db.store_session_summary(
            req.session_id,
            "wellness",
            summary,
            json.dumps(wellness_data["key_themes"]),
            wellness_data["next_step_notes"],
            app.state.ollama.summarization_model,
        )

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
                db=app.state.db,
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

        # Use dedicated ambient session ID for isolated calls
        # This prevents internal LLM calls from polluting conversation history
        # Clean up old ambient session to avoid "already in use" errors
        if req.isolate_session:
            ambient_session_id = "10000000-0000-0000-0000-000000000001"

            # Delete ambient session file if it exists
            try:
                import shutil

                # Get Claude config directory based on OS
                match platform.system():
                    case "Windows":
                        config_home = Path(os.getenv("APPDATA", "")) / "Claude"
                    case "Darwin":
                        config_home = Path.home() / "Library" / "Application Support" / "Claude"
                    case _:
                        config_home = Path.home() / ".config" / "claude"

                # Find all project directories
                if config_home.exists():
                    for project_dir in config_home.glob("projects/*"):
                        ambient_session_path = project_dir / ambient_session_id
                        if ambient_session_path.exists():
                            shutil.rmtree(ambient_session_path)
                            logger.debug("Cleaned up old ambient session: {}", ambient_session_path)
            except Exception as e:
                logger.debug("Failed to clean ambient session (non-fatal): {}", e)

            cmd.extend(["--session-id", ambient_session_id])

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
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
async def presence_register(req: PresenceRegisterRequest):
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

    logger.info(
        "Presence registered: {} for user {} with {} channels",
        req.medium,
        req.user_id,
        len(req.available_channels),
    )
    app.state.db.register_presence(req.medium, req.user_id, req.available_channels)
    return {"status": "registered"}


@app.post("/presence/heartbeat")
async def presence_heartbeat(req: PresenceHeartbeatRequest):
    """Heartbeat to keep medium alive.

    Bots should call this every 30s to maintain presence.
    """
    app.state.db.heartbeat_presence(req.medium, req.user_id)
    return {"status": "ok"}


@app.post("/presence/unregister")
async def presence_unregister(req: PresenceUnregisterRequest):
    """Cleanly unregister a medium on shutdown."""

    logger.info("Presence unregistered: {} for user {}", req.medium, req.user_id)
    app.state.db.unregister_presence(req.medium, req.user_id)
    return {"status": "unregistered"}


@app.get("/presence/available")
async def presence_available(user_id: str):
    """Get all online mediums for a user.

    Returns mediums that can currently receive messages.
    """
    mediums = app.state.db.get_available_mediums(user_id)
    return {"mediums": mediums}


@app.post("/routing/decide")
async def routing_decide(req: RoutingDecideRequest):
    """Use LLM to decide where to route a message based on context.

    This is the core of omnipresent routing - NO hardcoded rules.
    LLM analyzes available mediums, user activity, recent conversations,
    and makes an intelligent decision about where to deliver the message.
    """
    from dere_daemon.routing import decide_routing

    # Get available mediums
    available_mediums = app.state.db.get_available_mediums(req.user_id)

    # Get recent conversations to understand where user has been active
    # Query last 10 conversations across all mediums
    result = app.state.db.conn.execute(
        """
        SELECT medium, timestamp, prompt
        FROM conversations
        WHERE user_id = %s AND medium IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 10
        """,
        [req.user_id],
    )
    recent_conversations = app.state.db._rows_to_dicts(result, result.fetchall())

    # Make routing decision
    decision = await decide_routing(
        user_id=req.user_id,
        message=req.message,
        priority=req.priority,
        available_mediums=available_mediums,
        user_activity=req.user_activity,
        recent_conversations=recent_conversations,
        db=app.state.db,
    )

    return {
        "medium": decision.medium,
        "location": decision.location,
        "reasoning": decision.reasoning,
        "fallback": decision.fallback,
    }


@app.post("/notifications/create")
async def notifications_create(req: NotificationCreateRequest):
    """Create a notification in the queue for delivery.

    Called by ambient monitor when it decides to engage.
    """

    notification_id = app.state.db.create_notification(
        user_id=req.user_id,
        target_medium=req.target_medium,
        target_location=req.target_location,
        message=req.message,
        priority=req.priority,
        routing_reasoning=req.routing_reasoning,
    )
    logger.info(
        "Notification {} created: {} -> {} ({})",
        notification_id,
        req.target_medium,
        req.target_location,
        req.priority,
    )
    return {"notification_id": notification_id, "status": "queued"}


@app.get("/notifications/pending")
async def notifications_pending(medium: str):
    """Get pending notifications for a specific medium.

    Bots poll this endpoint to retrieve messages that need to be delivered.
    """
    notifications = app.state.db.get_pending_notifications(medium)
    return {"notifications": notifications}


@app.post("/notifications/{notification_id}/delivered")
async def notification_delivered(notification_id: int):
    """Mark a notification as successfully delivered.

    Called by bots after successfully sending a message.
    """

    app.state.db.mark_notification_delivered(notification_id)
    logger.info("Notification {} marked as delivered", notification_id)
    return {"status": "delivered"}


@app.post("/notifications/{notification_id}/failed")
async def notification_failed(notification_id: int, req: NotificationFailedRequest):
    """Mark a notification as failed with error message.

    Called by bots when message delivery fails.
    """

    app.state.db.mark_notification_failed(notification_id, req.error_message)
    logger.warning("Notification {} failed: {}", notification_id, req.error_message)
    return {"status": "failed"}


@app.post("/api/synthesis/run", response_model=SynthesisRunResponse)
async def run_synthesis(req: SynthesisRunRequest):
    """Run synthesis across conversations for a personality combination"""
    from dere_shared.synthesis import ConversationStream, PatternDetector

    personality_combo = tuple(req.personality_combo)

    # Stream conversations
    stream = ConversationStream(app.state.db)
    conversations = stream.stream_for_personality(personality_combo)

    if not conversations:
        return SynthesisRunResponse(
            success=True,
            total_sessions=0,
            insights_generated=0,
            patterns_detected=0,
            entity_collisions=0,
        )

    # Build analysis data
    cooccurrences = stream.build_cooccurrence_matrix(conversations)
    entity_frequencies = stream.compute_entity_frequencies(conversations)
    temporal_data = stream.get_temporal_patterns(conversations)

    # Detect patterns
    detector = PatternDetector(min_frequency=3)
    convergence_patterns = detector.find_convergence_patterns(cooccurrences, personality_combo)
    temporal_patterns = detector.find_temporal_patterns(
        temporal_data, entity_frequencies, personality_combo
    )
    divergence_patterns = detector.find_divergence_patterns(
        entity_frequencies, cooccurrences, personality_combo
    )
    frequency_leaders = detector.find_frequency_leaders(entity_frequencies, personality_combo)

    all_patterns = (
        convergence_patterns + temporal_patterns + divergence_patterns + frequency_leaders
    )

    # Find entity collisions
    collisions = app.state.db.find_entity_collisions(personality_combo)

    # Store patterns
    patterns_stored = 0
    for pattern in all_patterns:
        app.state.db.store_pattern(
            pattern_type=pattern.pattern_type,
            description=pattern.description,
            frequency=pattern.frequency,
            sessions=pattern.sessions,
            personality_combo=personality_combo,
            user_session_id=req.user_session_id,
        )
        patterns_stored += 1

    # Count unique sessions
    session_ids = {conv["session_id"] for conv in conversations}

    return SynthesisRunResponse(
        success=True,
        total_sessions=len(session_ids),
        insights_generated=0,  # Will be implemented with LLM presentation layer
        patterns_detected=patterns_stored,
        entity_collisions=len(collisions),
    )


@app.post("/api/synthesis/insights")
async def get_insights(req: SynthesisInsightsRequest):
    """Get synthesized insights for a personality combination"""
    personality_combo = tuple(req.personality_combo)
    insights = app.state.db.get_insights_for_personality(personality_combo, limit=req.limit)

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
async def get_patterns(req: SynthesisPatternsRequest):
    """Get detected patterns for a personality combination"""
    personality_combo = tuple(req.personality_combo)
    patterns = app.state.db.get_patterns_for_personality(personality_combo, limit=req.limit)

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
async def consolidate_memory(user_id: str, recency_days: int = 30, model: str = "gemma3n:latest"):
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
    task_id = app.state.db.queue_task(
        task_type="memory_consolidation",
        model_name=model,
        content=f"Memory consolidation for user {user_id}",
        session_id=None,
        metadata={"user_id": user_id, "recency_days": recency_days},
    )

    # Wait for task to complete (or return immediately for async processing)
    # For now, return task ID for async processing
    return {
        "success": True,
        "task_id": task_id,
        "message": f"Memory consolidation queued for user {user_id}",
    }


async def generate_embedding_task(message_id: int, text: str) -> None:
    """Background task to generate and store embedding"""
    try:
        embedding = await app.state.ollama.get_embedding(text)
        app.state.db.update_conversation_embedding(message_id, embedding)

    except Exception as e:
        print(f"Failed to generate embedding for message {message_id}: {e}")


def main():
    """Main entry point for the daemon"""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info")


if __name__ == "__main__":
    main()
