"""Ambient exploration runner for curiosity tasks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
import re
from typing import TYPE_CHECKING, Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.models import (
    ExplorationFinding,
    Mission,
    MissionStatus,
    MissionTriggerType,
    ProjectTask,
    ProjectTaskStatus,
)

from .config import AmbientConfig

if TYPE_CHECKING:
    from collections.abc import Callable

    from dere_graph.graph import DereGraph
    from dere_daemon.missions.executor import MissionExecutor
    from dere_daemon.work_queue import WorkQueueCoordinator


EXPLORATION_PROMPT = """
You are exploring a topic the user mentioned: {topic}

Context from conversation:
{source_context}

Your task:
1. Research this topic using available tools (web search, knowledge lookup)
2. Gather key facts that would be useful for future conversations
3. Note any follow-up questions worth exploring

Output JSON:
{
    "findings": ["fact 1", "fact 2", ...],
    "confidence": 0.0-1.0,
    "follow_up_questions": ["question 1", ...],
    "worth_sharing": true/false,
    "share_message": "optional message if worth sharing"
}
"""

EXPLORATION_ALLOWED_TOOLS = ["Read", "WebSearch", "WebFetch"]


@dataclass
class ExplorationResult:
    findings: list[str]
    confidence: float
    follow_up_questions: list[str]
    worth_sharing: bool
    share_message: str | None = None


@dataclass
class ExplorationOutcome:
    task_id: int
    result: ExplorationResult | None
    error_message: str | None = None


class AmbientExplorer:
    """Runs curiosity exploration missions and stores findings."""

    def __init__(
        self,
        *,
        config: AmbientConfig,
        mission_executor: MissionExecutor,
        session_factory: Callable[[], AsyncSession],
        work_queue: WorkQueueCoordinator | None = None,
        dere_graph: DereGraph | None = None,
    ) -> None:
        self.config = config
        self.mission_executor = mission_executor
        self.session_factory = session_factory
        self.work_queue = work_queue
        self.dere_graph = dere_graph

    async def has_pending_curiosities(self) -> bool:
        async with self.session_factory() as db:
            stmt = (
                select(ProjectTask.id)
                .where(
                    ProjectTask.task_type == "curiosity",
                    ProjectTask.status == ProjectTaskStatus.READY.value,
                )
                .limit(1)
            )
            result = await db.execute(stmt)
            return result.scalar_one_or_none() is not None

    async def explore_next(self) -> ExplorationOutcome | None:
        task = await self._claim_next_task()
        if not task:
            return None

        result, error_message = await self._run_exploration(task)
        await self._persist_result(task.id, result, error_message)

        if result and result.follow_up_questions:
            await self._spawn_follow_ups(task, result.follow_up_questions)

        return ExplorationOutcome(task_id=task.id, result=result, error_message=error_message)

    async def _claim_next_task(self) -> ProjectTask | None:
        async with self.session_factory() as db:
            stmt = (
                select(ProjectTask)
                .where(
                    ProjectTask.task_type == "curiosity",
                    ProjectTask.status == ProjectTaskStatus.READY.value,
                )
                .order_by(
                    ProjectTask.priority.desc(),
                    ProjectTask.created_at.asc(),
                )
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            result = await db.execute(stmt)
            task = result.scalar_one_or_none()
            if not task:
                return None

            now = datetime.now(UTC)
            task.status = ProjectTaskStatus.IN_PROGRESS.value
            task.started_at = now
            task.updated_at = now
            task.attempt_count += 1
            await db.commit()
            await db.refresh(task)
            return task

    async def _run_exploration(
        self,
        task: ProjectTask,
    ) -> tuple[ExplorationResult | None, str | None]:
        prompt = self._build_prompt(task)
        now = datetime.now(UTC)
        mission_name = f"ambient-exploration-{task.id}-{now.isoformat()}"

        async with self.session_factory() as db:
            mission = Mission(
                name=mission_name,
                description=f"Ambient exploration: {task.title}",
                prompt=prompt,
                cron_expression="0 0 * * *",
                run_once=True,
                status=MissionStatus.PAUSED.value,
                next_execution_at=None,
                personality=self.config.personality,
                model="claude-haiku-4-5",
                working_dir=task.working_dir,
                sandbox_mode=True,
                sandbox_mount_type="none",
                allowed_tools=EXPLORATION_ALLOWED_TOOLS,
                user_id=self.config.user_id,
            )
            db.add(mission)
            await db.commit()
            await db.refresh(mission)

        execution = await self.mission_executor.execute(
            mission,
            trigger_type=MissionTriggerType.MANUAL.value,
            triggered_by="ambient_exploration",
        )

        async with self.session_factory() as db:
            db_mission = await db.get(Mission, mission.id)
            if db_mission:
                db_mission.status = MissionStatus.ARCHIVED.value
                db_mission.updated_at = datetime.now(UTC)
                await db.commit()

        if not execution or not execution.output_text:
            return None, "no exploration output"

        parsed = self._parse_exploration_output(execution.output_text)
        if not parsed:
            return None, "failed to parse exploration output"

        return self._build_result(parsed), None

    def _build_prompt(self, task: ProjectTask) -> str:
        extra = task.extra or {}
        source_context = extra.get("source_context") or task.context_summary or task.description
        source_context = source_context or "(no context captured)"
        return EXPLORATION_PROMPT.format(topic=task.title, source_context=source_context)

    def _parse_exploration_output(self, text: str) -> dict[str, Any] | None:
        code_block = re.search(r"```json\s*(\{.*?\})\s*```", text, re.S)
        if code_block:
            try:
                return json.loads(code_block.group(1))
            except Exception:
                return None

        decoder = json.JSONDecoder()
        for match in re.finditer(r"\{", text):
            try:
                obj, _ = decoder.raw_decode(text[match.start():])
                if isinstance(obj, dict):
                    return obj
            except Exception:
                continue
        return None

    def _build_result(self, payload: dict[str, Any]) -> ExplorationResult:
        raw_findings = payload.get("findings") or []
        findings = [str(item).strip() for item in raw_findings if str(item).strip()]
        raw_questions = payload.get("follow_up_questions") or []
        follow_ups = [str(item).strip() for item in raw_questions if str(item).strip()]

        try:
            confidence = float(payload.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0

        return ExplorationResult(
            findings=findings,
            confidence=confidence,
            follow_up_questions=follow_ups,
            worth_sharing=bool(payload.get("worth_sharing")),
            share_message=(payload.get("share_message") or None),
        )

    async def _persist_result(
        self,
        task_id: int,
        result: ExplorationResult | None,
        error_message: str | None,
    ) -> None:
        async with self.session_factory() as db:
            task = await db.get(ProjectTask, task_id)
            if not task:
                return

            now = datetime.now(UTC)
            extra = dict(task.extra or {})

            if result:
                extra["findings"] = self._merge_findings(
                    extra.get("findings"),
                    result.findings,
                )
                extra["exploration_count"] = int(extra.get("exploration_count") or 0) + 1
                extra["last_explored_at"] = now.isoformat()
                try:
                    existing_satisfaction = float(extra.get("satisfaction_level") or 0.0)
                except (TypeError, ValueError):
                    existing_satisfaction = 0.0
                extra["satisfaction_level"] = max(existing_satisfaction, result.confidence)
                extra["last_exploration_result"] = {
                    "findings": result.findings,
                    "confidence": result.confidence,
                    "follow_up_questions": result.follow_up_questions,
                    "worth_sharing": result.worth_sharing,
                    "share_message": result.share_message,
                }

                task.status = ProjectTaskStatus.DONE.value
                task.completed_at = now
                task.outcome = "explored"
                task.last_error = None
            else:
                task.status = ProjectTaskStatus.READY.value
                task.last_error = error_message or "exploration failed"

            task.extra = extra
            task.updated_at = now

            if result and result.findings:
                await self._store_findings(
                    db,
                    task=task,
                    findings=result.findings,
                    confidence=result.confidence,
                    worth_sharing=result.worth_sharing,
                    share_message=result.share_message,
                )
            await db.commit()

    def _merge_findings(
        self,
        existing: list[str] | None,
        new: list[str],
    ) -> list[str]:
        merged = []
        seen = set()
        for item in (existing or []) + new:
            normalized = str(item).strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(normalized)
        return merged

    async def _spawn_follow_ups(
        self,
        task: ProjectTask,
        questions: list[str],
    ) -> None:
        follow_ups = [q for q in questions if q][:5]
        if not follow_ups:
            return

        for question in follow_ups:
            extra = {
                "curiosity_type": "research_chain",
                "source_context": task.title,
                "trigger_reason": "follow_up_from_exploration",
            }

            if self.work_queue:
                await self.work_queue.create_task(
                    working_dir=task.working_dir,
                    title=question,
                    description=f"Follow-up from exploration of '{task.title}'",
                    task_type="curiosity",
                    priority=1,
                    discovered_from_task_id=task.id,
                    discovery_reason="research_chain",
                    extra=extra,
                )
                continue

            async with self.session_factory() as db:
                existing = await db.execute(
                    select(ProjectTask.id)
                    .where(
                        ProjectTask.task_type == "curiosity",
                        ProjectTask.title == question,
                    )
                    .limit(1)
                )
                if existing.scalar_one_or_none():
                    continue

                now = datetime.now(UTC)
                new_task = ProjectTask(
                    working_dir=task.working_dir,
                    title=question,
                    description=f"Follow-up from exploration of '{task.title}'",
                    task_type="curiosity",
                    priority=1,
                    status=ProjectTaskStatus.READY.value,
                    discovered_from_task_id=task.id,
                    discovery_reason="research_chain",
                    extra=extra,
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_task)
                await db.commit()

        logger.info(
            "Spawned {} follow-up curiosity tasks from exploration {}",
            len(follow_ups),
            task.id,
        )

    async def _store_findings(
        self,
        db: AsyncSession,
        *,
        task: ProjectTask,
        findings: list[str],
        confidence: float,
        worth_sharing: bool,
        share_message: str | None,
    ) -> None:
        unique_findings = [f for f in dict.fromkeys(findings) if f]
        if not unique_findings:
            return

        existing_rows = await db.execute(
            select(ExplorationFinding.finding)
            .where(ExplorationFinding.task_id == task.id)
            .where(ExplorationFinding.finding.in_(unique_findings))
        )
        existing = {row[0] for row in existing_rows.all()}

        source_context = None
        if task.extra:
            source_context = task.extra.get("source_context")

        now = datetime.now(UTC)
        for finding in unique_findings:
            if finding in existing:
                continue
            db.add(
                ExplorationFinding(
                    task_id=task.id,
                    user_id=self.config.user_id,
                    finding=finding,
                    source_context=source_context,
                    confidence=confidence,
                    worth_sharing=worth_sharing,
                    share_message=share_message,
                    created_at=now,
                    updated_at=now,
                )
            )

        if self.dere_graph and confidence >= 0.7:
            try:
                promoted = await self._promote_findings(
                    task=task,
                    findings=unique_findings,
                    confidence=confidence,
                )
                if promoted:
                    extra = dict(task.extra or {})
                    existing_promoted = set(extra.get("promoted_fact_ids") or [])
                    existing_promoted.update(promoted)
                    extra["promoted_fact_ids"] = list(existing_promoted)
                    task.extra = extra
            except Exception as e:
                logger.warning("Finding promotion failed: {}", e)

    async def _promote_findings(
        self,
        *,
        task: ProjectTask,
        findings: list[str],
        confidence: float,
    ) -> list[str]:
        if not self.dere_graph:
            return []

        promoted: list[str] = []
        group_id = self.config.user_id or "default"
        now = datetime.now(UTC)

        for finding in findings:
            fact_node, created = await self.dere_graph.add_fact(
                finding,
                group_id=group_id,
                source=f"curiosity:{task.id}",
                attributes={
                    "fact_type": "exploration_finding",
                    "confidence": confidence,
                },
                valid_at=now,
            )
            promoted.append(fact_node.uuid)

        return promoted
def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z']+", text.lower())
