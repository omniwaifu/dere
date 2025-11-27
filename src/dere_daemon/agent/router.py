"""WebSocket and REST endpoints for the centralized agent service."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.models import Conversation

from ..dependencies import get_db
from .models import (
    AvailableOutputStylesResponse,
    AvailablePersonalitiesResponse,
    ClientMessage,
    ConversationMessage,
    MessageHistoryResponse,
    OutputStyleInfo,
    PersonalityInfo,
    SessionConfig,
    SessionListResponse,
    SessionResponse,
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
        - {"type": "close"} - Close connection

        Server sends JSON events (all include "seq" for reconnection support):
        - {"type": "session_ready", "data": {"session_id": ..., "config": ...}, "seq": N}
        - {"type": "text", "data": {"text": "..."}, "seq": N}
        - {"type": "tool_use", "data": {"name": "...", "input": {...}}, "seq": N}
        - {"type": "tool_result", "data": {"name": "...", "output": "...", "is_error": false}, "seq": N}
        - {"type": "thinking", "data": {"text": "..."}, "seq": N}
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

                try:
                    current_session = await service.create_session(msg.config)
                    await websocket.send_json(
                        session_ready_event(
                            current_session.session_id, current_session.config
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
                                current_session.session_id, current_session.config
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
                                current_session.session_id, current_session.config
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

            elif msg.type == "close":
                break

            else:
                await websocket.send_json(
                    error_event(f"Unknown message type: {msg.type}", recoverable=True).to_dict()
                )

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.exception("WebSocket error")
        try:
            await websocket.send_json(
                error_event(f"WebSocket error: {e}", recoverable=False).to_dict()
            )
        except Exception:
            pass
    finally:
        await websocket.close()


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(request: Request):
    """List all active agent sessions."""
    service = _get_service(request)
    sessions = await service.list_sessions()

    return SessionListResponse(
        sessions=[
            SessionResponse(session_id=sid, config=config, claude_session_id=None)
            for sid, config in sessions
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
    )


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: int, request: Request):
    """Close and delete a session."""
    service = _get_service(request)
    await service.close_session(session_id)
    return {"status": "deleted", "session_id": session_id}


@router.get("/sessions/{session_id}/messages", response_model=MessageHistoryResponse)
async def get_session_messages(
    session_id: int,
    limit: int = 50,
    before_timestamp: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Get paginated message history for a session.

    Args:
        session_id: The session to get messages for
        limit: Maximum number of messages to return (default 50, max 200)
        before_timestamp: Only return messages before this timestamp (for pagination)
    """
    limit = min(limit, 200)

    query = (
        select(Conversation)
        .where(Conversation.session_id == session_id)
        .order_by(Conversation.timestamp.desc())
        .limit(limit + 1)
    )

    if before_timestamp is not None:
        query = query.where(Conversation.timestamp < before_timestamp)

    result = await db.execute(query)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    messages_data = rows[:limit]

    messages = [
        ConversationMessage(
            id=m.id,
            message_type=m.message_type,
            content=m.prompt,
            timestamp=m.timestamp,
        )
        for m in reversed(messages_data)
    ]

    oldest_timestamp = messages[0].timestamp if messages else None

    return MessageHistoryResponse(
        messages=messages,
        has_more=has_more,
        oldest_timestamp=oldest_timestamp,
    )


@router.get("/output-styles", response_model=AvailableOutputStylesResponse)
async def list_output_styles():
    """List available output styles."""
    styles = [
        OutputStyleInfo(
            name="default",
            description="Default Claude Code output style",
        ),
        OutputStyleInfo(
            name="discord",
            description="Optimized for Discord messaging",
        ),
        OutputStyleInfo(
            name="web",
            description="Optimized for web interfaces",
        ),
        OutputStyleInfo(
            name="minimal",
            description="Minimal formatting, plain text",
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
