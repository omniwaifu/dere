"""WebSocket and REST endpoints for the centralized agent service."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.models import Conversation, Session

from ..dependencies import get_db
from .models import (
    AvailableModelsResponse,
    AvailableOutputStylesResponse,
    AvailablePersonalitiesResponse,
    ClientMessage,
    ConversationMessage,
    MessageHistoryResponse,
    ModelInfo,
    OutputStyleInfo,
    PersonalityInfo,
    RecentDirectoriesResponse,
    SessionConfig,
    SessionListResponse,
    SessionResponse,
    ToolResultData,
    ToolUseData,
)
from .streaming import error_event, session_ready_event

if TYPE_CHECKING:
    from .service import CentralizedAgentService

router = APIRouter(prefix="/agent", tags=["agent"])


def _get_service(request: Request) -> CentralizedAgentService:
    """Get agent service from app state."""
    return request.app.state.agent_service


@router.websocket("/ws")
async def agent_websocket(websocket: WebSocket):
    """WebSocket endpoint for streaming Claude responses.

    Protocol:
        Client sends JSON messages with "type" field:
        - {"type": "new_session", "config": {...}} - Start new session
        - {"type": "resume_session", "session_id": 123, "last_seq": N} - Resume session,
            optionally replay events after seq N
        - {"type": "query", "prompt": "..."} - Send query to current session
        - {"type": "update_config", "config": {...}} - Update session config
        - {"type": "cancel"} - Cancel the current query
        - {"type": "permission_response", "request_id": "...", "allowed": true/false,
            "deny_message": "..."} - Respond to a permission request
        - {"type": "close"} - Close connection

        Server sends JSON events (all include "seq" for reconnection support):
        - {"type": "session_ready", "data": {"session_id": ..., "config": ...}, "seq": N}
        - {"type": "text", "data": {"text": "..."}, "seq": N}
        - {"type": "tool_use", "data": {"name": "...", "input": {...}}, "seq": N}
        - {"type": "tool_result", "data": {"name": "...", "output": "...", "is_error": false}, "seq": N}
        - {"type": "thinking", "data": {"text": "..."}, "seq": N}
        - {"type": "permission_request", "data": {"request_id": "...", "tool_name": "...",
            "tool_input": {...}}, "seq": N}
        - {"type": "done", "data": {"response_text": "...", "tool_count": 0}, "seq": N}
        - {"type": "cancelled", "data": {"message": "..."}, "seq": N}
        - {"type": "error", "data": {"message": "...", "recoverable": true}, "seq": N}
    """
    await websocket.accept()

    service: CentralizedAgentService = websocket.app.state.agent_service
    current_session = None

    try:
        while True:
            data = await websocket.receive_json()

            try:
                msg = ClientMessage(**data)
            except ValidationError as e:
                await websocket.send_json(
                    error_event(f"Invalid message: {e}", recoverable=True).to_dict()
                )
                continue

            if msg.type == "new_session":
                if not msg.config:
                    await websocket.send_json(
                        error_event("new_session requires config", recoverable=True).to_dict()
                    )
                    continue

                logger.info("new_session config: {}", msg.config.model_dump())

                try:
                    current_session = await service.create_session(msg.config)
                    await websocket.send_json(
                        session_ready_event(
                            current_session.session_id,
                            current_session.config,
                            is_locked=current_session.is_locked,
                            name=current_session.name,
                        ).to_dict()
                    )
                except Exception as e:
                    logger.exception("Failed to create session")
                    await websocket.send_json(
                        error_event(f"Failed to create session: {e}", recoverable=True).to_dict()
                    )

            elif msg.type == "resume_session":
                if msg.session_id is None:
                    await websocket.send_json(
                        error_event(
                            "resume_session requires session_id", recoverable=True
                        ).to_dict()
                    )
                    continue

                try:
                    current_session = await service.resume_session(msg.session_id)
                    if current_session:
                        await websocket.send_json(
                            session_ready_event(
                                current_session.session_id,
                                current_session.config,
                                is_locked=current_session.is_locked,
                                name=current_session.name,
                            ).to_dict()
                        )
                        if msg.last_seq is not None:
                            missed_events = service.get_missed_events(msg.session_id, msg.last_seq)
                            for event in missed_events:
                                await websocket.send_json(event.to_dict())
                    else:
                        await websocket.send_json(
                            error_event(
                                f"Session {msg.session_id} not found", recoverable=True
                            ).to_dict()
                        )
                except Exception as e:
                    logger.exception("Failed to resume session")
                    await websocket.send_json(
                        error_event(f"Failed to resume session: {e}", recoverable=True).to_dict()
                    )

            elif msg.type == "query":
                if not current_session:
                    await websocket.send_json(
                        error_event(
                            "No active session. Send new_session or resume_session first.",
                            recoverable=True,
                        ).to_dict()
                    )
                    continue

                if not msg.prompt:
                    await websocket.send_json(
                        error_event("query requires prompt", recoverable=True).to_dict()
                    )
                    continue

                try:
                    async for event in service.query(current_session, msg.prompt):
                        await websocket.send_json(event.to_dict())
                except Exception as e:
                    logger.exception("Query failed")
                    await websocket.send_json(
                        error_event(f"Query failed: {e}", recoverable=True).to_dict()
                    )

            elif msg.type == "update_config":
                if not current_session:
                    await websocket.send_json(
                        error_event("No active session to update", recoverable=True).to_dict()
                    )
                    continue

                if not msg.config:
                    await websocket.send_json(
                        error_event("update_config requires config", recoverable=True).to_dict()
                    )
                    continue

                try:
                    current_session = await service.update_session_config(
                        current_session.session_id, msg.config
                    )
                    if current_session:
                        await websocket.send_json(
                            session_ready_event(
                                current_session.session_id,
                                current_session.config,
                                is_locked=current_session.is_locked,
                                name=current_session.name,
                            ).to_dict()
                        )
                except Exception as e:
                    logger.exception("Failed to update config")
                    await websocket.send_json(
                        error_event(f"Failed to update config: {e}", recoverable=True).to_dict()
                    )

            elif msg.type == "cancel":
                if not current_session:
                    await websocket.send_json(
                        error_event("No active session to cancel", recoverable=True).to_dict()
                    )
                    continue

                cancelled = await service.cancel_query(current_session.session_id)
                if not cancelled:
                    await websocket.send_json(
                        error_event("No active query to cancel", recoverable=True).to_dict()
                    )

            elif msg.type == "permission_response":
                if not current_session:
                    await websocket.send_json(
                        error_event(
                            "No active session for permission response", recoverable=True
                        ).to_dict()
                    )
                    continue

                if not msg.request_id:
                    await websocket.send_json(
                        error_event(
                            "permission_response requires request_id", recoverable=True
                        ).to_dict()
                    )
                    continue

                if msg.allowed is None:
                    await websocket.send_json(
                        error_event(
                            "permission_response requires allowed field", recoverable=True
                        ).to_dict()
                    )
                    continue

                resolved = current_session.resolve_permission(
                    msg.request_id, msg.allowed, msg.deny_message or ""
                )
                if not resolved:
                    await websocket.send_json(
                        error_event(
                            f"Unknown permission request: {msg.request_id}", recoverable=True
                        ).to_dict()
                    )

            elif msg.type == "ping":
                # Heartbeat response for client keepalive
                await websocket.send_json({"type": "pong", "timestamp": time.time()})

            elif msg.type == "close":
                break

            else:
                await websocket.send_json(
                    error_event(f"Unknown message type: {msg.type}", recoverable=True).to_dict()
                )

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except asyncio.CancelledError:
        logger.debug("WebSocket cancelled")
    except Exception as e:
        logger.exception("WebSocket error")
        try:
            await websocket.send_json(
                error_event(f"WebSocket error: {e}", recoverable=False).to_dict()
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except (RuntimeError, asyncio.CancelledError):
            pass  # Already closed or cancelled


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(request: Request, db: AsyncSession = Depends(get_db)):
    """List all sessions from the database."""
    # Query sessions from database, not in-memory cache
    result = await db.execute(
        select(Session)
        .where(Session.medium == "agent_api")
        .order_by(Session.start_time.desc())
        .limit(50)
    )
    db_sessions = result.scalars().all()

    return SessionListResponse(
        sessions=[
            SessionResponse(
                session_id=s.id,
                config=SessionConfig(
                    working_dir=s.working_dir,
                    output_style="default",
                    personality=s.personality or "",
                    user_id=s.user_id,
                ),
                claude_session_id=s.claude_session_id,
                name=s.name,
                sandbox_mode=s.sandbox_mode,
                is_locked=s.is_locked,
                mission_id=s.mission_id,
            )
            for s in db_sessions
        ]
    )


@router.post("/sessions", response_model=SessionResponse)
async def create_session(config: SessionConfig, request: Request):
    """Create a new agent session."""
    service = _get_service(request)
    session = await service.create_session(config)

    return SessionResponse(
        session_id=session.session_id,
        config=session.config,
        claude_session_id=session.claude_session_id,
        sandbox_mode=session.config.sandbox_mode,
    )


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: int, request: Request):
    """Get session details."""
    service = _get_service(request)
    session = await service.get_session(session_id)

    if not session:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Session not found")

    return SessionResponse(
        session_id=session.session_id,
        config=session.config,
        claude_session_id=session.claude_session_id,
        sandbox_mode=session.config.sandbox_mode,
    )


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(session_id: int, config: SessionConfig, request: Request):
    """Update session configuration."""
    service = _get_service(request)
    session = await service.update_session_config(session_id, config)

    if not session:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Session not found")

    return SessionResponse(
        session_id=session.session_id,
        config=session.config,
        claude_session_id=session.claude_session_id,
        sandbox_mode=session.config.sandbox_mode,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    """Close and delete a session from both memory and database."""
    service = _get_service(request)

    # Close in-memory session if active
    await service.close_session(session_id)

    # Delete from database
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session:
        # Also delete associated conversations
        await db.execute(
            Conversation.__table__.delete().where(Conversation.session_id == session_id)
        )
        await db.delete(session)
        await db.commit()

    return {"status": "deleted", "session_id": session_id}


@router.get("/sessions/{session_id}/messages", response_model=MessageHistoryResponse)
async def get_session_messages(
    session_id: int,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """Get message history for a session from Claude Code's JSONL storage."""
    import json
    from pathlib import Path

    # Get session info from database
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()

    if not session or not session.claude_session_id:
        return MessageHistoryResponse(messages=[], has_more=False)

    # Build path to JSONL file (Claude encodes "/" as "-" in path)
    # For sandbox sessions, the container uses /workspace as cwd regardless of config
    if session.sandbox_mode:
        cwd = "/workspace"
    else:
        cwd = session.working_dir
    if cwd != "/" and cwd.endswith("/"):
        cwd = cwd.rstrip("/")
    encoded_cwd = cwd.replace("/", "-")
    jsonl_path = Path.home() / ".claude" / "projects" / encoded_cwd / f"{session.claude_session_id}.jsonl"

    if not jsonl_path.exists():
        return MessageHistoryResponse(messages=[], has_more=False)

    messages: list[ConversationMessage] = []

    with jsonl_path.open() as f:
        for line in f:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("type") not in ("user", "assistant"):
                continue

            msg_data = entry.get("message", {})
            content_blocks = msg_data.get("content", [])
            if isinstance(content_blocks, str):
                content_blocks = [{"type": "text", "text": content_blocks}]

            text_parts = []
            thinking_parts = []
            tool_uses = []
            tool_results = []

            for block in content_blocks:
                if isinstance(block, str):
                    text_parts.append(block)
                elif block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "thinking":
                    thinking_parts.append(block.get("thinking", ""))
                elif block.get("type") == "tool_use":
                    tool_uses.append(ToolUseData(
                        id=block.get("id", ""),
                        name=block.get("name", ""),
                        input=block.get("input", {}),
                    ))
                elif block.get("type") == "tool_result":
                    content = block.get("content", "")
                    if isinstance(content, list):
                        content = "\n".join(
                            c.get("text", "") if isinstance(c, dict) else str(c)
                            for c in content
                        )
                    tool_results.append(ToolResultData(
                        tool_use_id=block.get("tool_use_id", ""),
                        name="",  # Not in tool_result block
                        output=content,
                        is_error=block.get("is_error", False),
                    ))

            messages.append(ConversationMessage(
                id=entry.get("uuid", ""),
                role=entry.get("type", ""),
                content="".join(text_parts),
                timestamp=entry.get("timestamp", ""),
                thinking="".join(thinking_parts) if thinking_parts else None,
                tool_uses=tool_uses,
                tool_results=tool_results,
            ))

    # Apply limit
    # Claude Code may emit multiple consecutive assistant entries for a single turn
    # (e.g., one with thinking, another with final text). Merge consecutive assistant
    # entries so the UI can treat each user/assistant turn as a single message.
    merged: list[ConversationMessage] = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg.role != "assistant":
            merged.append(msg)
            i += 1
            continue

        acc = msg
        j = i + 1
        while j < len(messages) and messages[j].role == "assistant":
            nxt = messages[j]
            acc = ConversationMessage(
                id=nxt.id or acc.id,
                role="assistant",
                content=(acc.content or "") + (nxt.content or ""),
                timestamp=nxt.timestamp or acc.timestamp,
                thinking=(
                    ((acc.thinking or "") + (nxt.thinking or "")) or None
                ),
                tool_uses=[*acc.tool_uses, *nxt.tool_uses],
                tool_results=[*acc.tool_results, *nxt.tool_results],
            )
            j += 1

        merged.append(acc)
        i = j

    messages = merged

    if len(messages) > limit:
        messages = messages[-limit:]

    return MessageHistoryResponse(messages=messages, has_more=False)


@router.get("/sessions/{session_id}/metrics")
async def get_session_metrics(
    session_id: int,
    limit: int = 300,
    db: AsyncSession = Depends(get_db),
):
    """Get per-message metrics from the DB for UI overlay."""
    stmt = (
        select(Conversation)
        .where(Conversation.session_id == session_id, Conversation.medium == "agent_api")
        .order_by(Conversation.created_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()
    return {
        "messages": [
            {
                "id": msg.id,
                "message_type": msg.message_type,
                "timestamp": msg.timestamp,
                "created_at": int(msg.created_at.timestamp() * 1000) if msg.created_at else None,
                "personality": msg.personality,
                "ttft_ms": msg.ttft_ms,
                "response_ms": msg.response_ms,
                "thinking_ms": msg.thinking_ms,
                "tool_uses": msg.tool_uses,
                "tool_names": msg.tool_names,
            }
            for msg in messages
        ]
    }


@router.get("/output-styles", response_model=AvailableOutputStylesResponse)
async def list_output_styles():
    """List available output styles.

    Output styles from plugins need the plugin prefix (e.g., dere-core:discord).
    """
    styles = [
        OutputStyleInfo(
            name="default",
            description="Default Claude Code output style",
        ),
        OutputStyleInfo(
            name="dere-core:discord",
            description="Optimized for Discord messaging",
        ),
    ]
    return AvailableOutputStylesResponse(styles=styles)


@router.get("/personalities", response_model=AvailablePersonalitiesResponse)
async def list_personalities(request: Request):
    """List available personalities."""
    service = _get_service(request)
    names = service.personality_loader.list_available()

    personalities = []
    for name in names:
        try:
            p = service.personality_loader.load(name)
            personalities.append(
                PersonalityInfo(
                    name=name,
                    description=p.prompt_content[:100] + "..."
                    if len(p.prompt_content) > 100
                    else p.prompt_content,
                    color=p.color,
                    icon=p.icon,
                )
            )
        except Exception:
            personalities.append(PersonalityInfo(name=name))

    return AvailablePersonalitiesResponse(personalities=personalities)


class RenameSessionRequest(BaseModel):
    """Request to rename a session."""

    name: str


@router.patch("/sessions/{session_id}/name")
async def rename_session(
    session_id: int, request: RenameSessionRequest, db: AsyncSession = Depends(get_db)
):
    """Rename a session."""
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.name = request.name.strip()[:50]  # Truncate to 50 chars
    await db.commit()

    return {"name": session.name}


@router.post("/sessions/{session_id}/generate-name")
async def generate_session_name(
    session_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Generate a short descriptive name for a session using Haiku 4.5.

    Fetches the first user message and assistant response from JSONL (or in-memory
    for sandbox sessions), then calls Haiku to generate a 2-4 word title.
    """
    import json
    from pathlib import Path

    from fastapi import HTTPException

    # Check if session exists and doesn't already have a name
    session_result = await db.execute(select(Session).where(Session.id == session_id))
    session = session_result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.name:
        return {"name": session.name, "generated": False}

    first_user_content: str | None = None
    first_assistant_content: str | None = None

    # For active sandbox sessions, try in-memory state first
    if session.sandbox_mode and not session.is_locked:
        service = _get_service(request)
        agent_session = await service.get_session(session_id)
        if agent_session:
            first_user_content = agent_session.initial_prompt
            first_assistant_content = agent_session.first_response_text

    # Fall back to JSONL file (for non-sandbox, or locked sandbox sessions)
    if first_user_content is None:
        if not session.claude_session_id:
            raise HTTPException(status_code=400, detail="Session has no claude_session_id")

        # For sandbox sessions, container uses /workspace as cwd
        if session.sandbox_mode:
            cwd = "/workspace"
        else:
            cwd = session.working_dir
        if cwd != "/" and cwd.endswith("/"):
            cwd = cwd.rstrip("/")
        encoded_cwd = cwd.replace("/", "-")
        jsonl_path = (
            Path.home() / ".claude" / "projects" / encoded_cwd / f"{session.claude_session_id}.jsonl"
        )

        if not jsonl_path.exists():
            raise HTTPException(status_code=400, detail="JSONL file not found")

        with jsonl_path.open() as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg_type = entry.get("type")
                if msg_type not in ("user", "assistant"):
                    continue

                msg_data = entry.get("message", {})
                content_blocks = msg_data.get("content", [])
                if isinstance(content_blocks, str):
                    content_blocks = [{"type": "text", "text": content_blocks}]

                text_parts = []
                for block in content_blocks:
                    if isinstance(block, str):
                        text_parts.append(block)
                    elif block.get("type") == "text":
                        text_parts.append(block.get("text", ""))

                content = "".join(text_parts)
                if not content:
                    continue

                if msg_type == "user" and first_user_content is None:
                    first_user_content = content
                elif msg_type == "assistant" and first_assistant_content is None:
                    first_assistant_content = content

                if first_user_content and first_assistant_content:
                    break

    if not first_user_content:
        raise HTTPException(status_code=400, detail="No user message found")

    # Generate name with Haiku
    try:
        from dere_graph.llm_client import ClaudeClient, Message

        client = ClaudeClient(model="claude-haiku-4-5")

        prompt = (
            "Generate a 2-4 word title for this conversation. "
            "Output ONLY the title - no explanation, no quotes, no punctuation except spaces.\n\n"
            f"User message: {first_user_content[:300]}\n"
        )
        if first_assistant_content:
            prompt += f"Assistant response: {first_assistant_content[:200]}\n"
        prompt += "\nTitle:"

        response = await client.generate_text_response(
            [Message(role="user", content=prompt)]
        )

        # Clean up the response - take first line, remove quotes/punctuation
        name = response.strip().split("\n")[0].strip()
        name = name.strip('"\'').strip()
        # Remove common prefixes if model adds them
        for prefix in ["Title:", "title:", "Title", "title"]:
            if name.startswith(prefix):
                name = name[len(prefix):].strip()
        # Truncate if too long (keep it short)
        if len(name) > 50:
            name = name[:47] + "..."

        # Save to database
        session.name = name
        await db.commit()

        logger.info("Generated session name '{}' for session {}", name, session_id)
        return {"name": name, "generated": True}

    except Exception as e:
        logger.error("Failed to generate session name: {}", e)
        raise HTTPException(status_code=500, detail=f"Failed to generate name: {e}")


@router.get("/models", response_model=AvailableModelsResponse)
async def list_models():
    """List available Claude models."""
    models = [
        ModelInfo(
            id="claude-opus-4-5",
            name="Opus 4.5",
            description="Premium model with maximum intelligence",
        ),
        ModelInfo(
            id="claude-sonnet-4-5",
            name="Sonnet 4.5",
            description="Smart model for complex agents and coding",
        ),
        ModelInfo(
            id="claude-haiku-4-5",
            name="Haiku 4.5",
            description="Fastest model with near-frontier intelligence",
        ),
    ]
    return AvailableModelsResponse(models=models)


@router.get("/recent-directories", response_model=RecentDirectoriesResponse)
async def list_recent_directories(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """List recently used working directories from session history."""
    from sqlalchemy import func

    result = await db.execute(
        select(Session.working_dir)
        .where(Session.medium == "agent_api")
        .group_by(Session.working_dir)
        .order_by(func.max(Session.start_time).desc())
        .limit(limit)
    )
    directories = [row[0] for row in result.fetchall()]
    return RecentDirectoriesResponse(directories=directories)
