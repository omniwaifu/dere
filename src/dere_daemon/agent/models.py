"""Pydantic models for the centralized agent API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from dere_shared.agent_models import SessionConfig, StreamEvent, StreamEventType

__all__ = ["SessionConfig", "StreamEvent", "StreamEventType"]


class NewSessionRequest(BaseModel):
    """Request to create a new agent session."""

    config: SessionConfig


class ResumeSessionRequest(BaseModel):
    """Request to resume an existing session."""

    session_id: int


class UpdateConfigRequest(BaseModel):
    """Request to update session configuration."""

    config: SessionConfig


class QueryRequest(BaseModel):
    """Request to send a query to the agent."""

    prompt: str


class ClientMessage(BaseModel):
    """Message from client to daemon via WebSocket."""

    type: str
    config: SessionConfig | None = None
    session_id: int | None = None
    prompt: str | None = None
    last_seq: int | None = None
    # Permission response fields
    request_id: str | None = None
    allowed: bool | None = None
    deny_message: str | None = None


class SessionResponse(BaseModel):
    """Response with session information."""

    session_id: int
    config: SessionConfig
    claude_session_id: str | None = None
    name: str | None = None
    sandbox_mode: bool = False
    is_locked: bool = False
    mission_id: int | None = None


class SessionListResponse(BaseModel):
    """List of active sessions."""

    sessions: list[SessionResponse]


class OutputStyleInfo(BaseModel):
    """Information about an available output style."""

    name: str
    description: str


class PersonalityInfo(BaseModel):
    """Information about an available personality."""

    name: str
    description: str | None = None
    color: str | None = None
    icon: str | None = None


class AvailableOutputStylesResponse(BaseModel):
    """List of available output styles."""

    styles: list[OutputStyleInfo]


class AvailablePersonalitiesResponse(BaseModel):
    """List of available personalities."""

    personalities: list[PersonalityInfo]


class ModelInfo(BaseModel):
    """Information about an available Claude model."""

    id: str
    name: str
    description: str


class AvailableModelsResponse(BaseModel):
    """List of available Claude models."""

    models: list[ModelInfo]


class RecentDirectoriesResponse(BaseModel):
    """List of recently used working directories."""

    directories: list[str]


class ToolUseData(BaseModel):
    """Tool use in a message."""

    id: str
    name: str
    input: dict[str, Any] = Field(default_factory=dict)


class ToolResultData(BaseModel):
    """Tool result in a message."""

    tool_use_id: str
    name: str
    output: str
    is_error: bool = False


class ConversationMessage(BaseModel):
    """A single conversation message for history display."""

    id: str
    role: str  # "user" or "assistant"
    content: str
    timestamp: str
    thinking: str | None = None
    tool_uses: list[ToolUseData] = Field(default_factory=list)
    tool_results: list[ToolResultData] = Field(default_factory=list)
    blocks: list[dict[str, Any]] | None = None


class MessageHistoryResponse(BaseModel):
    """Paginated message history for a session."""

    messages: list[ConversationMessage]
    has_more: bool
