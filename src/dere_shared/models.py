from datetime import datetime
from enum import Enum
from typing import Any, NotRequired, TypedDict

from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, Relationship, SQLModel

# Python 3.13 type aliases
type SessionID = int
type Embedding = list[float]
type JSONDict = dict[str, Any]
type Timestamp = int


# Enums
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


# SQLModel Table Models
class Session(SQLModel, table=True):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("sessions_working_dir_idx", "working_dir"),
        Index("sessions_start_time_idx", "start_time", postgresql_ops={"start_time": "DESC"}),
    )

    id: int | None = Field(default=None, primary_key=True)
    working_dir: str
    start_time: int
    end_time: int | None = None
    last_activity: datetime = Field(default_factory=datetime.utcnow)
    continued_from: int | None = Field(default=None, foreign_key="sessions.id")
    project_type: str | None = None
    claude_session_id: str | None = None
    personality: str | None = None
    medium: str | None = None
    user_id: str | None = None
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    conversations: list["Conversation"] = Relationship(back_populates="session")
    mcps: list["SessionMCP"] = Relationship(back_populates="session")
    flags: list["SessionFlag"] = Relationship(back_populates="session")
    entities: list["Entity"] = Relationship(back_populates="session")
    session_summaries: list["SessionSummary"] = Relationship(back_populates="session")
    conversation_segments: list["ConversationSegment"] = Relationship(back_populates="session")
    context_caches: list["ContextCache"] = Relationship(back_populates="session")
    wellness_sessions: list["WellnessSession"] = Relationship(back_populates="session")
    emotion_states: list["EmotionState"] = Relationship(back_populates="session")
    stimulus_histories: list["StimulusHistory"] = Relationship(back_populates="session")


class SessionMCP(SQLModel, table=True):
    __tablename__ = "session_mcps"

    session_id: int = Field(foreign_key="sessions.id", primary_key=True)
    mcp_name: str = Field(primary_key=True)

    # Relationships
    session: "Session" = Relationship(back_populates="mcps")


class SessionFlag(SQLModel, table=True):
    __tablename__ = "session_flags"

    session_id: int = Field(foreign_key="sessions.id", primary_key=True)
    flag_name: str = Field(primary_key=True)
    flag_value: str | None = None

    # Relationships
    session: "Session" = Relationship(back_populates="flags")


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"
    __table_args__ = (
        Index("conversations_session_idx", "session_id"),
        Index("conversations_timestamp_idx", "timestamp", postgresql_ops={"timestamp": "DESC"}),
        Index("conversations_medium_idx", "medium", postgresql_where=text("medium IS NOT NULL")),
        Index("conversations_user_id_idx", "user_id", postgresql_where=text("user_id IS NOT NULL")),
        Index(
            "conversations_medium_timestamp_idx",
            "medium",
            "timestamp",
            postgresql_where=text("medium IS NOT NULL"),
            postgresql_ops={"timestamp": "DESC"},
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
    prompt: str
    message_type: str = Field(default="user")
    embedding_text: str | None = None
    processing_mode: str | None = None
    prompt_embedding: list[float] | None = Field(default=None, sa_column=Column(Vector(1024)))
    timestamp: int
    medium: str | None = None
    user_id: str | None = None
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="conversations")
    entities: list["Entity"] = Relationship(back_populates="conversation")


class TaskQueue(SQLModel, table=True):
    __tablename__ = "task_queue"
    __table_args__ = (
        Index(
            "task_queue_pending_model_idx",
            "status",
            "model_name",
            postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "task_queue_claim_idx",
            "status",
            "model_name",
            "priority",
            "created_at",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("task_queue_id_status_idx", "id", "status"),
        Index(
            "task_queue_session_idx", "session_id", postgresql_where=text("session_id IS NOT NULL")
        ),
        Index("task_queue_created_idx", "created_at", postgresql_ops={"created_at": "DESC"}),
    )

    id: int | None = Field(default=None, primary_key=True)
    task_type: str
    model_name: str
    content: str
    task_metadata: dict[str, Any] | None = Field(default=None, sa_column=Column("metadata", JSONB))
    priority: int = Field(default=5)
    status: str = Field(default="pending")
    session_id: int | None = None
    created_at: datetime | None = Field(default_factory=datetime.utcnow)
    processed_at: datetime | None = None
    retry_count: int = Field(default=0)
    error_message: str | None = None


class Entity(SQLModel, table=True):
    __tablename__ = "entities"
    __table_args__ = (
        Index("entities_session_idx", "session_id"),
        Index("entities_type_idx", "entity_type"),
        Index("entities_normalized_idx", "normalized_value"),
        Index(
            "entities_fingerprint_idx",
            "fingerprint",
            postgresql_where=text("fingerprint IS NOT NULL"),
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
    conversation_id: int = Field(foreign_key="conversations.id")
    entity_type: str
    entity_value: str
    normalized_value: str
    fingerprint: str | None = None
    confidence: float
    context_start: int | None = None
    context_end: int | None = None
    entity_metadata: str | None = Field(default=None, sa_column=Column("metadata", String))
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="entities")
    conversation: "Conversation" = Relationship(back_populates="entities")


class EntityRelationship(SQLModel, table=True):
    __tablename__ = "entity_relationships"

    id: int | None = Field(default=None, primary_key=True)
    entity_1_id: int
    entity_2_id: int
    relationship_type: str
    confidence: float
    relationship_metadata: dict[str, Any] | None = Field(
        default=None, sa_column=Column("metadata", JSONB)
    )
    created_at: datetime | None = Field(default_factory=datetime.utcnow)


class SessionSummary(SQLModel, table=True):
    __tablename__ = "session_summaries"

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
    summary_type: str
    summary: str
    key_topics: list[str] | None = Field(
        default=None, sa_column=Column("key_topics", ARRAY(String()))
    )
    key_entities: list[int] | None = Field(
        default=None, sa_column=Column("key_entities", ARRAY(Integer))
    )
    task_status: dict[str, Any] | None = Field(default=None, sa_column=Column("task_status", JSONB))
    next_steps: str | None = None
    model_used: str | None = None
    processing_time_ms: int | None = None
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="session_summaries")


class ConversationSegment(SQLModel, table=True):
    __tablename__ = "conversation_segments"

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
    segment_number: int
    segment_summary: str
    original_length: int
    summary_length: int
    start_conversation_id: int
    end_conversation_id: int
    model_used: str
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="conversation_segments")


class ContextCache(SQLModel, table=True):
    __tablename__ = "context_cache"

    session_id: int = Field(foreign_key="sessions.id", primary_key=True)
    context_text: str
    context_metadata: dict[str, Any] | None = Field(
        default=None, sa_column=Column("metadata", JSONB)
    )
    created_at: datetime | None = Field(default_factory=datetime.utcnow)
    updated_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="context_caches")


class SessionRelationship(SQLModel, table=True):
    __tablename__ = "session_relationships"

    session_id: int = Field(primary_key=True)
    related_session_id: int = Field(primary_key=True)
    relationship_type: str = Field(primary_key=True)
    strength: float = Field(default=1.0)
    created_at: datetime | None = Field(default_factory=datetime.utcnow)


class WellnessSession(SQLModel, table=True):
    __tablename__ = "wellness_sessions"

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
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

    # Relationships
    session: "Session" = Relationship(back_populates="wellness_sessions")


class EmotionState(SQLModel, table=True):
    __tablename__ = "emotion_states"
    __table_args__ = (
        Index("emotion_states_session_idx", "session_id"),
        Index(
            "emotion_states_last_update_idx", "last_update", postgresql_ops={"last_update": "DESC"}
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
    primary_emotion: str
    primary_intensity: float
    secondary_emotion: str | None = None
    secondary_intensity: float | None = None
    overall_intensity: float
    appraisal_data: dict[str, Any] | None = Field(
        default=None, sa_column=Column("appraisal_data", JSONB)
    )
    trigger_data: dict[str, Any] | None = Field(
        default=None, sa_column=Column("trigger_data", JSONB)
    )
    last_update: datetime = Field(default_factory=datetime.utcnow)
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="emotion_states")


class StimulusHistory(SQLModel, table=True):
    __tablename__ = "stimulus_history"
    __table_args__ = (
        Index("stimulus_history_session_idx", "session_id"),
        Index("stimulus_history_timestamp_idx", "timestamp", postgresql_ops={"timestamp": "DESC"}),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="sessions.id")
    stimulus_type: str
    valence: float
    intensity: float
    timestamp: int
    context: dict[str, Any] | None = Field(default=None, sa_column=Column("context", JSONB))
    created_at: datetime | None = Field(default_factory=datetime.utcnow)

    # Relationships
    session: "Session" = Relationship(back_populates="stimulus_histories")


class Notification(SQLModel, table=True):
    __tablename__ = "ambient_notifications"

    id: int | None = Field(default=None, primary_key=True)
    user_id: str
    target_medium: str
    target_location: str
    message: str
    priority: str
    routing_reasoning: str | None = None
    status: str = Field(default="pending")
    error_message: str | None = None
    created_at: datetime | None = Field(default_factory=datetime.utcnow)
    delivered_at: datetime | None = None


class Presence(SQLModel, table=True):
    __tablename__ = "medium_presence"

    medium: str = Field(primary_key=True)
    user_id: str = Field(primary_key=True)
    status: str = Field(default="online")
    last_heartbeat: datetime = Field(default_factory=datetime.utcnow)
    available_channels: dict[str, Any] | None = Field(
        default=None, sa_column=Column("available_channels", JSONB)
    )
    created_at: datetime | None = Field(default_factory=datetime.utcnow)


class Personality(SQLModel):
    """Personality configuration loaded from TOML (not a database table)"""

    name: str
    short_name: str
    aliases: list[str] = []
    color: str = "white"
    icon: str = "●"
    prompt_content: str
    announcement: str | None = None
    occ_goals: list[dict[str, Any]] = []
    occ_standards: list[dict[str, Any]] = []
    occ_attitudes: list[dict[str, Any]] = []


# TypedDict classes for metadata structures
class EmbeddingMetadata(TypedDict):
    conversation_id: NotRequired[int]
    processing_mode: NotRequired[str]


class SummarizationMetadata(TypedDict):
    personality: NotRequired[str]
    max_length: NotRequired[int]


class EntityExtractionMetadata(TypedDict):
    conversation_id: NotRequired[int]
    context_hint: NotRequired[str]


class ContextBuildingMetadata(TypedDict):
    session_id: NotRequired[int]
    context_depth: NotRequired[int]
    max_tokens: NotRequired[int]
