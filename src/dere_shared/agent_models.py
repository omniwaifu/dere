"""Shared models for the centralized agent API.

These models are used by both the daemon (server) and clients (Discord, WebUI).
"""

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


@dataclass
class StreamEvent:
    """A streaming event from the agent."""

    type: StreamEventType
    data: dict[str, Any]
    timestamp: float = field(default_factory=time.time)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StreamEvent:
        return cls(
            type=StreamEventType(d["type"]),
            data=d.get("data", {}),
            timestamp=d.get("timestamp", time.time()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "data": self.data,
            "timestamp": self.timestamp,
        }


class SessionConfig(BaseModel):
    """Configuration for an agent session."""

    working_dir: str = Field(..., description="Project/working directory")
    output_style: str = Field(default="default", description="Claude output style preset")
    personality: str | list[str] = Field(
        default="", description="Personality preset name(s)"
    )
    user_id: str | None = Field(default=None, description="User identifier")
    allowed_tools: list[str] | None = Field(
        default=None, description="Tool restrictions (None = default)"
    )
    include_context: bool = Field(
        default=True, description="Whether to inject emotion/KG context"
    )


class ClientMessageType(str, Enum):
    """Types of messages sent from client to daemon."""

    NEW_SESSION = "new_session"
    RESUME_SESSION = "resume_session"
    QUERY = "query"
    UPDATE_CONFIG = "update_config"
    CLOSE = "close"


@dataclass
class ClientMessage:
    """Message from client to daemon via WebSocket."""

    type: ClientMessageType
    config: SessionConfig | None = None
    session_id: int | None = None
    prompt: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"type": self.type.value}
        if self.config:
            d["config"] = self.config.model_dump()
        if self.session_id is not None:
            d["session_id"] = self.session_id
        if self.prompt is not None:
            d["prompt"] = self.prompt
        return d
