"""Collect curiosity triggers and store them in the work queue."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, TYPE_CHECKING

from loguru import logger
from sqlalchemy import func, select

from dere_shared.models import ProjectTask, ProjectTaskStatus

from .corrections import detect_correction
from .emotions import detect_emotional_peak
from .entities import detect_unfamiliar_entities
from .knowledge_gap import detect_knowledge_gap
from .priority import compute_curiosity_priority
from .types import CuriositySignal
from .unfinished_thread import detect_unfinished_thread

if TYPE_CHECKING:
    from collections.abc import Callable

    from sqlalchemy.ext.asyncio import AsyncSession


async def process_curiosity_triggers(
    *,
    prompt: str,
    session_id: int,
    conversation_id: int,
    user_id: str | None,
    working_dir: str,
    personality: str | None,
    speaker_name: str | None,
    is_command: bool,
    message_type: str = "user",
    kg_nodes: list[Any] | None,
    session_factory: Callable[[], AsyncSession],
) -> int:
    text = prompt.strip()
    if not text:
        return 0

    if message_type == "user" and is_command:
        return 0

    if len(text) < 6:
        return 0

    async with session_factory() as db:
        signals: list[CuriositySignal] = []
        if message_type == "user":
            previous_assistant = await _get_previous_assistant_message(
                db,
                session_id=session_id,
                conversation_id=conversation_id,
            )
            signals.extend(
                detect_unfamiliar_entities(
                    prompt=text,
                    nodes=kg_nodes,
                    speaker_name=speaker_name,
                    personality=personality,
                )
            )

            correction = detect_correction(
                prompt=text, previous_assistant=previous_assistant
            )
            if correction:
                signals.append(correction)

            emotional = detect_emotional_peak(prompt=text)
            if emotional:
                signals.append(emotional)

            unfinished = detect_unfinished_thread(
                prompt=text,
                previous_assistant=previous_assistant,
            )
            if unfinished:
                signals.append(unfinished)
        elif message_type == "assistant":
            previous_user = await _get_previous_user_message(
                db,
                session_id=session_id,
                conversation_id=conversation_id,
            )
            knowledge_gap = detect_knowledge_gap(
                prompt=text,
                previous_user=previous_user,
            )
            if knowledge_gap:
                signals.append(knowledge_gap)

        if not signals:
            return 0

        await _enforce_backlog_limits(db, user_id=user_id)

        created = 0
        seen_topics: set[str] = set()
        for signal in signals:
            normalized = _normalize_topic(signal.topic)
            if normalized in seen_topics:
                continue
            seen_topics.add(normalized)

            logger.info(
                "Curiosity trigger: type={} topic={} reason={}",
                signal.curiosity_type,
                signal.topic,
                signal.trigger_reason,
            )
            created += await _upsert_curiosity_task(
                db,
                signal,
                working_dir=working_dir,
                user_id=user_id,
                conversation_id=conversation_id,
            )

        await db.commit()
        if created:
            logger.info(
                "Curiosity triggers stored: created={} total_signals={}",
                created,
                len(signals),
            )
        return created


async def _get_previous_assistant_message(
    db: AsyncSession,
    *,
    session_id: int,
    conversation_id: int,
) -> str | None:
    from dere_shared.models import Conversation

    stmt = (
        select(Conversation.prompt)
        .where(Conversation.session_id == session_id)
        .where(Conversation.message_type == "assistant")
        .where(Conversation.id < conversation_id)
        .order_by(Conversation.id.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _get_previous_user_message(
    db: AsyncSession,
    *,
    session_id: int,
    conversation_id: int,
) -> str | None:
    from dere_shared.models import Conversation

    stmt = (
        select(Conversation.prompt)
        .where(Conversation.session_id == session_id)
        .where(Conversation.message_type == "user")
        .where(Conversation.id < conversation_id)
        .order_by(Conversation.id.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def _upsert_curiosity_task(
    db: AsyncSession,
    signal: CuriositySignal,
    *,
    working_dir: str,
    user_id: str | None,
    conversation_id: int,
) -> int:
    normalized_topic = _normalize_topic(signal.topic)
    stmt = (
        select(ProjectTask)
        .where(ProjectTask.task_type == "curiosity")
        .where(func.lower(ProjectTask.title) == normalized_topic)
        .limit(1)
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    now = datetime.now(UTC)

    if existing and existing.status in {
        ProjectTaskStatus.DONE.value,
        ProjectTaskStatus.CANCELLED.value,
    }:
        existing = None

    if existing:
        extra = dict(existing.extra or {})
        trigger_count = int(extra.get("trigger_count") or 0) + 1
        exploration_count = int(extra.get("exploration_count") or 0)
        recency = _recency_factor(existing, signal)
        priority, factors = compute_curiosity_priority(
            signal,
            exploration_count=exploration_count,
            recency=recency,
        )
        repeat_bonus = min(0.2, 0.05 * trigger_count)
        priority = min(1.0, priority + repeat_bonus)
        factors["repeat_bonus"] = repeat_bonus

        existing.priority = max(existing.priority, int(priority * 100))
        existing.updated_at = now
        existing.extra = _merge_extra(
            extra,
            signal,
            priority_factors=factors,
            trigger_count=trigger_count,
            conversation_id=conversation_id,
            user_id=user_id,
            now=now,
        )
        logger.info(
            "Updated curiosity task {}: type={} priority={} triggers={}",
            existing.id,
            signal.curiosity_type,
            existing.priority,
            trigger_count,
        )
        return 0

    priority, factors = compute_curiosity_priority(signal)
    task = ProjectTask(
        working_dir=working_dir,
        title=signal.topic,
        description=f"Curiosity trigger: {signal.trigger_reason}",
        task_type="curiosity",
        priority=int(priority * 100),
        status=ProjectTaskStatus.READY.value,
        extra=_merge_extra(
            {},
            signal,
            priority_factors=factors,
            trigger_count=1,
            conversation_id=conversation_id,
            user_id=user_id,
            now=now,
        ),
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    logger.info(
        "Created curiosity task: type={} topic={} priority={}",
        signal.curiosity_type,
        signal.topic,
        task.priority,
    )
    return 1


async def _enforce_backlog_limits(db: AsyncSession, *, user_id: str | None) -> None:
    max_pending = 100
    max_per_type = 25
    prune_threshold = 0.15

    pending_statuses = {
        ProjectTaskStatus.BACKLOG.value,
        ProjectTaskStatus.READY.value,
        ProjectTaskStatus.BLOCKED.value,
    }

    query = select(ProjectTask).where(ProjectTask.task_type == "curiosity")
    query = query.where(ProjectTask.status.in_(pending_statuses))
    if user_id:
        query = query.where(ProjectTask.extra["user_id"].astext == user_id)

    result = await db.execute(query)
    tasks = list(result.scalars().all())
    if not tasks:
        return

    now = datetime.now(UTC)
    to_cancel: set[int] = set()

    for task in tasks:
        if _should_prune_task(task, now, prune_threshold):
            to_cancel.add(task.id)

    remaining = [t for t in tasks if t.id not in to_cancel]
    if len(remaining) > max_pending:
        overflow = len(remaining) - max_pending
        for task in _lowest_priority(remaining)[:overflow]:
            to_cancel.add(task.id)
            remaining.remove(task)

    by_type: dict[str, list[ProjectTask]] = {}
    for task in remaining:
        curiosity_type = _task_curiosity_type(task)
        by_type.setdefault(curiosity_type, []).append(task)

    for curiosity_type, bucket in by_type.items():
        if len(bucket) <= max_per_type:
            continue
        overflow = len(bucket) - max_per_type
        for task in _lowest_priority(bucket)[:overflow]:
            to_cancel.add(task.id)

    for task in tasks:
        if task.id not in to_cancel:
            continue
        task.status = ProjectTaskStatus.CANCELLED.value
        task.updated_at = now
        task.last_error = "pruned by backlog limits"
        extra = dict(task.extra or {})
        extra["pruned_at"] = now.isoformat()
        extra.setdefault("pruned_reason", "backlog_limits")
        task.extra = extra


def _should_prune_task(
    task: ProjectTask,
    now: datetime,
    prune_threshold: float,
) -> bool:
    curiosity_type = _task_curiosity_type(task)
    ttl_days = 7 if curiosity_type == "correction" else 14
    cutoff = now - timedelta(days=ttl_days)

    last_triggered = _parse_iso_datetime(
        (task.extra or {}).get("last_triggered_at")
    )
    effective_time = last_triggered or task.created_at
    if effective_time and effective_time < cutoff:
        return True

    priority = (task.priority or 0) / 100
    return priority < prune_threshold


def _lowest_priority(tasks: list[ProjectTask]) -> list[ProjectTask]:
    return sorted(
        tasks,
        key=lambda task: (task.priority or 0, task.created_at or datetime.min),
    )


def _task_curiosity_type(task: ProjectTask) -> str:
    extra = task.extra or {}
    return str(extra.get("curiosity_type") or "unknown")


def _recency_factor(task: ProjectTask, signal: CuriositySignal) -> float:
    base = 1.0
    ttl_days = 7 if signal.curiosity_type == "correction" else 14
    last_triggered = _parse_iso_datetime(
        (task.extra or {}).get("last_triggered_at")
    )
    effective_time = last_triggered or task.created_at
    if not effective_time:
        return base
    age_days = max(0.0, (datetime.now(UTC) - effective_time).total_seconds() / 86400)
    return max(0.0, 1.0 - (age_days / ttl_days))


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _merge_extra(
    base: dict[str, Any],
    signal: CuriositySignal,
    *,
    priority_factors: dict[str, float],
    trigger_count: int,
    conversation_id: int,
    user_id: str | None,
    now: datetime,
) -> dict[str, Any]:
    extra = dict(base)
    extra.update(
        {
            "curiosity_type": signal.curiosity_type,
            "source_context": signal.source_context,
            "trigger_reason": signal.trigger_reason,
            "priority_factors": priority_factors,
            "trigger_count": trigger_count,
            "last_triggered_at": now.isoformat(),
            "user_id": user_id,
            "conversation_id": conversation_id,
        }
    )

    extra.setdefault("findings", [])
    extra.setdefault("exploration_count", 0)
    extra.setdefault("last_explored_at", None)
    extra.setdefault("satisfaction_level", 0.0)

    return extra


def _normalize_topic(topic: str) -> str:
    return topic.strip().lower()
