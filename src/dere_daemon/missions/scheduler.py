"""Mission scheduler - background task that executes due missions."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from croniter import croniter
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.models import Mission, MissionStatus

if TYPE_CHECKING:
    from collections.abc import Callable

    from dere_daemon.missions.executor import MissionExecutor

# Check for due missions every 60 seconds
SCHEDULER_INTERVAL = 60


class MissionScheduler:
    """Background scheduler that executes due missions."""

    def __init__(
        self,
        session_factory: Callable[[], AsyncSession],
        executor: MissionExecutor,
    ):
        self.session_factory = session_factory
        self.executor = executor
        self._task: asyncio.Task[None] | None = None
        self._running = False

    def start(self) -> None:
        """Start the scheduler background task."""
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._scheduler_loop())
            logger.info("Mission scheduler started (interval={}s)", SCHEDULER_INTERVAL)

    async def stop(self) -> None:
        """Stop the scheduler background task."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            logger.info("Mission scheduler stopped")

    async def _scheduler_loop(self) -> None:
        """Main scheduler loop - checks for due missions."""
        while self._running:
            try:
                await asyncio.sleep(SCHEDULER_INTERVAL)
                if not self._running:
                    break
                await self._check_and_execute_due_missions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Error in mission scheduler loop: {}", e)

    async def _check_and_execute_due_missions(self) -> None:
        """Find and execute missions that are due."""
        now = datetime.now(UTC)

        async with self.session_factory() as db:
            # Find active missions that are due
            stmt = select(Mission).where(
                Mission.status == MissionStatus.ACTIVE.value,
                Mission.next_execution_at <= now,
            )
            result = await db.execute(stmt)
            due_missions = list(result.scalars().all())

        if not due_missions:
            return

        logger.info("Found {} due mission(s)", len(due_missions))

        # Execute each mission serially to avoid resource contention
        for mission in due_missions:
            try:
                logger.info("Executing mission {}: {}", mission.id, mission.name)
                await self.executor.execute(mission)

                # Update next execution time
                await self._update_next_execution(mission)

            except Exception as e:
                logger.exception("Failed to execute mission {}: {}", mission.id, e)
                # Continue with next mission even if one fails

    async def _update_next_execution(self, mission: Mission) -> None:
        """Calculate and update next execution time using croniter."""
        try:
            now = datetime.now(UTC)
            cron = croniter(mission.cron_expression, now)
            next_run = cron.get_next(datetime)

            async with self.session_factory() as db:
                db_mission = await db.get(Mission, mission.id)
                if db_mission:
                    db_mission.last_execution_at = now
                    db_mission.next_execution_at = next_run
                    db_mission.updated_at = now
                    await db.commit()

            logger.debug(
                "Mission {} next execution: {}",
                mission.name,
                next_run.isoformat(),
            )

        except Exception as e:
            logger.error(
                "Failed to update next execution for mission {}: {}",
                mission.id,
                e,
            )
