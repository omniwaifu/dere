from __future__ import annotations

import json
import os
import platform
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI
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


class StoreMessageRequest(BaseModel):
    message: str
    role: str = "user"


class StoreMessageResponse(BaseModel):
    message_id: int


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    threshold: float = 0.7


class HookCaptureRequest(BaseModel):
    data: dict[str, Any]


# Global state
class AppState:
    db: Database
    ollama: OllamaClient
    processor: TaskProcessor


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

    app.state = AppState()
    app.state.db = Database(db_path)
    app.state.ollama = OllamaClient(
        base_url=ollama_config["url"],
        embedding_model=ollama_config["embedding_model"],
        summarization_model=ollama_config["summarization_model"],
    )
    app.state.processor = TaskProcessor(app.state.db, app.state.ollama)

    # Reset any stuck tasks from previous runs
    stuck_count = app.state.db.reset_stuck_tasks()
    if stuck_count > 0:
        print(f"Reset {stuck_count} stuck tasks to pending")

    # Start Ollama health checks
    await app.state.ollama.start()

    # Start task processor
    await app.state.processor.start()

    print(f"🚀 Dere daemon started - database: {db_path}")

    yield

    # Shutdown - collect all exceptions
    errors = []

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
    # Generate embedding for query
    embedding = await app.state.ollama.get_embedding(req.query)

    # Search database
    results = app.state.db.search_similar(embedding, limit=req.limit, threshold=req.threshold)

    return {"results": results}


@app.post("/embeddings/generate")
async def generate_embedding(text: str):
    """Generate embedding for text"""
    embedding = await app.state.ollama.get_embedding(text)
    return {"embedding": embedding, "model": app.state.ollama.embedding_model}


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

    return {"status": "stored"}


@app.post("/session/end")
async def session_end(req: SessionEndRequest):
    """Handle session end and queue summarization"""
    # Get session content
    content = app.state.db.get_session_content(req.session_id)

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
    """Get cached context for session"""
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


@app.post("/hooks/capture")
async def hook_capture(req: HookCaptureRequest):
    """Hook endpoint for capturing conversation data"""
    # Store the hook data
    return {"status": "received"}


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
