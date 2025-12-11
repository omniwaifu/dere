from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pgvector.sqlalchemy import Vector
from pydantic import BaseModel
from sqlalchemy import BigInteger, Column, DateTime, Index, String, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, Relationship, SQLModel


def _utc_now() -> datetime:
    """Helper for timezone-aware UTC datetime defaults."""
    return datetime.now(UTC)


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


# SQLModel Table Models
class Session(SQLModel, table=True):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("sessions_working_dir_idx", "working_dir"),
        Index("sessions_start_time_idx", "start_time", postgresql_ops={"start_time": "DESC"}),
    )

    id: int | None = Field(default=None, primary_key=True)
    name: str | None = None
    working_dir: str
    start_time: int
    end_time: int | None = None
    last_activity: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    continued_from: int | None = Field(default=None, foreign_key="sessions.id")
    project_type: str | None = None
    claude_session_id: str | None = None
    personality: str | None = None
    medium: str | None = None
    user_id: str | None = None
    thinking_budget: int | None = None
    sandbox_mode: bool = Field(default=False)
    sandbox_settings: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    is_locked: bool = Field(default=False)
    mission_id: int | None = Field(default=None, foreign_key="missions.id")
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    summary: str | None = None
    summary_updated_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    # Relationships (cascade_delete ensures related records are deleted with session)
    conversations: list["Conversation"] = Relationship(back_populates="session", cascade_delete=True)
    entities: list["Entity"] = Relationship(back_populates="session", cascade_delete=True)
    context_caches: list["ContextCache"] = Relationship(back_populates="session", cascade_delete=True)
    emotion_states: list["EmotionState"] = Relationship(back_populates="session", cascade_delete=True)
    stimulus_histories: list["StimulusHistory"] = Relationship(back_populates="session", cascade_delete=True)


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
    prompt_embedding: list[float] | None = Field(default=None, sa_column=Column(Vector(1024)))
    timestamp: int
    medium: str | None = None
    user_id: str | None = None
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

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
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
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
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

    # Relationships
    session: "Session" = Relationship(back_populates="entities")
    conversation: "Conversation" = Relationship(back_populates="entities")


class ContextCache(SQLModel, table=True):
    __tablename__ = "context_cache"

    session_id: int = Field(foreign_key="sessions.id", primary_key=True)
    context_text: str
    context_metadata: dict[str, Any] | None = Field(
        default=None, sa_column=Column("metadata", JSONB)
    )
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    updated_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

    # Relationships
    session: "Session" = Relationship(back_populates="context_caches")


class SummaryContext(SQLModel, table=True):
    """Global roll-up of session summaries. Append-only for history."""

    __tablename__ = "summary_context"

    id: int | None = Field(default=None, primary_key=True)
    summary: str
    session_ids: list[int] | None = Field(
        default=None, sa_column=Column("session_ids", ARRAY(BigInteger))
    )
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))


class EmotionState(SQLModel, table=True):
    __tablename__ = "emotion_states"
    __table_args__ = (
        Index("emotion_states_session_idx", "session_id"),
        Index(
            "emotion_states_last_update_idx", "last_update", postgresql_ops={"last_update": "DESC"}
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int | None = Field(default=None, foreign_key="sessions.id")
    primary_emotion: str | None = None
    primary_intensity: float | None = None
    secondary_emotion: str | None = None
    secondary_intensity: float | None = None
    overall_intensity: float | None = None
    appraisal_data: dict[str, Any] | None = Field(
        default=None, sa_column=Column("appraisal_data", JSONB)
    )
    trigger_data: dict[str, Any] | None = Field(
        default=None, sa_column=Column("trigger_data", JSONB)
    )
    last_update: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

    # Relationship (optional since session_id is nullable for global state)
    session: "Session" = Relationship(back_populates="emotion_states", sa_relationship_kwargs={"foreign_keys": "[EmotionState.session_id]"})


class StimulusHistory(SQLModel, table=True):
    __tablename__ = "stimulus_history"
    __table_args__ = (
        Index("stimulus_history_session_idx", "session_id"),
        Index("stimulus_history_timestamp_idx", "timestamp", postgresql_ops={"timestamp": "DESC"}),
    )

    id: int | None = Field(default=None, primary_key=True)
    session_id: int | None = Field(default=None, foreign_key="sessions.id")
    stimulus_type: str
    valence: float
    intensity: float
    timestamp: int = Field(sa_column=Column("timestamp", BigInteger))
    context: dict[str, Any] | None = Field(default=None, sa_column=Column("context", JSONB))
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

    # Relationship (optional since session_id is nullable for global state)
    session: "Session" = Relationship(back_populates="stimulus_histories", sa_relationship_kwargs={"foreign_keys": "[StimulusHistory.session_id]"})


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
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    delivered_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    parent_notification_id: int | None = Field(default=None, foreign_key="ambient_notifications.id")
    acknowledged: bool = Field(default=False)
    acknowledged_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    response_time: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
        description="When user first interacted with notification (for response time tracking)",
    )


class NotificationContext(SQLModel, table=True):
    """Tracks the context/trigger that caused a notification for follow-up detection."""
    __tablename__ = "notification_context"

    id: int | None = Field(default=None, primary_key=True)
    notification_id: int = Field(foreign_key="ambient_notifications.id")

    trigger_type: str | None = None
    trigger_id: str | None = None
    trigger_data: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))

    context_snapshot: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))

    created_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))


class Presence(SQLModel, table=True):
    __tablename__ = "medium_presence"

    medium: str = Field(primary_key=True)
    user_id: str = Field(primary_key=True)
    status: str = Field(default="online")
    last_heartbeat: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    available_channels: list[dict[str, Any]] | None = Field(
        default=None, sa_column=Column("available_channels", JSONB)
    )
    created_at: datetime | None = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))


class MissionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class MissionExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MissionTriggerType(str, Enum):
    SCHEDULED = "scheduled"
    MANUAL = "manual"


class Mission(SQLModel, table=True):
    """Scheduled autonomous agent execution."""

    __tablename__ = "missions"
    __table_args__ = (
        Index("missions_status_next_exec_idx", "status", "next_execution_at"),
        Index("missions_created_idx", "created_at", postgresql_ops={"created_at": "DESC"}),
    )

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str | None = None
    prompt: str

    # Scheduling
    cron_expression: str
    natural_language_schedule: str | None = None
    timezone: str = Field(default="UTC")
    run_once: bool = Field(default=False)  # Archive after first execution

    # Execution config
    personality: str | None = None
    allowed_tools: list[str] | None = Field(default=None, sa_column=Column(ARRAY(String())))
    mcp_servers: list[str] | None = Field(default=None, sa_column=Column(ARRAY(String())))
    plugins: list[str] | None = Field(default=None, sa_column=Column(ARRAY(String())))
    thinking_budget: int | None = None
    model: str = Field(default="claude-opus-4-5")
    working_dir: str = Field(default="/workspace")
    sandbox_mode: bool = Field(default=True)
    sandbox_mount_type: str = Field(default="none")
    sandbox_settings: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))

    # State
    status: str = Field(default=MissionStatus.ACTIVE.value)
    next_execution_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    last_execution_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    # Metadata
    user_id: str | None = None
    created_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))
    updated_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

    # Relationships
    executions: list["MissionExecution"] = Relationship(
        back_populates="mission", cascade_delete=True
    )


class MissionExecution(SQLModel, table=True):
    """Record of a single mission execution."""

    __tablename__ = "mission_executions"
    __table_args__ = (
        Index("mission_executions_mission_idx", "mission_id"),
        Index(
            "mission_executions_started_idx", "started_at", postgresql_ops={"started_at": "DESC"}
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    mission_id: int = Field(foreign_key="missions.id")

    # Execution details
    status: str = Field(default=MissionExecutionStatus.PENDING.value)
    trigger_type: str = Field(default=MissionTriggerType.SCHEDULED.value)
    triggered_by: str | None = None

    started_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    completed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    # Output
    output_text: str | None = None
    output_summary: str | None = None
    tool_count: int = Field(default=0)
    error_message: str | None = None

    # Metadata
    execution_metadata: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=_utc_now, sa_type=DateTime(timezone=True))

    # Relationships
    mission: "Mission" = Relationship(back_populates="executions")


class Personality(SQLModel):
    """Personality configuration loaded from TOML (not a database table)"""

    name: str
    short_name: str
    aliases: list[str] = []
    color: str = "white"
    icon: str = "●"
    avatar: str | None = None
    prompt_content: str
    announcement: str | None = None
    occ_goals: list[dict[str, Any]] = []
    occ_standards: list[dict[str, Any]] = []
    occ_attitudes: list[dict[str, Any]] = []


# Pydantic models for LLM structured outputs
class AmbientEngagementDecision(BaseModel):
    """Decision from LLM about whether to engage with ambient notification."""

    should_engage: bool
    message: str | None = None
    priority: Literal["alert", "conversation"] = "conversation"
    reasoning: str


class RoutingDecision(BaseModel):
    """Decision from LLM about where to route a notification."""

    medium: str
    location: str
    reasoning: str
    fallback: bool = False
