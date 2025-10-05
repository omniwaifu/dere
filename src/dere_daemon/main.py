from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from dere_daemon.database import Database
from dere_daemon.ollama_client import OllamaClient
from dere_shared.models import Conversation, MessageType, Session, TaskQueue, TaskStatus


# Request/Response models
class CreateSessionRequest(BaseModel):
    working_dir: str
    personality: str
    medium: str = "cli"


class CreateSessionResponse(BaseModel):
    session_id: int


class StoreMessageRequest(BaseModel):
    session_id: int
    message: str
    role: MessageType = MessageType.USER


class StoreMessageResponse(BaseModel):
    message_id: int


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    threshold: float = 0.7


class HookCaptureRequest(BaseModel):
    session_id: int
    data: dict[str, Any]


# Global state
class AppState:
    db: Database
    ollama: OllamaClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown"""
    # Startup
    data_dir = Path.home() / ".local" / "share" / "dere"
    if os.name == "nt":
        data_dir = Path(os.getenv("LOCALAPPDATA", "")) / "dere"
    elif os.uname().sysname == "Darwin":
        data_dir = Path.home() / "Library" / "Application Support" / "dere"

    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "dere.db"

    app.state = AppState()
    app.state.db = Database(db_path)
    app.state.ollama = OllamaClient()

    # Start Ollama health checks
    await app.state.ollama.start()

    print(f"🚀 Dere daemon started - database: {db_path}")

    yield

    # Shutdown
    await app.state.ollama.shutdown()
    app.state.db.close()
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


@app.post("/hooks/capture")
async def hook_capture(req: HookCaptureRequest):
    """Hook endpoint for capturing conversation data"""
    # Store the hook data
    # TODO: Implement proper hook processing
    return {"status": "received"}


@app.get("/queue/stats")
async def queue_stats():
    """Get queue statistics"""
    # TODO: Implement queue stats query
    return {"pending": 0, "processing": 0, "completed": 0, "failed": 0}


async def generate_embedding_task(message_id: int, text: str) -> None:
    """Background task to generate and store embedding"""
    try:
        embedding = await app.state.ollama.get_embedding(text)

        # TODO: Update conversation with embedding
        # app.state.db.update_conversation_embedding(message_id, embedding)

    except Exception as e:
        print(f"Failed to generate embedding for message {message_id}: {e}")


def main():
    """Main entry point for the daemon"""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


if __name__ == "__main__":
    main()
