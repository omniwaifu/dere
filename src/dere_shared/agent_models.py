"""Shared models for the centralized agent API.

These models are used by both the daemon (server) and clients (Discord, WebUI).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal

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
    PERMISSION_REQUEST = "permission_request"


@dataclass
class StreamEvent:
    """A streaming event from the agent."""

    type: StreamEventType
    data: dict[str, Any]
    timestamp: float = field(default_factory=time.time)
    seq: int | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StreamEvent:
        return cls(
            type=StreamEventType(d["type"]),
            data=d.get("data", {}),
            timestamp=d.get("timestamp", time.time()),
        )

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
    personality: str | list[str] = Field(
        default="", description="Personality preset name(s)"
    )
    model: str | None = Field(
        default=None, description="Claude model to use (e.g., claude-sonnet-4-20250514)"
    )
    user_id: str | None = Field(default=None, description="User identifier")
    allowed_tools: list[str] | None = Field(
        default=None, description="Tool restrictions (None = default)"
    )
    include_context: bool = Field(
        default=True, description="Whether to inject emotion/KG context"
    )
    enable_streaming: bool = Field(
        default=False, description="Enable token-level streaming (dere_ui only)"
    )
    thinking_budget: int | None = Field(
        default=None,
        description="Extended thinking token budget (None = disabled, e.g. 10000 for moderate thinking)",
    )
    sandbox_mode: bool = Field(
        default=False, description="Run in Docker sandbox for isolation"
    )
    sandbox_mount_type: Literal["direct", "copy", "none"] = Field(
        default="copy",
        description="How to mount working directory: direct (rw), copy (temp), none (empty)",
    )
    sandbox_settings: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Anthropic SandboxSettings for command sandboxing/network plumbing. "
            "Filesystem/network access is still governed by permission rules."
        ),
    )
    sandbox_network_mode: Literal["bridge", "host"] = Field(
        default="bridge",
        description="Docker network mode: bridge (isolated) or host (shares host network)",
    )
    mission_id: int | None = Field(
        default=None, description="Mission ID if spawned by a mission"
    )
    session_name: str | None = Field(
        default=None, description="Optional session name (e.g., mission name)"
    )
    auto_approve: bool = Field(
        default=False, description="Auto-approve all tool permissions (for autonomous missions)"
    )

    # Swarm-related fields
    lean_mode: bool = Field(
        default=False,
        description="Lean mode: skip emotion/KG context injection for swarm agents",
    )
    swarm_agent_id: int | None = Field(
        default=None, description="SwarmAgent ID if spawned by swarm system"
    )
    plugins: list[str] | None = Field(
        default=None,
        description="Explicit plugin list (None = auto-detect based on working_dir)",
    )
    env: dict[str, str] | None = Field(
        default=None,
        description="Additional environment variables to pass to the agent process",
    )


class ClientMessageType(str, Enum):
    """Types of messages sent from client to daemon."""

    NEW_SESSION = "new_session"
    RESUME_SESSION = "resume_session"
    QUERY = "query"
    UPDATE_CONFIG = "update_config"
    PING = "ping"
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
