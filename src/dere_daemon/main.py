from __future__ import annotations

import asyncio
import json
import os
import platform
import sys
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlmodel import select

from dere_shared.config import get_config_schema, load_dere_config, save_dere_config
from dere_shared.database import create_engine, create_session_factory, get_session
from dere_shared.models import (
    ConsolidationRun,
    Conversation,
    ConversationBlock,
    EmotionState,
    MessageType,
    Presence,
    Session,
    StimulusHistory,
    TaskQueue,
    TaskStatus,
)


# Request/Response models
class ConversationCaptureRequest(BaseModel):
    session_id: int
    personality: str
    project_path: str
    prompt: str
    message_type: str = "user"
    command_name: str | None = None
    command_args: str | None = None
    exit_code: int = 0
    is_command: bool = False
    medium: str | None = None
    user_id: str | None = None
    speaker_name: str | None = None


class StatusRequest(BaseModel):
    personality: str | None = None
    mcp_servers: list[str] = []
    context: bool = False
    session_type: str | None = None


class QueueAddRequest(BaseModel):
    task_type: str
    model_name: str
    content: str
    metadata: dict[str, Any] | None = None
    priority: int = 5
    session_id: int | None = None


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    threshold: float = 0.7
    user_id: str | None = None


class HybridSearchRequest(BaseModel):
    query: str
    entity_values: list[str] = []
    limit: int = 10
    entity_weight: float = 0.6
    session_id: int | None = None
    user_session_id: int | None = None
    user_id: str | None = None  # For knowledge graph partitioning
    # Temporal parameters
    since: str | None = None  # ISO datetime string
    before: str | None = None  # ISO datetime string
    as_of: str | None = None  # ISO datetime string
    only_valid: bool = False  # Only currently valid facts
    # Reranking parameters
    rerank_method: str | None = None  # "mmr" or "distance"
    center_entity: str | None = None  # For distance reranking
    diversity: float = 0.5  # MMR lambda parameter  # MMR lambda parameter


class HookCaptureRequest(BaseModel):
    data: dict[str, Any]


class LLMGenerateRequest(BaseModel):
    prompt: str
    model: str = "claude-haiku-4-5"
    session_id: int | None = None
    include_context: bool = False
    medium: str | None = None  # "cli", "discord", or None for any
    isolate_session: bool = (
        False  # Use dedicated session ID to avoid polluting conversation history
    )


class RoutingDecideRequest(BaseModel):
    user_id: str
    message: str
    priority: str
    user_activity: dict[str, Any] | None = None


class EmotionDBAdapter:
    """Adapter to provide database interface for emotion manager using SQLModel."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self.session_factory = session_factory

    async def load_emotion_state(self, session_id: int) -> dict | None:
        """Load emotion state from database."""
        async with self.session_factory() as db:
            from dere_shared.emotion.models import EmotionInstance, OCCEmotionType

            # session_id=0 is stored as NULL in DB
            if session_id == 0:
                session_filter = EmotionState.session_id.is_(None)
            else:
                session_filter = EmotionState.session_id == session_id

            stmt = (
                select(EmotionState)
                .where(session_filter)
                .order_by(EmotionState.last_update.desc())
                .limit(1)
            )
            result = await db.execute(stmt)
            state = result.scalar_one_or_none()
            await db.commit()
            if state and state.appraisal_data:
                # Deserialize: strings → enum keys, dict → EmotionInstance
                loaded_data = state.appraisal_data
                deserialized_emotions = {
                    OCCEmotionType(key): EmotionInstance(**value)
                    for key, value in loaded_data["active_emotions"].items()
                }
                return {
                    "active_emotions": deserialized_emotions,
                    "last_decay_time": loaded_data["last_decay_time"],
                }
            return None

    async def store_stimulus(self, session_id: int, stimulus_record) -> None:
        """Store stimulus record in database."""
        async with self.session_factory() as db:
            # session_id=0 is stored as NULL in DB
            db_session_id = None if session_id == 0 else session_id

            stimulus = StimulusHistory(
                session_id=db_session_id,
                stimulus_type=stimulus_record.type,
                valence=stimulus_record.valence,
                intensity=stimulus_record.intensity,
                timestamp=stimulus_record.timestamp,
                context=stimulus_record.context,
            )
            db.add(stimulus)
            await db.commit()

    async def load_stimulus_history(self, session_id: int, since_ms: int) -> list[dict]:
        """Load stimulus history from database since given timestamp."""
        from sqlalchemy import select

        async with self.session_factory() as db:
            # session_id=0 is stored as NULL in DB
            if session_id == 0:
                session_filter = StimulusHistory.session_id.is_(None)
            else:
                session_filter = StimulusHistory.session_id == session_id

            query = (
                select(StimulusHistory)
                .where(session_filter)
                .where(StimulusHistory.timestamp >= since_ms)
                .order_by(StimulusHistory.timestamp.asc())
            )
            result = await db.execute(query)
            rows = result.scalars().all()
            await db.commit()
            return [
                {
                    "type": row.stimulus_type,
                    "valence": row.valence,
                    "intensity": row.intensity,
                    "timestamp": row.timestamp,
                    "context": row.context or {},
                }
                for row in rows
            ]

    async def store_emotion_state(
        self, session_id: int, active_emotions: dict, last_decay_time: int
    ) -> None:
        """Store emotion state in database."""
        async with self.session_factory() as db:
            from datetime import datetime

            # Serialize: enum keys → strings, EmotionInstance → dict
            serialized_emotions = {
                emotion_type.value: emotion_instance.model_dump()
                for emotion_type, emotion_instance in active_emotions.items()
            }

            # session_id=0 is stored as NULL in DB
            db_session_id = None if session_id == 0 else session_id

            state = EmotionState(
                session_id=db_session_id,
                appraisal_data={
                    "active_emotions": serialized_emotions,
                    "last_decay_time": last_decay_time,
                },
                last_update=datetime.now(UTC),
            )
            db.add(state)
            await db.commit()


# Global state
class AppState:
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    emotion_managers: dict[int, Any]  # session_id -> OCCEmotionManager
    ambient_monitor: Any  # AmbientMonitor
    personality_loader: Any  # PersonalityLoader
    db: Any  # EmotionDBAdapter
    dere_graph: Any  # DereGraph - knowledge graph for context
    agent_service: Any  # CentralizedAgentService
    mission_executor: Any  # MissionExecutor
    mission_scheduler: Any  # MissionScheduler
    swarm_coordinator: Any  # SwarmCoordinator
    work_queue_coordinator: Any  # WorkQueueCoordinator


async def _init_database(db_url: str, app_state: AppState) -> None:
    """Initialize database connection and session factory."""
    try:
        app_state.engine = create_engine(db_url)
        app_state.session_factory = create_session_factory(app_state.engine)
        app_state.db = EmotionDBAdapter(app_state.session_factory)
        print(f"Database connected: {db_url}")
    except Exception as e:
        print("FATAL: Failed to connect to database")
        print(f"   URL: {db_url}")
        print(f"   Error: {e}")
        print("\n   Make sure PostgreSQL is running:")
        print("   docker ps | grep postgres")
        raise


async def _init_dere_graph(config: dict[str, Any], db_url: str, app_state: AppState) -> None:
    """Initialize DereGraph for knowledge management."""
    graph_config = config.get("dere_graph", {})
    if not graph_config.get("enabled", True):
        app_state.dere_graph = None
        return

    try:
        from dere_graph import DereGraph

        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key:
            print("Warning: OPENAI_API_KEY not set, knowledge graph disabled")
            app_state.dere_graph = None
            return

        postgres_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

        app_state.dere_graph = DereGraph(
            falkor_host=graph_config.get("falkor_host", "localhost"),
            falkor_port=graph_config.get("falkor_port", 6379),
            falkor_database=graph_config.get("falkor_database", "dere_graph"),
            openai_api_key=openai_key,
            claude_model=graph_config.get("claude_model", "claude-haiku-4-5"),
            embedding_dim=graph_config.get("embedding_dim", 1536),
            postgres_db_url=postgres_url,
            enable_reflection=graph_config.get("enable_reflection", True),
            enable_attribute_hydration=graph_config.get("enable_attribute_hydration", False),
            enable_edge_date_refinement=graph_config.get("enable_edge_date_refinement", False),
            idle_threshold_minutes=graph_config.get("idle_threshold_minutes", 15),
        )
        await app_state.dere_graph.build_indices()
        print("DereGraph initialized")
    except Exception as e:
        print(f"Warning: Failed to initialize DereGraph: {e}")
        app_state.dere_graph = None


async def _init_personality_loader(app_state: AppState) -> None:
    """Initialize personality loader."""
    from dere_shared.paths import get_config_dir
    from dere_shared.personalities import PersonalityLoader

    config_dir = get_config_dir()
    config_dir.mkdir(parents=True, exist_ok=True)
    app_state.personality_loader = PersonalityLoader(config_dir)


async def _init_ambient_monitor(data_dir: Path, app_state: AppState) -> None:
    """Initialize ambient monitor."""
    try:
        from dere_ambient import AmbientMonitor, load_ambient_config

        ambient_config = load_ambient_config()
        app_state.ambient_monitor = AmbientMonitor(
            ambient_config,
            personality_loader=app_state.personality_loader,
            mission_executor=app_state.mission_executor,
            session_factory=app_state.session_factory,
        )
        await app_state.ambient_monitor.start()
    except Exception as e:
        print(f"Warning: Failed to initialize ambient monitor: {e}")
        app_state.ambient_monitor = None


async def _init_agent_service(app_state: AppState) -> None:
    """Initialize the centralized agent service, mission scheduler, and swarm coordinator."""
    from dere_daemon.agent import CentralizedAgentService
    from dere_daemon.missions import MissionExecutor, MissionScheduler
    from dere_daemon.swarm import SwarmCoordinator
    from dere_daemon.work_queue import WorkQueueCoordinator

    app_state.agent_service = CentralizedAgentService(
        session_factory=app_state.session_factory,
        personality_loader=app_state.personality_loader,
        emotion_managers=app_state.emotion_managers,
        dere_graph=app_state.dere_graph,
        config=app_state.config,
    )
    # Start the sandbox cleanup background task
    app_state.agent_service.start_cleanup_task()
    print("Centralized agent service initialized")

    # Initialize mission executor and scheduler
    app_state.mission_executor = MissionExecutor(
        agent_service=app_state.agent_service,
        session_factory=app_state.session_factory,
    )
    app_state.mission_scheduler = MissionScheduler(
        session_factory=app_state.session_factory,
        executor=app_state.mission_executor,
    )
    app_state.mission_scheduler.start()
    print("Mission scheduler started")

    # Initialize work queue coordinator (before swarm, since swarm uses it)
    app_state.work_queue_coordinator = WorkQueueCoordinator(
        session_factory=app_state.session_factory,
    )
    print("Work queue coordinator initialized")

    # Initialize swarm coordinator
    app_state.swarm_coordinator = SwarmCoordinator(
        session_factory=app_state.session_factory,
        agent_service=app_state.agent_service,
        work_queue=app_state.work_queue_coordinator,
    )
    print("Swarm coordinator initialized")


# Emotion batch appraisal settings
EMOTION_IDLE_TIMEOUT = 600  # 10 minutes in seconds
EMOTION_CHECK_INTERVAL = 60  # Check every 60 seconds

# Session summary settings
SUMMARY_IDLE_TIMEOUT = 1800  # 30 minutes in seconds
SUMMARY_CHECK_INTERVAL = 300  # Check every 5 minutes
SUMMARY_MIN_MESSAGES = 5  # Minimum messages before generating summary

# Memory consolidation settings
MEMORY_CONSOLIDATION_CHECK_INTERVAL = 60  # Check queue every 60 seconds
MEMORY_CONSOLIDATION_DEFAULT_DAYS = 30
MEMORY_CONSOLIDATION_COMMUNITY_RESOLUTION = 1.0
MEMORY_CONSOLIDATION_SCHEDULE_DAYS = 7
MEMORY_CONSOLIDATION_SCHEDULE_CHECK_INTERVAL = 3600  # Check schedule every hour
MEMORY_CONSOLIDATION_SUMMARY_SESSION_LIMIT = 5
MEMORY_CONSOLIDATION_SUMMARY_BLOCK_LIMIT = 60
MEMORY_CONSOLIDATION_SUMMARY_MIN_BLOCKS = 8
MEMORY_CONSOLIDATION_FACT_QUALITY_THRESHOLD = 0.1
MEMORY_CONSOLIDATION_FACT_MIN_RETRIEVALS = 5
MEMORY_CONSOLIDATION_ENTITY_MERGE_LIMIT = 25

# Recall embedding backfill settings
RECALL_EMBEDDING_CHECK_INTERVAL = 120  # Check for missing embeddings every 2 minutes
RECALL_EMBEDDING_BATCH_SIZE = 50


async def _update_summary_context(session_factory) -> None:
    """Update global summary context from recent session summaries."""
    from sqlalchemy import select

    from dere_shared.llm_client import ClaudeClient, Message
    from dere_shared.models import SummaryContext

    try:
        async with session_factory() as db:
            # Get previous global summary to find already-processed sessions
            prev_stmt = select(SummaryContext).order_by(SummaryContext.created_at.desc()).limit(1)
            prev_result = await db.execute(prev_stmt)
            prev_context = prev_result.scalar_one_or_none()
            prev_summary = prev_context.summary if prev_context else None
            prev_session_ids = set(prev_context.session_ids or []) if prev_context else set()

            # Get sessions with summaries that haven't been rolled up yet
            stmt = (
                select(Session)
                .where(Session.summary.isnot(None))
                .order_by(Session.summary_updated_at.desc())
                .limit(20)
            )
            result = await db.execute(stmt)
            all_sessions = result.scalars().all()

            # Filter to only new sessions
            new_sessions = [s for s in all_sessions if s.id not in prev_session_ids]

            if not new_sessions:
                return

            # Build session summaries for prompt
            session_summaries = "\n".join([f"- {s.summary}" for s in new_sessions if s.summary])
            new_session_ids = [s.id for s in new_sessions]

            prompt = f"""Previous: {prev_summary or "None"}

Recent:
{session_summaries}

Merge into 1-2 sentences. No headers, no preambles."""

            client = ClaudeClient()
            messages = [Message(role="user", content=prompt)]
            new_summary = await client.generate_text_response(messages)
            new_summary = new_summary.strip()

            # Insert new summary context with all session IDs (old + new)
            all_session_ids = list(prev_session_ids | set(new_session_ids))
            context = SummaryContext(
                summary=new_summary,
                session_ids=all_session_ids,
            )
            db.add(context)
            await db.commit()

            logger.info(f"[SummaryContext] Updated global context: {new_summary[:100]}...")

    except Exception as e:
        logger.error(f"[SummaryContext] Failed to update: {e}")


async def _summarize_old_conversations(
    app_state: AppState,
    *,
    cutoff_ts: int,
    session_limit: int,
    block_limit: int,
    min_blocks: int,
) -> int:
    """Summarize older conversation blocks into compact memory entries."""
    from sqlalchemy import select

    from dere_shared.llm_client import ClaudeClient, Message

    summary_count = 0
    client = ClaudeClient()

    async with app_state.session_factory() as db:
        session_stmt = (
            select(Conversation.session_id)
            .join(ConversationBlock, ConversationBlock.conversation_id == Conversation.id)
            .where(Conversation.timestamp < cutoff_ts)
            .where(Conversation.message_type.in_(["user", "assistant"]))
            .where(ConversationBlock.block_type == "text")
            .where(ConversationBlock.text.is_not(None))
            .where(ConversationBlock.text != "")
            .distinct()
            .limit(session_limit)
        )
        result = await db.execute(session_stmt)
        session_ids = [row[0] for row in result.all()]

        for session_id in session_ids:
            session = await db.get(Session, session_id)
            session_user_id = session.user_id if session else None

            blocks_stmt = (
                select(Conversation, ConversationBlock)
                .join(ConversationBlock, ConversationBlock.conversation_id == Conversation.id)
                .where(Conversation.session_id == session_id)
                .where(Conversation.timestamp < cutoff_ts)
                .where(Conversation.message_type.in_(["user", "assistant"]))
                .where(ConversationBlock.block_type == "text")
                .where(ConversationBlock.text.is_not(None))
                .where(ConversationBlock.text != "")
                .order_by(Conversation.timestamp.asc(), ConversationBlock.ordinal.asc())
                .limit(block_limit)
            )
            block_rows = (await db.execute(blocks_stmt)).all()
            if len(block_rows) < min_blocks:
                continue

            lines = []
            last_ts = 0
            for conv, block in block_rows:
                if block.text:
                    lines.append(f"{conv.message_type}: {block.text.strip()}")
                if conv.timestamp and conv.timestamp > last_ts:
                    last_ts = conv.timestamp

            if not lines:
                continue

            summary_exists_stmt = (
                select(Conversation.id)
                .where(Conversation.session_id == session_id)
                .where(Conversation.message_type == MessageType.SYSTEM)
                .where(Conversation.prompt.ilike("[Memory Summary]%"))
                .where(Conversation.timestamp >= last_ts)
                .limit(1)
            )
            summary_exists = (await db.execute(summary_exists_stmt)).scalar_one_or_none()
            if summary_exists:
                continue

            content = "\n".join(lines)
            if len(content) > 8000:
                content = content[-8000:]

            prompt = (
                "Summarize these conversation turns into 3-6 bullet points. "
                "Focus on durable facts, decisions, and ongoing goals. "
                "Avoid ephemeral details and tool noise.\n\n"
                f"{content}"
            )
            try:
                summary = await client.generate_text_response(
                    [Message(role="user", content=prompt)]
                )
            except Exception as e:
                logger.error(
                    "[Consolidation] Summary generation failed for session {}: {}",
                    session_id,
                    e,
                )
                continue
            summary_text = summary.strip()
            if not summary_text:
                continue

            summary_payload = f"[Memory Summary]\n{summary_text}"

            summary_conv = Conversation(
                session_id=session_id,
                prompt=summary_payload,
                message_type=MessageType.SYSTEM,
                timestamp=last_ts or int(time.time()),
                medium="memory",
                user_id=session_user_id,
            )
            db.add(summary_conv)
            await db.flush()

            db.add(
                ConversationBlock(
                    conversation_id=summary_conv.id,  # type: ignore[arg-type]
                    ordinal=0,
                    block_type="text",
                    text=summary_payload,
                )
            )
            await db.commit()

            summary_count += 1

    return summary_count


async def _update_core_memory_from_summary(
    app_state: AppState,
    *,
    user_id: str,
) -> int:
    """Seed or update core memory task block from latest session summary."""
    from sqlalchemy import select

    from dere_shared.models import CoreMemoryBlock, CoreMemoryVersion

    if not user_id or user_id == "default":
        return 0

    async with app_state.session_factory() as db:
        summary_stmt = (
            select(Session.summary, Session.summary_updated_at)
            .where(Session.user_id == user_id)
            .where(Session.summary.is_not(None))
            .order_by(Session.summary_updated_at.desc())
            .limit(1)
        )
        summary_row = (await db.execute(summary_stmt)).first()
        if not summary_row:
            return 0

        summary = (summary_row[0] or "").strip()
        if not summary:
            return 0

        block_stmt = select(CoreMemoryBlock).where(
            CoreMemoryBlock.user_id == user_id,
            CoreMemoryBlock.session_id.is_(None),
            CoreMemoryBlock.block_type == "task",
        )
        block = (await db.execute(block_stmt)).scalar_one_or_none()

        now = datetime.now(UTC)
        content_prefix = "Recent summary: "
        updated = False

        if block:
            if summary in block.content:
                return 0
            new_content = block.content.rstrip()
            if new_content:
                new_content += "\n"
            remaining = block.char_limit - len(new_content) - len(content_prefix)
            trimmed_summary = summary[: max(0, remaining)]
            new_content += f"{content_prefix}{trimmed_summary}"
            block.content = new_content[: block.char_limit]
            block.version = (block.version or 1) + 1
            block.updated_at = now
            updated = True
        else:
            new_content = f"{content_prefix}{summary}"
            block = CoreMemoryBlock(
                user_id=user_id,
                session_id=None,
                block_type="task",
                content=new_content[:8192],
                char_limit=8192,
                version=1,
                created_at=now,
                updated_at=now,
            )
            db.add(block)
            await db.flush()
            updated = True

        if updated:
            db.add(
                CoreMemoryVersion(
                    block_id=block.id,  # type: ignore[arg-type]
                    version=block.version,
                    content=block.content,
                    reason="memory consolidation summary",
                    created_at=now,
                )
            )
            await db.commit()
            return 1

    return 0


async def _run_memory_consolidation(
    app_state: AppState,
    *,
    group_id: str = "default",
    recency_days: int = MEMORY_CONSOLIDATION_DEFAULT_DAYS,
    community_resolution: float = MEMORY_CONSOLIDATION_COMMUNITY_RESOLUTION,
    update_core_memory: bool = False,
) -> dict[str, int]:
    """Run a memory consolidation pass for the graph."""
    if not app_state.dere_graph:
        raise RuntimeError("Knowledge graph not available")

    from datetime import timedelta

    recency_days = max(1, int(recency_days))
    cutoff = datetime.now(UTC) - timedelta(days=recency_days)
    cutoff_ts = int(cutoff.timestamp())

    summary_blocks = await _summarize_old_conversations(
        app_state,
        cutoff_ts=cutoff_ts,
        session_limit=MEMORY_CONSOLIDATION_SUMMARY_SESSION_LIMIT,
        block_limit=MEMORY_CONSOLIDATION_SUMMARY_BLOCK_LIMIT,
        min_blocks=MEMORY_CONSOLIDATION_SUMMARY_MIN_BLOCKS,
    )

    pruned_edges = await app_state.dere_graph.invalidate_stale_edges(
        group_id=group_id,
        cutoff=cutoff,
    )
    pruned_facts = await app_state.dere_graph.invalidate_stale_facts(
        group_id=group_id,
        cutoff=cutoff,
    )
    pruned_low_quality_facts = await app_state.dere_graph.invalidate_low_quality_facts(
        group_id=group_id,
        cutoff=cutoff,
        quality_threshold=MEMORY_CONSOLIDATION_FACT_QUALITY_THRESHOLD,
        min_retrievals=MEMORY_CONSOLIDATION_FACT_MIN_RETRIEVALS,
    )
    merged_entities = await app_state.dere_graph.merge_duplicate_entities(
        group_id=group_id,
        limit=MEMORY_CONSOLIDATION_ENTITY_MERGE_LIMIT,
    )
    core_memory_updates = 0
    if update_core_memory:
        core_memory_updates = await _update_core_memory_from_summary(
            app_state,
            user_id=group_id,
        )
    communities = await app_state.dere_graph.build_communities(
        group_id=group_id,
        resolution=community_resolution,
    )

    return {
        "summary_blocks": summary_blocks,
        "pruned_edges": pruned_edges,
        "pruned_facts": pruned_facts,
        "pruned_low_quality_facts": pruned_low_quality_facts,
        "merged_entities": merged_entities,
        "core_memory_updates": core_memory_updates,
        "communities": len(communities),
    }


async def _maybe_schedule_weekly_consolidation(
    app_state: AppState,
    *,
    group_id: str = "default",
) -> bool:
    """Schedule a weekly consolidation task if no recent run exists."""
    from datetime import timedelta

    from sqlalchemy import func, select

    now = datetime.now(UTC)
    cutoff = now - timedelta(days=MEMORY_CONSOLIDATION_SCHEDULE_DAYS)

    async with app_state.session_factory() as db:
        inflight_stmt = select(func.count(TaskQueue.id)).where(
            TaskQueue.task_type == "memory_consolidation",
            TaskQueue.status.in_(
                [TaskStatus.PENDING.value, TaskStatus.PROCESSING.value]
            ),
        )
        inflight = (await db.execute(inflight_stmt)).scalar() or 0
        if inflight:
            return False

        last_stmt = (
            select(TaskQueue.processed_at)
            .where(TaskQueue.task_type == "memory_consolidation")
            .where(TaskQueue.status == TaskStatus.COMPLETED.value)
            .order_by(TaskQueue.processed_at.desc())
            .limit(1)
        )
        last_result = await db.execute(last_stmt)
        last_processed = last_result.scalar_one_or_none()

        if last_processed and last_processed >= cutoff:
            return False

        task = TaskQueue(
            task_type="memory_consolidation",
            model_name="scheduled",
            content=f"Scheduled memory consolidation for group {group_id}",
            session_id=None,
            task_metadata={
                "user_id": None,
                "recency_days": MEMORY_CONSOLIDATION_DEFAULT_DAYS,
                "scheduled": True,
                "trigger": "scheduled",
            },
            priority=5,
            status=TaskStatus.PENDING.value,
        )
        db.add(task)
        await db.commit()

    logger.info(
        "[Consolidation] Scheduled weekly consolidation for group {}",
        group_id,
    )
    return True


def _start_background_tasks(
    app_state: AppState,
) -> tuple[asyncio.Task, asyncio.Task, asyncio.Task, asyncio.Task, asyncio.Task]:
    """Start background tasks for presence cleanup, emotion decay, session summaries, consolidation, and recall embeddings."""

    async def cleanup_presence_loop():
        """Background task placeholder for future presence maintenance."""
        while True:
            try:
                await asyncio.sleep(30)
                pass
            except Exception as e:
                logger.error("Presence cleanup failed: {}", e)

    async def periodic_emotion_decay_loop():
        """Background task to apply decay to emotions during idle time, cleanup stale managers, and flush batch appraisals."""
        from datetime import timedelta

        from sqlalchemy import select

        while True:
            try:
                await asyncio.sleep(EMOTION_CHECK_INTERVAL)

                if not app_state.emotion_managers:
                    continue

                current_time = int(time.time() * 1000)
                current_monotonic = time.monotonic()
                ttl_threshold = datetime.now(UTC) - timedelta(days=7)

                async with app_state.session_factory() as db:
                    stmt = select(Session.id, Session.last_activity).where(
                        Session.id.in_(list(app_state.emotion_managers.keys()))
                    )
                    result = await db.execute(stmt)
                    session_activities = {row[0]: row[1] for row in result}
                    await db.commit()

                for session_id, manager in list(app_state.emotion_managers.items()):
                    last_activity = session_activities.get(session_id)
                    if last_activity and last_activity < ttl_threshold:
                        logger.info(
                            "Removing emotion manager for inactive session {} (last active: {})",
                            session_id,
                            last_activity,
                        )
                        del app_state.emotion_managers[session_id]
                        continue

                    # Check for batch appraisal flush on idle
                    if manager.has_pending_stimuli():
                        idle_time = current_monotonic - manager.get_last_stimulus_time()
                        if idle_time >= EMOTION_IDLE_TIMEOUT:
                            logger.info(
                                "[Emotion] Flushing batch appraisal for session {} after {:.0f}s idle",
                                session_id,
                                idle_time,
                            )
                            try:
                                await manager.flush_batch_appraisal()
                            except Exception as e:
                                logger.error(
                                    "[Emotion] Batch appraisal failed for session {}: {}",
                                    session_id,
                                    e,
                                )

                    # Apply decay if needed
                    if not manager.active_emotions:
                        continue

                    time_since_last_decay = (current_time - manager.last_decay_time) / (1000 * 60)
                    if time_since_last_decay < 1.0:
                        continue

                    await manager._apply_smart_decay(current_time)

            except Exception as e:
                logger.error("Periodic emotion decay failed: {}", e)

    async def periodic_session_summary_loop():
        """Background task to generate rolling summaries for idle sessions."""
        from datetime import timedelta

        from sqlalchemy import func, select, update

        from dere_shared.llm_client import ClaudeClient, Message

        while True:
            try:
                await asyncio.sleep(SUMMARY_CHECK_INTERVAL)

                now = datetime.now(UTC)
                idle_threshold = now - timedelta(seconds=SUMMARY_IDLE_TIMEOUT)

                async with app_state.session_factory() as db:
                    # Find sessions that:
                    # 1. Have recent activity (last 24h)
                    # 2. Are idle (no activity in SUMMARY_IDLE_TIMEOUT)
                    # 3. Have no summary OR summary is older than last_activity
                    recent_threshold = now - timedelta(hours=24)

                    stmt = (
                        select(Session)
                        .where(Session.last_activity >= recent_threshold)
                        .where(Session.last_activity <= idle_threshold)
                        .where(Session.end_time.is_(None))  # Not ended
                        .where(
                            (Session.summary.is_(None))
                            | (Session.summary_updated_at < Session.last_activity)
                        )
                    )
                    result = await db.execute(stmt)
                    sessions = result.scalars().all()

                    if not sessions:
                        continue

                    # Filter to sessions with enough messages
                    sessions_to_summarize = []
                    for session in sessions:
                        count_stmt = (
                            select(func.count())
                            .select_from(Conversation)
                            .where(Conversation.session_id == session.id)
                        )
                        count_result = await db.execute(count_stmt)
                        msg_count = count_result.scalar() or 0

                        if msg_count >= SUMMARY_MIN_MESSAGES:
                            sessions_to_summarize.append(session)

                    if not sessions_to_summarize:
                        continue

                    logger.info(
                        f"[Summary] Generating summaries for {len(sessions_to_summarize)} sessions"
                    )

                    for session in sessions_to_summarize:
                        # Get recent messages for summary
                        msg_stmt = (
                            select(Conversation.prompt, Conversation.message_type)
                            .where(Conversation.session_id == session.id)
                            .order_by(Conversation.timestamp.desc())
                            .limit(50)
                        )
                        msg_result = await db.execute(msg_stmt)
                        rows = msg_result.all()

                        if not rows:
                            continue

                        content = "\n".join(
                            [f"{row.message_type}: {row.prompt}" for row in reversed(rows)]
                        )

                        # Generate summary
                        try:
                            prompt = f"""Summarize this conversation in 1-2 concise sentences. Focus on what was discussed and any outcomes.

{content[:2000]}"""
                            client = ClaudeClient()
                            messages = [Message(role="user", content=prompt)]
                            summary = await client.generate_text_response(messages)
                            summary = summary.strip()

                            # Update session
                            update_stmt = (
                                update(Session)
                                .where(Session.id == session.id)
                                .values(summary=summary, summary_updated_at=now)
                            )
                            await db.execute(update_stmt)
                            await db.commit()

                            logger.info(f"[Summary] Generated summary for session {session.id}")
                        except Exception as e:
                            logger.error(f"[Summary] Failed for session {session.id}: {e}")

                    # After processing sessions, update global summary context
                    await _update_summary_context(app_state.session_factory)

            except Exception as e:
                logger.error(f"[Summary] Periodic summary loop failed: {e}")

    async def memory_consolidation_loop():
        """Background task to process memory consolidation tasks."""
        from sqlalchemy import select

        last_schedule_check = 0.0

        while True:
            task_id: int | None = None
            run_id: int | None = None
            group_id = "default"
            recency_days = MEMORY_CONSOLIDATION_DEFAULT_DAYS
            update_core_memory = False
            trigger_label = "manual"
            try:
                if not app_state.dere_graph:
                    await asyncio.sleep(MEMORY_CONSOLIDATION_CHECK_INTERVAL)
                    continue

                now = time.monotonic()
                if (
                    now - last_schedule_check
                    >= MEMORY_CONSOLIDATION_SCHEDULE_CHECK_INTERVAL
                ):
                    try:
                        await _maybe_schedule_weekly_consolidation(app_state)
                    except Exception as e:
                        logger.error("[Consolidation] Schedule check failed: {}", e)
                    last_schedule_check = now

                async with app_state.session_factory() as db:
                    stmt = (
                        select(TaskQueue)
                        .where(TaskQueue.status == TaskStatus.PENDING.value)
                        .where(TaskQueue.task_type == "memory_consolidation")
                        .order_by(TaskQueue.priority.desc(), TaskQueue.created_at.asc())
                        .limit(1)
                        .with_for_update(skip_locked=True)
                    )
                    result = await db.execute(stmt)
                    task = result.scalar_one_or_none()

                    if not task:
                        await asyncio.sleep(MEMORY_CONSOLIDATION_CHECK_INTERVAL)
                        continue

                    task_id = task.id
                    task.status = TaskStatus.PROCESSING.value

                    metadata = task.task_metadata or {}
                    group_id = metadata.get("user_id") or "default"
                    raw_days = metadata.get("recency_days", MEMORY_CONSOLIDATION_DEFAULT_DAYS)
                    try:
                        recency_days = int(raw_days)
                    except (TypeError, ValueError):
                        recency_days = MEMORY_CONSOLIDATION_DEFAULT_DAYS
                    update_core_memory = bool(metadata.get("update_core_memory", False))
                    trigger_label = metadata.get("trigger") or (
                        "scheduled" if metadata.get("scheduled") else "manual"
                    )

                    run = ConsolidationRun(
                        user_id=group_id,
                        task_id=task_id,
                        status="running",
                        started_at=datetime.now(UTC),
                        recency_days=recency_days,
                        community_resolution=MEMORY_CONSOLIDATION_COMMUNITY_RESOLUTION,
                        update_core_memory=update_core_memory,
                        triggered_by=trigger_label,
                    )
                    db.add(run)
                    await db.flush()
                    run_id = run.id
                    await db.commit()

                stats = await _run_memory_consolidation(
                    app_state,
                    group_id=group_id,
                    recency_days=recency_days,
                    update_core_memory=update_core_memory,
                )

                async with app_state.session_factory() as db:
                    task = await db.get(TaskQueue, task_id)
                    if task:
                        task.status = TaskStatus.COMPLETED.value
                        task.processed_at = datetime.now(UTC)
                        task.error_message = None
                    if run_id is not None:
                        run = await db.get(ConsolidationRun, run_id)
                        if run:
                            run.status = "completed"
                            run.stats = stats
                            run.finished_at = datetime.now(UTC)
                    await db.commit()

                logger.info(
                    "[Consolidation] Completed (group={}, days={}): {}",
                    group_id,
                    recency_days,
                    stats,
                )

            except Exception as e:
                logger.error("[Consolidation] Failed: {}", e)
                if task_id is not None:
                    async with app_state.session_factory() as db:
                        task = await db.get(TaskQueue, task_id)
                        if task:
                            task.status = TaskStatus.FAILED.value
                            task.processed_at = datetime.now(UTC)
                            task.retry_count = (task.retry_count or 0) + 1
                            task.error_message = str(e)
                        if run_id is not None:
                            run = await db.get(ConsolidationRun, run_id)
                            if run:
                                run.status = "failed"
                                run.error_message = str(e)
                                run.finished_at = datetime.now(UTC)
                        await db.commit()

                await asyncio.sleep(MEMORY_CONSOLIDATION_CHECK_INTERVAL)

    async def recall_embedding_backfill_loop():
        """Background task to backfill missing conversation block embeddings."""
        from sqlalchemy import select

        from dere_shared.models import Conversation, ConversationBlock

        while True:
            try:
                await asyncio.sleep(RECALL_EMBEDDING_CHECK_INTERVAL)
                if not app_state.dere_graph or not app_state.dere_graph.embedder:
                    continue

                async with app_state.session_factory() as db:
                    missing_blocks_stmt = (
                        select(Conversation)
                        .outerjoin(
                            ConversationBlock,
                            ConversationBlock.conversation_id == Conversation.id,
                        )
                        .where(ConversationBlock.id.is_(None))
                        .where(Conversation.prompt.is_not(None))
                        .where(Conversation.prompt != "")
                        .limit(RECALL_EMBEDDING_BATCH_SIZE)
                    )
                    missing_blocks_result = await db.execute(missing_blocks_stmt)
                    missing_conversations = list(missing_blocks_result.scalars().all())

                    if missing_conversations:
                        db.add_all(
                            [
                                ConversationBlock(
                                    conversation_id=conv.id,  # type: ignore[arg-type]
                                    ordinal=0,
                                    block_type="text",
                                    text=conv.prompt,
                                )
                                for conv in missing_conversations
                            ]
                        )
                        await db.commit()

                    stmt = (
                        select(ConversationBlock)
                        .join(Conversation, Conversation.id == ConversationBlock.conversation_id)
                        .where(ConversationBlock.content_embedding.is_(None))
                        .where(ConversationBlock.block_type == "text")
                        .where(ConversationBlock.text.is_not(None))
                        .where(ConversationBlock.text != "")
                        .limit(RECALL_EMBEDDING_BATCH_SIZE)
                    )
                    result = await db.execute(stmt)
                    blocks = list(result.scalars().all())

                    if not blocks:
                        continue

                    texts = [block.text.replace("\n", " ") for block in blocks]
                    embeddings = await app_state.dere_graph.embedder.create_batch(texts)

                    for block, embedding in zip(blocks, embeddings):
                        block.content_embedding = embedding

                    await db.commit()
            except Exception as e:
                logger.error("[Recall] Embedding backfill failed: {}", e)

    cleanup_task = asyncio.create_task(cleanup_presence_loop())
    emotion_decay_task = asyncio.create_task(periodic_emotion_decay_loop())
    summary_task = asyncio.create_task(periodic_session_summary_loop())
    memory_task = asyncio.create_task(memory_consolidation_loop())
    recall_task = asyncio.create_task(recall_embedding_backfill_loop())

    return cleanup_task, emotion_decay_task, summary_task, memory_task, recall_task


async def _shutdown_cleanup(
    app_state: AppState,
    pid_file: Path,
    cleanup_task: asyncio.Task,
    emotion_decay_task: asyncio.Task,
    summary_task: asyncio.Task,
    memory_task: asyncio.Task,
    recall_task: asyncio.Task,
) -> None:
    """Shutdown all services and cleanup resources."""
    errors = []

    for task in [cleanup_task, emotion_decay_task, summary_task, memory_task, recall_task]:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # Stop mission scheduler
    if hasattr(app_state, "mission_scheduler") and app_state.mission_scheduler:
        try:
            await app_state.mission_scheduler.stop()
        except Exception as e:
            errors.append(e)

    if app_state.ambient_monitor:
        try:
            await app_state.ambient_monitor.shutdown()
        except Exception as e:
            errors.append(e)

    if hasattr(app_state, "agent_service") and app_state.agent_service:
        try:
            await app_state.agent_service.close_all()
        except Exception as e:
            errors.append(e)

    if app_state.dere_graph:
        try:
            await app_state.dere_graph.close()
        except Exception as e:
            errors.append(e)

    try:
        await app_state.engine.dispose()
    except Exception as e:
        errors.append(e)

    try:
        pid_file.unlink()
    except FileNotFoundError:
        pass
    except Exception as e:
        errors.append(e)

    if errors:
        raise ExceptionGroup("Errors during shutdown", errors)

    print("Dere daemon shutdown")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown"""
    data_dir = _get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "dere.db"
    pid_file = data_dir / "daemon.pid"

    pid_file.write_text(str(os.getpid()))

    config = load_dere_config()
    db_url = config.get("database", {}).get("url", "postgresql://postgres:dere@localhost/dere")

    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    app.state = AppState()  # type: ignore[assignment]
    app.state.emotion_managers = {}
    app.state.config = config

    await _init_database(db_url, app.state)
    await _init_dere_graph(config, db_url, app.state)
    await _init_personality_loader(app.state)
    await _init_agent_service(app.state)
    await _init_ambient_monitor(data_dir, app.state)

    (
        cleanup_task,
        emotion_decay_task,
        summary_task,
        memory_task,
        recall_task,
    ) = _start_background_tasks(app.state)

    print(f"Dere daemon started - database: {db_path}")

    yield

    await _shutdown_cleanup(
        app.state,
        pid_file,
        cleanup_task,
        emotion_decay_task,
        summary_task,
        memory_task,
        recall_task,
    )


app = FastAPI(title="Dere Daemon", version="0.1.0", lifespan=lifespan)

# Include domain-specific routers
from dere_daemon.routers import (
    agent_router,
    activity_router,
    core_memory_router,
    context_router,
    dashboard_router,
    emotions_router,
    kg_router,
    missions_router,
    notifications_router,
    presence_router,
    recall_router,
    sessions_router,
    swarm_router,
    taskwarrior_router,
    work_queue_router,
)

app.include_router(sessions_router)
app.include_router(emotions_router)
app.include_router(agent_router)
app.include_router(activity_router)
app.include_router(notifications_router)
app.include_router(presence_router)
app.include_router(core_memory_router)
app.include_router(kg_router)
app.include_router(recall_router)
app.include_router(context_router)
app.include_router(taskwarrior_router)
app.include_router(missions_router)
app.include_router(dashboard_router)
app.include_router(swarm_router)
app.include_router(work_queue_router)


# Database session dependency
async def get_db() -> AsyncSession:
    """FastAPI dependency for database sessions."""
    async for session in get_session(app.state.session_factory):
        yield session


def _get_time_of_day(hour: int) -> str:
    """Convert hour to time of day description"""
    if 5 <= hour < 12:
        return "morning"
    elif 12 <= hour < 17:
        return "afternoon"
    elif 17 <= hour < 21:
        return "evening"
    else:
        return "night"


# Helper functions for emotion system
async def get_or_create_emotion_manager(session_id: int, personality: str | None = None):
    """Get or create emotion manager for a session"""
    from pathlib import Path

    from loguru import logger

    from dere_shared.emotion.manager import OCCEmotionManager
    from dere_shared.emotion.models import OCCAttitude, OCCGoal, OCCStandard

    if session_id in app.state.emotion_managers:
        return app.state.emotion_managers[session_id]

    # Load user OCC profile from config
    goals = []
    standards = []
    attitudes = []

    user_occ_path = Path.home() / ".config" / "dere" / "user_occ.json"
    if user_occ_path.exists():
        try:
            with open(user_occ_path) as f:
                user_occ = json.load(f)

            goals = [OCCGoal(**g) for g in user_occ.get("goals", [])]
            standards = [OCCStandard(**s) for s in user_occ.get("standards", [])]
            attitudes = [OCCAttitude(**a) for a in user_occ.get("attitudes", [])]

            logger.info(
                f"[Emotion] Loaded user OCC profile: {len(goals)} goals, "
                f"{len(standards)} standards, {len(attitudes)} attitudes"
            )
        except Exception as e:
            logger.warning(f"Failed to load user OCC profile: {e}")

    # Fall back to generic user-focused defaults if no profile exists
    if not goals:
        goals = [
            OCCGoal(
                id="accomplish_tasks",
                description="Complete tasks and get things done",
                active=True,
                importance=8,
            ),
            OCCGoal(
                id="learn_and_grow",
                description="Learn new things and develop skills",
                active=True,
                importance=7,
            ),
            OCCGoal(
                id="maintain_balance",
                description="Balance work, rest, and personal life",
                active=True,
                importance=6,
            ),
        ]

    if not standards:
        standards = [
            OCCStandard(
                id="be_productive",
                description="Use time effectively and accomplish goals",
                importance=8,
                praiseworthiness=7,
            ),
            OCCStandard(
                id="be_thoughtful",
                description="Consider consequences and make good decisions",
                importance=7,
                praiseworthiness=8,
            ),
            OCCStandard(
                id="be_persistent",
                description="Keep trying despite difficulties",
                importance=6,
                praiseworthiness=7,
            ),
        ]

    if not attitudes:
        attitudes = [
            OCCAttitude(
                id="challenges",
                target_object="unexpected_challenges",
                description="Attitude toward unexpected challenges",
                appealingness=-2,
            ),
            OCCAttitude(
                id="learning",
                target_object="learning_opportunities",
                description="Attitude toward learning new things",
                appealingness=5,
            ),
            OCCAttitude(
                id="interruptions",
                target_object="interruptions",
                description="Attitude toward being interrupted during work",
                appealingness=-5,
            ),
        ]

    # Create LLM client for emotion appraisal
    from dere_shared.llm_client import ClaudeClient

    llm_client = ClaudeClient(model="claude-haiku-4-5")

    manager = OCCEmotionManager(
        goals=goals,
        standards=standards,
        attitudes=attitudes,
        session_id=session_id,
        db=app.state.db,
        llm_client=llm_client,
    )

    await manager.initialize()
    app.state.emotion_managers[session_id] = manager

    return manager


# Global emotion manager singleton (session_id=0 as sentinel for global)
GLOBAL_EMOTION_SESSION_ID = 0
_global_emotion_manager_lock = asyncio.Lock()


async def get_global_emotion_manager():
    """Get the global emotion manager (singleton, not tied to any session)."""
    async with _global_emotion_manager_lock:
        if GLOBAL_EMOTION_SESSION_ID in app.state.emotion_managers:
            return app.state.emotion_managers[GLOBAL_EMOTION_SESSION_ID]

        # Reuse the existing creation logic with session_id=0
        return await get_or_create_emotion_manager(GLOBAL_EMOTION_SESSION_ID)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "dere_graph": "available" if app.state.dere_graph else "unavailable",
    }


@app.get("/user/info")
async def get_user_info():
    """Get current user info from config."""
    config = load_dere_config()
    return {"name": config.user.name}


@app.get("/config")
async def get_config():
    """Get current configuration."""
    return load_dere_config()


@app.put("/config")
async def update_config(updates: dict[str, Any]):
    """Update configuration and persist to config file.

    Deep-merges the provided updates with existing config,
    validates, and saves to ~/.config/dere/config.toml.
    """
    try:
        updated_config = save_dere_config(updates)
        return updated_config
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/config/schema")
async def get_config_schema_endpoint():
    """Get configuration JSON schema with UI metadata.

    Returns the full JSON Schema for DereConfig including
    field titles, descriptions, types, and UI hints like
    ui_type, ui_group, ui_order, and options for select fields.
    """
    return get_config_schema()


# Personality Management Endpoints


@app.get("/personalities")
async def list_personalities():
    """List all personalities with their source indicator."""
    loader = app.state.personality_loader
    if not loader:
        raise HTTPException(status_code=500, detail="Personality loader not initialized")

    personalities = loader.list_all_with_source()
    return {
        "personalities": [
            {
                "name": p.name,
                "short_name": p.short_name,
                "color": p.color,
                "icon": p.icon,
                "source": p.source.value,
                "has_embedded": p.has_embedded,
            }
            for p in personalities
        ]
    }


@app.get("/personalities/{name}")
async def get_personality(name: str):
    """Get a single personality's full data for editing."""
    loader = app.state.personality_loader
    if not loader:
        raise HTTPException(status_code=500, detail="Personality loader not initialized")

    try:
        data = loader.get_full(name)
        is_override = loader.is_user_override(name)
        has_embedded = name.lower() in loader._get_embedded_names()
        return {
            "data": data,
            "is_override": is_override,
            "has_embedded": has_embedded,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class PersonalitySaveRequest(BaseModel):
    """Request body for saving a personality."""

    metadata: dict = {}
    display: dict = {}
    prompt: dict = {}


@app.put("/personalities/{name}")
async def save_personality(name: str, req: PersonalitySaveRequest):
    """Save a personality to user config directory."""
    loader = app.state.personality_loader
    if not loader:
        raise HTTPException(status_code=500, detail="Personality loader not initialized")

    try:
        loader.save_to_user_config(name, req.model_dump())
        return {"status": "saved", "name": name}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


_AVATAR_ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
_AVATAR_MAX_BYTES = 5 * 1024 * 1024


def _sanitize_stem(stem: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in stem.lower())
    return safe.strip("._-") or "avatar"


@app.post("/personalities/{name}/avatar")
async def upload_personality_avatar(name: str, file: UploadFile = File(...)):
    """Upload a profile image for a personality.

    Stores under ~/.config/dere/personalities/avatars and updates display.avatar.
    """
    loader = app.state.personality_loader
    if not loader or not loader.config_dir:
        raise HTTPException(status_code=500, detail="Personality loader not initialized")

    try:
        data = loader.get_full(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _AVATAR_ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(_AVATAR_ALLOWED_EXTS))}",
        )

    content = await file.read()
    if len(content) > _AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Avatar too large (max 5MB)")

    short_name = (
        (data.get("metadata") or {}).get("short_name")
        or (data.get("metadata") or {}).get("name")
        or name
    )
    safe_stem = _sanitize_stem(str(short_name))

    personalities_dir = loader.config_dir / "personalities"
    avatars_dir = personalities_dir / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    target_path = avatars_dir / f"{safe_stem}{suffix}"
    target_path.write_bytes(content)

    display = data.get("display") or {}
    rel_path = f"avatars/{target_path.name}"
    display["avatar"] = rel_path
    data["display"] = display

    loader.save_to_user_config(name, data)

    return {"status": "ok", "avatar": rel_path}


@app.get("/personalities/{name}/avatar")
async def get_personality_avatar(name: str):
    """Serve a personality's avatar image."""
    loader = app.state.personality_loader
    if not loader or not loader.config_dir:
        raise HTTPException(status_code=500, detail="Personality loader not initialized")

    try:
        data = loader.get_full(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    avatar_rel = (data.get("display") or {}).get("avatar")
    if not avatar_rel:
        raise HTTPException(status_code=404, detail="No avatar set")

    personalities_dir = (loader.config_dir / "personalities").resolve()
    avatar_path = (personalities_dir / avatar_rel).resolve()
    if not str(avatar_path).startswith(str(personalities_dir)):
        raise HTTPException(status_code=400, detail="Invalid avatar path")
    if not avatar_path.exists():
        raise HTTPException(status_code=404, detail="Avatar file not found")

    return FileResponse(avatar_path)


@app.delete("/personalities/{name}")
async def delete_personality(name: str):
    """Delete a user config personality (reverts to embedded if exists)."""
    loader = app.state.personality_loader
    if not loader:
        raise HTTPException(status_code=500, detail="Personality loader not initialized")

    has_embedded = name.lower() in loader._get_embedded_names()
    deleted = loader.delete_from_user_config(name)

    if not deleted:
        if not has_embedded:
            raise HTTPException(status_code=404, detail=f"Personality '{name}' not found")
        raise HTTPException(status_code=400, detail=f"Cannot delete embedded personality '{name}'")

    return {
        "status": "deleted" if not has_embedded else "reverted",
        "name": name,
        "has_embedded": has_embedded,
    }


@app.post("/search/similar")
async def search_similar(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Search for similar conversations using vector similarity"""

    if not app.state.dere_graph:
        return {"results": []}

    try:
        search_results = await app.state.dere_graph.search(
            query=req.query,
            group_id=req.user_id or "default",
            limit=req.limit,
        )

        # Format as conversation-like results
        results = []
        for edge in search_results.edges:
            results.append(
                {
                    "id": edge.uuid,
                    "session_id": None,
                    "prompt": edge.fact,
                    "message_type": "knowledge",
                    "timestamp": int(edge.created_at.timestamp()) if edge.created_at else 0,
                    "similarity": 0.9,
                }
            )

        return {"results": results}
    except Exception as e:
        from loguru import logger

        logger.error(f"Knowledge graph search failed: {e}")
        return {"results": []}


@app.post("/embeddings/generate")
async def generate_embedding(text: str):
    """Generate embedding for text using dere_graph"""
    if not app.state.dere_graph:
        return {"error": "dere_graph not available"}, 503

    try:
        embedding = await app.state.dere_graph.embedder.create(text)
        return {"embedding": embedding, "model": "text-embedding-3-small"}
    except Exception as e:
        from loguru import logger

        logger.error(f"Embedding generation failed: {e}")
        return {"error": str(e)}, 500


@app.post("/search/hybrid")
async def search_hybrid(req: HybridSearchRequest, db: AsyncSession = Depends(get_db)):
    """Hybrid search using entities and embeddings.

    Supports cross-medium search:
    - If user_session_id provided: search across all sessions in user_session
    - If session_id provided: resolve user_session_id and search across all sessions
    - Otherwise: search all conversations
    """

    # Use knowledge graph search instead of embeddings
    if not app.state.dere_graph:
        return {"results": []}

    try:
        from datetime import datetime

        from dere_graph.filters import ComparisonOperator, DateFilter, SearchFilters

        # Build temporal filters
        filters = None
        if req.since or req.before or req.as_of or req.only_valid:
            filters = SearchFilters()

            if req.since:
                filters.created_at = DateFilter(
                    operator=ComparisonOperator.GREATER_THAN_EQUAL,
                    value=datetime.fromisoformat(req.since.replace("Z", "+00:00")),
                )

            if req.before:
                filters.created_at = DateFilter(
                    operator=ComparisonOperator.LESS_THAN_EQUAL,
                    value=datetime.fromisoformat(req.before.replace("Z", "+00:00")),
                )

            if req.only_valid:
                filters.invalid_at = DateFilter(operator=ComparisonOperator.IS_NULL)

        # Resolve center entity if provided
        center_node_uuid = None
        if req.center_entity and req.rerank_method == "distance":
            entity_search = await app.state.dere_graph.search(
                query=req.center_entity,
                group_id=req.user_id or "default",
                limit=1,
            )
            if entity_search.nodes:
                center_node_uuid = entity_search.nodes[0].uuid

        # Execute search with filters and reranking
        search_results = await app.state.dere_graph.search(
            query=req.query,
            group_id=req.user_id or "default",
            limit=req.limit,
            filters=filters,
            center_node_uuid=center_node_uuid,
            rerank_method=req.rerank_method,
            lambda_param=req.diversity if req.rerank_method == "mmr" else 0.5,
            recency_weight=0.3,  # Always give slight boost to recent
        )

        # Format results
        results = []
        for edge in search_results.edges:
            results.append(
                {
                    "id": edge.uuid,
                    "session_id": None,
                    "prompt": edge.fact,
                    "message_type": "knowledge",
                    "timestamp": int(edge.created_at.timestamp()) if edge.created_at else 0,
                    "working_dir": None,
                    "medium": None,
                    "entity_score": 0.0,
                    "semantic_score": 0.9,
                    "recency_score": 0.5,
                    "combined_score": 0.8,
                }
            )

        return {"results": results, "entity_values": req.entity_values}
    except Exception as e:
        from loguru import logger

        logger.error(f"Hybrid search failed: {e}")
        return {"results": [], "entity_values": req.entity_values}


@app.post("/conversation/capture")
async def conversation_capture(req: ConversationCaptureRequest, db: AsyncSession = Depends(get_db)):
    """Capture conversation and queue background tasks"""
    from sqlalchemy import select

    # Ensure session exists
    stmt = select(Session).where(Session.id == req.session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        session = Session(
            id=req.session_id,
            working_dir=req.project_path or "",
            start_time=int(time.time()),
            last_activity=datetime.now(UTC),
        )
        db.add(session)
        await db.flush()

    # Store conversation
    conv = Conversation(
        session_id=req.session_id,
        prompt=req.prompt,
        message_type=MessageType(req.message_type),
        personality=req.personality,
        processing_mode="raw",
        timestamp=int(time.time()),
        medium=req.medium,
        user_id=req.user_id,
    )
    db.add(conv)
    await db.flush()
    conversation_id = conv.id

    if req.prompt and req.prompt.strip():
        db.add(
            ConversationBlock(
                conversation_id=conv.id,  # type: ignore[arg-type]
                ordinal=0,
                block_type="text",
                text=req.prompt,
            )
        )

    # Queue background processing (don't block response)
    if req.message_type == "user":
        import asyncio

        async def process_background():
            from datetime import UTC, datetime

            from loguru import logger

            # Add to knowledge graph if enabled
            if app.state.dere_graph:
                try:
                    from dere_graph.models import EpisodeType

                    # Use canonical user name from config
                    canonical_user_name = app.state.config.get("user", {}).get("name", "User")

                    await app.state.dere_graph.add_episode(
                        episode_body=req.prompt,
                        source_description=f"{req.medium or 'cli'} conversation",
                        reference_time=datetime.fromtimestamp(conv.timestamp, tz=UTC),
                        source=EpisodeType.message,
                        group_id=req.user_id or "default",
                        speaker_id=req.user_id,
                        speaker_name=canonical_user_name,
                        personality=req.personality,
                    )
                except Exception:
                    logger.exception("Failed to add episode to knowledge graph")

            # Process emotion (global state, session tracked in context)
            try:
                emotion_manager = await get_global_emotion_manager()

                # Build stimulus from conversation (include session_id for tracking)
                stimulus = {
                    "type": "user_message",
                    "content": req.prompt,
                    "message_type": req.message_type,
                    "session_id": req.session_id,
                }

                # Enrich context with temporal and session information
                now = datetime.now()

                # Get session info using session_factory
                async with app.state.session_factory() as bg_session:
                    stmt = select(Session).where(Session.id == req.session_id)
                    result = await bg_session.execute(stmt)
                    session_obj = result.scalar_one_or_none()
                    session_start = session_obj.start_time if session_obj else None
                    await bg_session.commit()

                # Calculate session duration
                session_duration_minutes = 0
                if session_start:
                    session_duration_minutes = (now.timestamp() - session_start) / 60

                context = {
                    "conversation_id": conversation_id,
                    "personality": req.personality,
                    "temporal": {
                        "hour": now.hour,
                        "day_of_week": now.strftime("%A"),
                        "time_of_day": _get_time_of_day(now.hour),
                    },
                    "session": {
                        "duration_minutes": int(session_duration_minutes),
                        "working_dir": session_obj.working_dir if session_obj else None,
                    },
                }

                # Buffer stimulus for batch appraisal (will flush on idle timeout or session end)
                persona_prompt = ""
                if req.personality:
                    try:
                        personality = app.state.personality_loader.load(req.personality)
                        persona_prompt = personality.prompt_content
                    except ValueError:
                        pass
                emotion_manager.buffer_stimulus(stimulus, context, persona_prompt)

            except Exception as e:
                logger.error(f"[conversation_capture] Emotion processing failed: {e}")

        # Fire and forget - don't await
        asyncio.create_task(process_background())

    return {"status": "stored"}


@app.post("/status/get")
async def status_get(req: StatusRequest, db: AsyncSession = Depends(get_db)):
    """Get daemon and queue status"""
    from sqlalchemy import func, select

    # Get queue stats
    stmt = select(
        TaskQueue.status,
        func.count(TaskQueue.id).label("count"),
    ).group_by(TaskQueue.status)
    result = await db.execute(stmt)
    rows = result.all()

    queue_stats = {row.status: row.count for row in rows}
    queue_stats.setdefault(TaskStatus.PENDING, 0)
    queue_stats.setdefault(TaskStatus.PROCESSING, 0)
    queue_stats.setdefault(TaskStatus.COMPLETED, 0)
    queue_stats.setdefault(TaskStatus.FAILED, 0)

    status = {"daemon": "running", "queue": queue_stats}

    if req.personality:
        status["personality"] = req.personality
    if req.mcp_servers:
        status["mcp_servers"] = req.mcp_servers
    if req.context:
        status["context_enabled"] = True
    if req.session_type:
        status["session_type"] = req.session_type

    return status


@app.post("/queue/add")
async def queue_add(req: QueueAddRequest, db: AsyncSession = Depends(get_db)):
    """Add task to processing queue"""
    task = TaskQueue(
        task_type=req.task_type,
        model_name=req.model_name,
        content=req.content,
        task_metadata=req.metadata,
        priority=req.priority,
        status=TaskStatus.PENDING,
        session_id=req.session_id,
    )
    db.add(task)
    await db.flush()

    return {"task_id": task.id, "status": "queued"}


@app.get("/queue/status")
async def queue_status(db: AsyncSession = Depends(get_db)):
    """Get queue statistics"""
    from sqlalchemy import func, select

    stmt = select(
        TaskQueue.status,
        func.count(TaskQueue.id).label("count"),
    ).group_by(TaskQueue.status)
    result = await db.execute(stmt)
    rows = result.all()

    stats = {row.status: row.count for row in rows}
    stats.setdefault(TaskStatus.PENDING, 0)
    stats.setdefault(TaskStatus.PROCESSING, 0)
    stats.setdefault(TaskStatus.COMPLETED, 0)
    stats.setdefault(TaskStatus.FAILED, 0)

    return stats


@app.post("/llm/generate")
async def llm_generate(req: LLMGenerateRequest):
    """Generate LLM response with optional personality/emotion context using Claude CLI."""
    import asyncio

    from dere_daemon.context import compose_session_context

    try:
        prompt = req.prompt

        # Optionally inject personality + emotion context
        if req.include_context:
            context, resolved_session_id = await compose_session_context(
                session_id=req.session_id,
                session_factory=app.state.session_factory,
                personality_loader=app.state.personality_loader,
                medium=req.medium,
                include_emotion=True,
            )
            if context:
                prompt = f"{context}\n\n{prompt}"
                logger.debug(
                    "Injected context for session {} (medium: {})",
                    resolved_session_id,
                    req.medium or "any",
                )

        # Build claude command
        cmd = [
            "claude",
            "--print",
            "--output-format",
            "json",
            "-p",
            prompt,
            "--model",
            req.model,
        ]

        # For isolated calls (ambient, emotion), run from temp dir to avoid polluting history
        # This ensures internal LLM calls don't interfere with user's -c
        temp_dir = None
        if req.isolate_session:
            import tempfile

            temp_dir = Path(tempfile.gettempdir()) / "dere_internal"
            temp_dir.mkdir(exist_ok=True)

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(temp_dir) if temp_dir else None,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode()
            logger.error("Claude CLI failed: {}", error_msg)
            return {"error": error_msg}

        response_text = stdout.decode()
        return {"response": response_text}
    except Exception as e:
        logger.error("LLM generation failed: {}", e)
        return {"error": str(e)}


@app.post("/routing/decide")
async def routing_decide(req: RoutingDecideRequest, db: AsyncSession = Depends(get_db)):
    """Use LLM to decide where to route a message based on context.

    This is the core of omnipresent routing - NO hardcoded rules.
    LLM analyzes available mediums, user activity, recent conversations,
    and makes an intelligent decision about where to deliver the message.
    """
    from datetime import timedelta

    from sqlalchemy import select

    from dere_daemon.routing import decide_routing

    # Get available mediums
    stale_threshold = datetime.now(UTC) - timedelta(seconds=60)
    stmt = (
        select(Presence)
        .where(Presence.user_id == req.user_id)
        .where(Presence.last_heartbeat >= stale_threshold)
    )
    result = await db.execute(stmt)
    presences = result.scalars().all()

    available_mediums = [
        {
            "medium": p.medium,
            "available_channels": p.available_channels if p.available_channels else [],
            "last_heartbeat": p.last_heartbeat,
        }
        for p in presences
    ]

    # Get recent conversations to understand where user has been active
    stmt = (
        select(Conversation.medium, Conversation.timestamp, Conversation.prompt)
        .where(Conversation.user_id == req.user_id)
        .where(Conversation.medium.is_not(None))
        .order_by(Conversation.timestamp.desc())
        .limit(10)
    )
    result = await db.execute(stmt)
    rows = result.all()

    recent_conversations = [
        {"medium": row.medium, "timestamp": row.timestamp, "prompt": row.prompt} for row in rows
    ]

    # Make routing decision (pass session_factory instead of db)
    llm_client = app.state.dere_graph.llm_client if app.state.dere_graph else None
    decision = await decide_routing(
        user_id=req.user_id,
        message=req.message,
        priority=req.priority,
        available_mediums=available_mediums,
        user_activity=req.user_activity,
        recent_conversations=recent_conversations,
        session_factory=app.state.session_factory,
        llm_client=llm_client,
    )

    return {
        "medium": decision.medium,
        "location": decision.location,
        "reasoning": decision.reasoning,
        "fallback": decision.fallback,
    }


@app.get("/conversations/last_dm/{user_id}")
async def get_last_dm_message(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get the last message exchanged in Discord DMs with this user.

    Used by ambient monitor to provide conversation continuity context.
    """
    from sqlalchemy import select

    stmt = (
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .where(Conversation.medium == "discord")
        .order_by(Conversation.timestamp.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    last_msg = result.scalar_one_or_none()

    if last_msg:
        import time

        minutes_ago = int((time.time() - last_msg.timestamp) / 60)
        return {
            "message": last_msg.prompt,
            "message_type": last_msg.message_type,
            "timestamp": last_msg.timestamp,
            "minutes_ago": minutes_ago,
            "session_id": last_msg.session_id,
        }
    return {"message": None}


@app.post("/api/consolidate/memory")
async def consolidate_memory(
    user_id: str | None = None,
    recency_days: int = 30,
    model: str = "gemma3n:latest",
    update_core_memory: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Trigger memory consolidation for a user.

    Analyzes entity patterns, generates LLM summary, stores insights.

    Args:
        user_id: Optional user ID partition (defaults to global graph)
        recency_days: Number of days to look back
        model: Model to use for summary generation

    Returns:
        Consolidation summary and statistics
    """
    # Queue memory consolidation task
    group_id = user_id or "default"
    task = TaskQueue(
        task_type="memory_consolidation",
        model_name=model,
        content=f"Memory consolidation for group {group_id}",
        session_id=None,
        task_metadata={
            "user_id": user_id,
            "recency_days": recency_days,
            "update_core_memory": update_core_memory,
            "trigger": "manual",
        },
        priority=5,
        status=TaskStatus.PENDING,
    )
    db.add(task)
    await db.flush()

    # Wait for task to complete (or return immediately for async processing)
    # For now, return task ID for async processing
    return {
        "success": True,
        "task_id": task.id,
        "message": f"Memory consolidation queued for group {group_id}",
    }


def _configure_logging() -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level="INFO",
        format="<level>{level: <8}</level> | <cyan>{name}</cyan> | {message}",
        colorize=True,
    )


def _get_data_dir() -> Path:
    """Get platform-specific data directory."""
    match platform.system():
        case "Windows":
            return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            return Path.home() / "Library" / "Application Support" / "dere"
        case _:
            return Path.home() / ".local" / "share" / "dere"


def _check_port_available(host: str, port: int) -> bool:
    """Check if a port is available for binding."""
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host, port))
            return True
    except OSError:
        return False


def _check_process_running(pid: int) -> bool:
    """Check if a process with given PID is running."""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _handle_existing_instance(host: str, port: int) -> None:
    """Handle case where daemon might already be running."""
    data_dir = _get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    pid_file = data_dir / "daemon.pid"

    if not _check_port_available(host, port):
        if pid_file.exists():
            try:
                existing_pid = int(pid_file.read_text().strip())
                if _check_process_running(existing_pid):
                    logger.error(f"Daemon already running (PID: {existing_pid})")
                    logger.info(f"To stop it, run: kill {existing_pid}")
                    logger.info("Or use: just dev-all  (which will stop existing instances)")
                    sys.exit(1)
                else:
                    logger.warning(f"Stale PID file found (PID {existing_pid} not running)")
                    pid_file.unlink()
                    logger.info("Cleaned up stale PID file, checking port again...")
                    if not _check_port_available(host, port):
                        logger.error(f"Port {port} still in use by unknown process")
                        logger.info(f"Find process with: lsof -i :{port}")
                        sys.exit(1)
            except (ValueError, OSError) as e:
                logger.warning(f"Could not read PID file: {e}")
                pid_file.unlink()
        else:
            logger.error(f"Port {port} is in use but no PID file found")
            logger.info("Another process may be using the port")
            logger.info(f"Find it with: lsof -i :{port}")
            sys.exit(1)


def _setup_socket_dir() -> Path | None:
    """Create the socket directory with proper permissions.

    Uses XDG_RUNTIME_DIR if available (user-writable, no sudo needed).
    Falls back to /run/dere for system-wide installations.

    Returns:
        Path to socket file if setup succeeded, None otherwise.
    """
    from dere_shared.constants import get_daemon_socket_path

    socket_path = Path(get_daemon_socket_path())
    socket_dir = socket_path.parent

    try:
        # Create directory with 0750 permissions (owner: rwx, group: rx, other: none)
        socket_dir.mkdir(mode=0o750, parents=True, exist_ok=True)

        # Remove stale socket file if it exists
        if socket_path.exists():
            socket_path.unlink()

        return socket_path
    except PermissionError:
        logger.warning(
            "Cannot create socket directory {} (permission denied). "
            "UDS listener disabled. Run with appropriate permissions or use TCP.",
            socket_dir,
        )
        return None
    except Exception as e:
        logger.warning("Failed to setup socket directory: {}. UDS listener disabled.", e)
        return None


def _cleanup_socket(socket_path: Path | None) -> None:
    """Remove socket file on shutdown."""
    if socket_path and socket_path.exists():
        try:
            socket_path.unlink()
        except Exception:
            pass


def main():
    """Main entry point for the daemon"""
    import uvicorn

    from dere_shared.constants import DEFAULT_DAEMON_PORT

    _configure_logging()

    host = "127.0.0.1"
    port = DEFAULT_DAEMON_PORT

    _handle_existing_instance(host, port)

    # Setup Unix Domain Socket
    socket_path = _setup_socket_dir()

    if socket_path:
        # Run with both TCP and UDS listeners using uvicorn config
        import asyncio
        import signal

        async def serve():
            # TCP server
            tcp_config = uvicorn.Config(
                app, host=host, port=port, log_level="warning", access_log=False
            )
            tcp_server = uvicorn.Server(tcp_config)

            # UDS server (lifespan handled by TCP server)
            uds_config = uvicorn.Config(
                app, uds=str(socket_path), log_level="warning", access_log=False, lifespan="off"
            )
            uds_server = uvicorn.Server(uds_config)

            # Handle shutdown gracefully
            loop = asyncio.get_event_loop()
            shutdown_event = asyncio.Event()

            def handle_signal():
                shutdown_event.set()

            for sig in (signal.SIGTERM, signal.SIGINT):
                loop.add_signal_handler(sig, handle_signal)

            print(f"Dere daemon listening on tcp://{host}:{port} and unix://{socket_path}")

            try:
                # Start both servers
                await asyncio.gather(
                    tcp_server.serve(),
                    uds_server.serve(),
                )
            finally:
                _cleanup_socket(socket_path)

        asyncio.run(serve())
    else:
        # Fallback to TCP only
        print(f"Dere daemon listening on tcp://{host}:{port} (UDS unavailable)")
        uvicorn.run(app, host=host, port=port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
