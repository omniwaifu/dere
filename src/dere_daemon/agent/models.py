"""Pydantic models for the centralized agent API."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class StreamEventType(str, Enum):
    """Types of streaming events from the agent."""

    SESSION_READY = "session_ready"
    TEXT = "text"
    TOOL_USE = "tool_use"
    TOOL_RESULT = "tool_result"
    THINKING = "thinking"
    ERROR = "error"
    DONE = "done"
    CANCELLED = "cancelled"


@dataclass
class StreamEvent:
    """A streaming event from the agent."""

    type: StreamEventType
    data: dict[str, Any]
    timestamp: float = field(default_factory=time.time)
    seq: int | None = None

    def to_dict(self) -> dict[str, Any]:
        result = {
            "type": self.type.value,
            "data": self.data,
            "timestamp": self.timestamp,
        }
        if self.seq is not None:
            result["seq"] = self.seq
        return result


class SessionConfig(BaseModel):
    """Configuration for an agent session."""

    working_dir: str = Field(..., description="Project/working directory")
    output_style: str = Field(default="default", description="Claude output style preset")
    personality: str | list[str] = Field(default="", description="Personality preset name(s)")
    model: str | None = Field(default=None, description="Claude model to use (e.g., claude-sonnet-4-20250514)")
    user_id: str | None = Field(default=None, description="User identifier")
    allowed_tools: list[str] | None = Field(
        default=None, description="Tool restrictions (None = default)"
    )
    include_context: bool = Field(default=True, description="Whether to inject emotion/KG context")


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


class SessionResponse(BaseModel):
    """Response with session information."""

    session_id: int
    config: SessionConfig
    claude_session_id: str | None = None
    name: str | None = None


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
    tool_uses: list[ToolUseData] = Field(default_factory=list)
    tool_results: list[ToolResultData] = Field(default_factory=list)


class MessageHistoryResponse(BaseModel):
    """Paginated message history for a session."""

    messages: list[ConversationMessage]
    has_more: bool
