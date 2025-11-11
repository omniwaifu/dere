from __future__ import annotations

import asyncio
import time

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dere_shared.models import (
    TaskQueue,
    TaskStatus,
)


def format_relative_time(timestamp: int) -> str:
    """Format timestamp as relative time string

    Args:
        timestamp: Unix timestamp in seconds

    Returns:
        Human-readable relative time (e.g., "2h ago", "3 days ago")
    """
    age_seconds = int(time.time()) - timestamp

    if age_seconds < 3600:  # Less than 1 hour
        minutes = age_seconds // 60
        return f"{minutes}m ago" if minutes > 0 else "just now"
    elif age_seconds < 86400:  # Less than 1 day
        hours = age_seconds // 3600
        return f"{hours}h ago"
    elif age_seconds < 604800:  # Less than 1 week
        days = age_seconds // 86400
        return f"{days}d ago"
    else:  # 1 week or more
        weeks = age_seconds // 604800
        return f"{weeks}w ago"


class TaskProcessor:
    """Background task processor for summarization and memory consolidation"""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self.session_factory = session_factory
        self.max_retries = 3
        self.current_model: str | None = None
        self._running = False
        self._task: asyncio.Task | None = None
        self._trigger_event = asyncio.Event()

    async def start(self) -> None:
        """Start background processing loop"""
        self._running = True
        self._task = asyncio.create_task(self._process_loop())
        logger.info("Task processor started")

    async def shutdown(self) -> None:
        """Stop background processing"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Task processor stopped")

    def trigger(self) -> None:
        """Trigger immediate task processing"""
        self._trigger_event.set()

    async def _process_loop(self) -> None:
        """Main processing loop"""
        while self._running:
            try:
                await self.process_tasks()
            except Exception as e:
                logger.error("Error in task processing loop: {}", e)

            # Wait for trigger or timeout
            try:
                await asyncio.wait_for(self._trigger_event.wait(), timeout=5.0)
                self._trigger_event.clear()
            except TimeoutError:
                pass

    async def process_tasks(self) -> None:
        """Process pending tasks grouped by model"""
        async with self.session_factory() as session:
            # Get pending tasks grouped by model
            stmt = (
                select(TaskQueue)
                .where(TaskQueue.status == TaskStatus.PENDING)
                .order_by(TaskQueue.priority.desc(), TaskQueue.created_at.asc())
            )
            result = await session.execute(stmt)
            all_tasks = result.scalars().all()

            if not all_tasks:
                return

            # Group tasks by model
            tasks_by_model: dict[str, list[TaskQueue]] = {}
            for task in all_tasks:
                model = task.model_name or "default"
                if model not in tasks_by_model:
                    tasks_by_model[model] = []
                tasks_by_model[model].append(task)

        if not tasks_by_model:
            return

        logger.debug("Found tasks: {}", {k: len(v) for k, v in tasks_by_model.items()})

        for model_name, tasks in tasks_by_model.items():
            if not tasks:
                continue

            logger.info("Processing {} tasks for model {}", len(tasks), model_name)

            # Switch model if needed
            if self.current_model != model_name:
                logger.info("Switching to model: {}", model_name)
                self.current_model = model_name
                await asyncio.sleep(0.5)

            # Process all tasks for this model
            for task in tasks:
                await self._process_task(task)

    async def _process_task(self, task: TaskQueue) -> None:
        """Process a single task"""
        # Mark as processing
        async with self.session_factory() as session:
            stmt = (
                update(TaskQueue)
                .where(TaskQueue.id == task.id)
                .values(status=TaskStatus.PROCESSING)
            )
            await session.execute(stmt)
            await session.commit()

        logger.info("Task {} starting: {}", task.id, task.task_type)

        # All task types are no longer supported (replaced by dere_graph)
        error_message = (
            f"Task type '{task.task_type}' is no longer supported (replaced by dere_graph)"
        )
        logger.error("Task {} unsupported: {}", task.id, error_message)

        async with self.session_factory() as session:
            stmt = (
                update(TaskQueue)
                .where(TaskQueue.id == task.id)
                .values(
                    status=TaskStatus.FAILED,
                    error_message=error_message,
                )
            )
            await session.execute(stmt)
            await session.commit()

    async def _handle_task_error(self, task: TaskQueue, error: str) -> None:
        """Handle task error with retry logic"""
        retry_count = task.retry_count or 0

        if retry_count < self.max_retries:
            logger.info("Task {} retry {}/{}", task.id, retry_count + 1, self.max_retries)
            async with self.session_factory() as session:
                stmt = (
                    update(TaskQueue)
                    .where(TaskQueue.id == task.id)
                    .values(
                        retry_count=retry_count + 1,
                        status=TaskStatus.PENDING,
                    )
                )
                await session.execute(stmt)
                await session.commit()
        else:
            logger.error("✗ Task {} failed after {} retries: {}", task.id, self.max_retries, error)
            async with self.session_factory() as session:
                stmt = (
                    update(TaskQueue)
                    .where(TaskQueue.id == task.id)
                    .values(
                        status=TaskStatus.FAILED,
                        error_message=error,
                    )
                )
                await session.execute(stmt)
                await session.commit()
