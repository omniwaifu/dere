"""Work queue coordinator for managing project tasks."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.models import ProjectTask, ProjectTaskStatus

if TYPE_CHECKING:
    from collections.abc import Callable


@dataclass
class WorkQueueCoordinator:
    """Coordinates project task operations with atomic claiming and dependency tracking."""

    session_factory: Callable[[], AsyncSession]

    async def create_task(
        self,
        working_dir: str,
        title: str,
        description: str | None = None,
        acceptance_criteria: str | None = None,
        context_summary: str | None = None,
        scope_paths: list[str] | None = None,
        required_tools: list[str] | None = None,
        task_type: str | None = None,
        tags: list[str] | None = None,
        estimated_effort: str | None = None,
        priority: int = 0,
        blocked_by: list[int] | None = None,
        related_task_ids: list[int] | None = None,
        created_by_session_id: int | None = None,
        created_by_agent_id: int | None = None,
        discovered_from_task_id: int | None = None,
        discovery_reason: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> ProjectTask:
        """Create a new task.

        Automatically sets status based on dependencies:
        - 'ready' if no blockers or all blockers are done
        - 'blocked' if has pending blockers
        """
        async with self.session_factory() as db:
            # Determine initial status based on dependencies
            status = ProjectTaskStatus.BACKLOG.value
            if blocked_by:
                # Check if any blockers are not done
                result = await db.execute(
                    select(ProjectTask.id).where(
                        ProjectTask.id.in_(blocked_by),
                        ProjectTask.status != ProjectTaskStatus.DONE.value,
                    )
                )
                pending_blockers = result.scalars().all()
                if pending_blockers:
                    status = ProjectTaskStatus.BLOCKED.value
                else:
                    status = ProjectTaskStatus.READY.value
            else:
                # No blockers, ready by default (could also be backlog for manual triage)
                status = ProjectTaskStatus.READY.value

            now = datetime.now(UTC)
            task = ProjectTask(
                working_dir=working_dir,
                title=title,
                description=description,
                acceptance_criteria=acceptance_criteria,
                context_summary=context_summary,
                scope_paths=scope_paths,
                required_tools=required_tools,
                task_type=task_type,
                tags=tags,
                estimated_effort=estimated_effort,
                priority=priority,
                status=status,
                blocked_by=blocked_by,
                related_task_ids=related_task_ids,
                created_by_session_id=created_by_session_id,
                created_by_agent_id=created_by_agent_id,
                discovered_from_task_id=discovered_from_task_id,
                discovery_reason=discovery_reason,
                extra=extra,
                created_at=now,
                updated_at=now,
            )
            db.add(task)
            await db.commit()
            await db.refresh(task)

            logger.info(
                "Created task '{}' (id={}) in {} with status={}",
                title,
                task.id,
                working_dir,
                status,
            )
            return task

    async def claim_task(
        self,
        task_id: int,
        session_id: int | None = None,
        agent_id: int | None = None,
    ) -> ProjectTask:
        """Atomically claim a task.

        Uses SELECT FOR UPDATE SKIP LOCKED to handle race conditions.
        Only one of session_id or agent_id should be provided.

        Raises:
            ValueError: If task not ready or already claimed
        """
        async with self.session_factory() as db:
            # Use FOR UPDATE SKIP LOCKED to handle concurrent claims
            stmt = (
                select(ProjectTask)
                .where(
                    ProjectTask.id == task_id,
                    ProjectTask.status == ProjectTaskStatus.READY.value,
                    ProjectTask.claimed_by_session_id.is_(None),
                    ProjectTask.claimed_by_agent_id.is_(None),
                )
                .with_for_update(skip_locked=True)
            )
            result = await db.execute(stmt)
            task = result.scalar_one_or_none()

            if not task:
                # Check if task exists but is not claimable
                existing = await db.get(ProjectTask, task_id)
                if not existing:
                    raise ValueError(f"Task {task_id} not found")
                elif existing.status != ProjectTaskStatus.READY.value:
                    raise ValueError(
                        f"Task {task_id} is not ready (status: {existing.status})"
                    )
                else:
                    raise ValueError(f"Task {task_id} was claimed by another agent")

            now = datetime.now(UTC)
            task.status = ProjectTaskStatus.CLAIMED.value
            task.claimed_by_session_id = session_id
            task.claimed_by_agent_id = agent_id
            task.claimed_at = now
            task.updated_at = now
            task.attempt_count += 1

            await db.commit()
            await db.refresh(task)

            logger.info(
                "Task {} claimed by session={} agent={}",
                task_id,
                session_id,
                agent_id,
            )
            return task

    async def release_task(
        self,
        task_id: int,
        reason: str | None = None,
    ) -> ProjectTask:
        """Release a claimed task back to ready status."""
        async with self.session_factory() as db:
            task = await db.get(ProjectTask, task_id)
            if not task:
                raise ValueError(f"Task {task_id} not found")

            if task.status not in (
                ProjectTaskStatus.CLAIMED.value,
                ProjectTaskStatus.IN_PROGRESS.value,
            ):
                raise ValueError(
                    f"Task {task_id} cannot be released (status: {task.status})"
                )

            now = datetime.now(UTC)
            task.status = ProjectTaskStatus.READY.value
            task.claimed_by_session_id = None
            task.claimed_by_agent_id = None
            task.claimed_at = None
            task.updated_at = now
            if reason:
                task.last_error = reason

            await db.commit()
            await db.refresh(task)

            logger.info("Task {} released: {}", task_id, reason or "no reason given")
            return task

    async def update_task(
        self,
        task_id: int,
        status: str | None = None,
        title: str | None = None,
        description: str | None = None,
        priority: int | None = None,
        tags: list[str] | None = None,
        outcome: str | None = None,
        completion_notes: str | None = None,
        files_changed: list[str] | None = None,
        last_error: str | None = None,
    ) -> ProjectTask:
        """Update task details or status.

        If status is changed to 'done', triggers dependency resolution
        for tasks blocked by this one.
        """
        async with self.session_factory() as db:
            task = await db.get(ProjectTask, task_id)
            if not task:
                raise ValueError(f"Task {task_id} not found")

            now = datetime.now(UTC)

            # Update fields if provided
            if title is not None:
                task.title = title
            if description is not None:
                task.description = description
            if priority is not None:
                task.priority = priority
            if tags is not None:
                task.tags = tags
            if outcome is not None:
                task.outcome = outcome
            if completion_notes is not None:
                task.completion_notes = completion_notes
            if files_changed is not None:
                task.files_changed = files_changed
            if last_error is not None:
                task.last_error = last_error

            # Handle status transitions
            old_status = task.status
            if status is not None and status != old_status:
                task.status = status

                # Track when work starts
                if status == ProjectTaskStatus.IN_PROGRESS.value:
                    task.started_at = now

                # Track completion
                if status == ProjectTaskStatus.DONE.value:
                    task.completed_at = now

            task.updated_at = now
            await db.commit()
            await db.refresh(task)

            # If task completed, refresh blocked tasks
            if status == ProjectTaskStatus.DONE.value:
                unblocked = await self._refresh_blocked_tasks(db, task_id)
                if unblocked:
                    logger.info(
                        "Task {} completion unblocked {} tasks",
                        task_id,
                        len(unblocked),
                    )

            logger.info(
                "Task {} updated: status {} -> {}",
                task_id,
                old_status,
                task.status,
            )
            return task

    async def get_task(self, task_id: int) -> ProjectTask | None:
        """Get a task by ID."""
        async with self.session_factory() as db:
            return await db.get(ProjectTask, task_id)

    async def list_tasks(
        self,
        working_dir: str | None = None,
        status: str | None = None,
        tags: list[str] | None = None,
        task_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ProjectTask], int]:
        """List tasks with optional filtering.

        Returns:
            Tuple of (tasks, total_count)
        """
        async with self.session_factory() as db:
            # Build query
            query = select(ProjectTask)
            count_query = select(ProjectTask.id)

            if working_dir:
                query = query.where(ProjectTask.working_dir == working_dir)
                count_query = count_query.where(ProjectTask.working_dir == working_dir)
            if status:
                query = query.where(ProjectTask.status == status)
                count_query = count_query.where(ProjectTask.status == status)
            if task_type:
                query = query.where(ProjectTask.task_type == task_type)
                count_query = count_query.where(ProjectTask.task_type == task_type)
            if tags:
                # Match any of the provided tags
                query = query.where(ProjectTask.tags.overlap(tags))
                count_query = count_query.where(ProjectTask.tags.overlap(tags))

            # Get total count
            count_result = await db.execute(count_query)
            total = len(count_result.all())

            # Get paginated results
            query = (
                query.order_by(
                    ProjectTask.priority.desc(),
                    ProjectTask.created_at.desc(),
                )
                .offset(offset)
                .limit(limit)
            )
            result = await db.execute(query)
            tasks = list(result.scalars().all())

            return tasks, total

    async def get_ready_tasks(
        self,
        working_dir: str,
        limit: int = 10,
        task_type: str | None = None,
        required_tools: list[str] | None = None,
    ) -> list[ProjectTask]:
        """Find tasks ready for work (unblocked, unclaimed).

        Args:
            working_dir: Project directory
            limit: Maximum tasks to return
            task_type: Optional filter by task type
            required_tools: Optional filter - only tasks requiring these tools

        Returns:
            List of ready tasks, sorted by priority (descending)
        """
        async with self.session_factory() as db:
            query = (
                select(ProjectTask)
                .where(
                    ProjectTask.working_dir == working_dir,
                    ProjectTask.status == ProjectTaskStatus.READY.value,
                    ProjectTask.claimed_by_session_id.is_(None),
                    ProjectTask.claimed_by_agent_id.is_(None),
                )
                .order_by(
                    ProjectTask.priority.desc(),
                    ProjectTask.created_at.asc(),
                )
                .limit(limit)
            )

            if task_type:
                query = query.where(ProjectTask.task_type == task_type)

            if required_tools:
                # Only return tasks that require a subset of the provided tools
                query = query.where(
                    ProjectTask.required_tools.contained_by(required_tools)
                )

            result = await db.execute(query)
            return list(result.scalars().all())

    async def _refresh_blocked_tasks(
        self,
        db: AsyncSession,
        completed_task_id: int,
    ) -> list[ProjectTask]:
        """When a task completes, check if any blocked tasks become ready.

        For each task with completed_task_id in blocked_by:
        - Remove completed_task_id from blocked_by
        - If blocked_by is now empty and status is 'blocked', set to 'ready'
        """
        # Find tasks blocked by this one
        result = await db.execute(
            select(ProjectTask).where(
                ProjectTask.blocked_by.contains([completed_task_id]),
                ProjectTask.status == ProjectTaskStatus.BLOCKED.value,
            )
        )
        blocked_tasks = list(result.scalars().all())

        unblocked = []
        now = datetime.now(UTC)

        for task in blocked_tasks:
            # Remove completed task from blocked_by
            new_blocked_by = [
                bid for bid in (task.blocked_by or []) if bid != completed_task_id
            ]

            # Check if any remaining blockers are not done
            if new_blocked_by:
                remaining_result = await db.execute(
                    select(ProjectTask.id).where(
                        ProjectTask.id.in_(new_blocked_by),
                        ProjectTask.status != ProjectTaskStatus.DONE.value,
                    )
                )
                still_blocked = remaining_result.scalars().all()
            else:
                still_blocked = []

            task.blocked_by = new_blocked_by if new_blocked_by else None
            task.updated_at = now

            if not still_blocked:
                task.status = ProjectTaskStatus.READY.value
                unblocked.append(task)

        await db.commit()
        return unblocked

    async def add_follow_up_task(
        self,
        parent_task_id: int,
        child_task_id: int,
    ) -> None:
        """Link a follow-up task to its parent."""
        async with self.session_factory() as db:
            task = await db.get(ProjectTask, parent_task_id)
            if not task:
                raise ValueError(f"Task {parent_task_id} not found")

            follow_ups = list(task.follow_up_task_ids or [])
            if child_task_id not in follow_ups:
                follow_ups.append(child_task_id)
                task.follow_up_task_ids = follow_ups
                task.updated_at = datetime.now(UTC)
                await db.commit()

    async def delete_task(self, task_id: int) -> bool:
        """Delete a task. Returns True if deleted, False if not found."""
        async with self.session_factory() as db:
            task = await db.get(ProjectTask, task_id)
            if not task:
                return False

            await db.delete(task)
            await db.commit()
            logger.info("Task {} deleted", task_id)
            return True
