from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

# Python 3.13 type aliases
type SessionID = int
type Embedding = list[float]
type JSONDict = dict[str, Any]
type Timestamp = int


class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class MessageType(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class SummaryType(str, Enum):
    EXIT = "exit"
    PERIODIC = "periodic"
    MANUAL = "manual"


class RelationshipType(str, Enum):
    CONTINUATION = "continuation"
    SAME_PROJECT = "same_project"
    SIMILAR_CONTEXT = "similar_context"


class Session(BaseModel):
    id: SessionID | None = None
    working_dir: str
    start_time: Timestamp
    end_time: Timestamp | None = None
    continued_from: SessionID | None = None
    project_type: str | None = None
    created_at: datetime | None = None


class SessionPersonality(BaseModel):
    session_id: SessionID
    personality_name: str


class SessionMCP(BaseModel):
    session_id: SessionID
    mcp_name: str


class SessionFlag(BaseModel):
    session_id: SessionID
    flag_name: str
    flag_value: str | None = None


class Conversation(BaseModel):
    id: int | None = None
    session_id: SessionID
    prompt: str
    message_type: MessageType = MessageType.USER
    embedding_text: str | None = None
    processing_mode: str | None = None
    prompt_embedding: Embedding | None = None
    timestamp: Timestamp
    created_at: datetime | None = None


class TaskQueue(BaseModel):
    id: int | None = None
    task_type: str
    model_name: str
    content: str
    metadata: JSONDict | None = None
    priority: int = 5
    status: TaskStatus = TaskStatus.PENDING
    session_id: SessionID | None = None
    created_at: datetime | None = None
    processed_at: datetime | None = None
    retry_count: int = 0
    error_message: str | None = None


class Entity(BaseModel):
    id: int | None = None
    session_id: int
    conversation_id: int
    entity_type: str
    entity_value: str
    normalized_value: str
    confidence: float
    context_start: int | None = None
    context_end: int | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None


class EntityRelationship(BaseModel):
    id: int | None = None
    entity_1_id: int
    entity_2_id: int
    relationship_type: str
    confidence: float
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None


class SessionSummary(BaseModel):
    id: int | None = None
    session_id: int
    summary_type: SummaryType
    summary: str
    key_topics: list[str] | None = None
    key_entities: list[int] | None = None
    task_status: dict[str, Any] | None = None
    next_steps: str | None = None
    model_used: str | None = None
    processing_time_ms: int | None = None
    created_at: datetime | None = None


class ConversationSegment(BaseModel):
    id: int | None = None
    session_id: int
    segment_number: int
    segment_summary: str
    original_length: int
    summary_length: int
    start_conversation_id: int
    end_conversation_id: int
    model_used: str
    created_at: datetime | None = None


class ContextCache(BaseModel):
    session_id: int
    context_text: str
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SessionRelationship(BaseModel):
    session_id: int
    related_session_id: int
    relationship_type: RelationshipType
    strength: float = 1.0
    created_at: datetime | None = None


class WellnessSession(BaseModel):
    id: int | None = None
    session_id: int
    mode: str
    mood: int | None = None
    energy: int | None = None
    stress: int | None = None
    key_themes: str | None = None
    notes: str | None = None
    homework: str | None = None
    next_step_notes: str | None = None
    created_at: int | None = None
    updated_at: int | None = None


class Personality(BaseModel):
    """Personality configuration loaded from TOML"""

    name: str
    short_name: str
    aliases: list[str] = Field(default_factory=list)
    color: str = "white"
    icon: str = "●"
    prompt_content: str
