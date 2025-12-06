"""Mission executor - runs missions using the agent service."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.agent_models import SessionConfig, StreamEventType
from dere_shared.models import (
    Mission,
    MissionExecution,
    MissionExecutionStatus,
    MissionTriggerType,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from dere_daemon.agent.service import CentralizedAgentService

# Maximum output size to store (50KB)
MAX_OUTPUT_SIZE = 50 * 1024

# Threshold for generating summary (1000 chars)
SUMMARY_THRESHOLD = 1000


class MissionExecutor:
    """Executes missions using the agent service."""

    def __init__(
        self,
        agent_service: CentralizedAgentService,
        session_factory: Callable[[], AsyncSession],
    ):
        self.agent_service = agent_service
        self.session_factory = session_factory

    async def execute(
        self,
        mission: Mission,
        trigger_type: str = MissionTriggerType.SCHEDULED.value,
        triggered_by: str | None = None,
    ) -> MissionExecution:
        """Execute a mission and return the execution record.

        Args:
            mission: The mission to execute
            trigger_type: How the mission was triggered (scheduled/manual)
            triggered_by: User ID if manually triggered

        Returns:
            The MissionExecution record with results
        """
        logger.info(
            "Executing mission {} (id={}), trigger={}",
            mission.name,
            mission.id,
            trigger_type,
        )

        # Create execution record
        async with self.session_factory() as db:
            execution = MissionExecution(
                mission_id=mission.id,
                trigger_type=trigger_type,
                triggered_by=triggered_by,
                status=MissionExecutionStatus.RUNNING.value,
                started_at=datetime.now(UTC),
            )
            db.add(execution)
            await db.commit()
            await db.refresh(execution)
            execution_id = execution.id

        try:
            # Build session config from mission
            config = SessionConfig(
                working_dir=mission.working_dir,
                output_style="default",
                personality=mission.personality or "",
                user_id=mission.user_id,
                allowed_tools=mission.allowed_tools,
                thinking_budget=mission.thinking_budget,
                sandbox_mode=mission.sandbox_mode,
                sandbox_mount_type=mission.sandbox_mount_type,
                model=mission.model,
                include_context=False,  # Missions don't need emotion/KG context
            )

            # Create agent session
            session = await self.agent_service.create_session(config)

            try:
                # Execute query and collect output
                output_chunks: list[str] = []
                tool_count = 0
                error_message: str | None = None

                async for event in self.agent_service.query(session, mission.prompt):
                    if event.type == StreamEventType.TEXT:
                        text = event.data.get("text", "")
                        if text:
                            output_chunks.append(text)

                    elif event.type == StreamEventType.TOOL_USE:
                        tool_count += 1

                    elif event.type == StreamEventType.DONE:
                        # Final event includes total tool count
                        tool_count = event.data.get("tool_count", tool_count)

                    elif event.type == StreamEventType.ERROR:
                        error_message = event.data.get("message", "Unknown error")
                        if not event.data.get("recoverable", True):
                            break

                output_text = "".join(output_chunks)

                # Truncate if too long
                if len(output_text) > MAX_OUTPUT_SIZE:
                    output_text = output_text[:MAX_OUTPUT_SIZE] + "\n\n[Output truncated]"

                # Generate summary if output is long
                output_summary = None
                if len(output_text) > SUMMARY_THRESHOLD:
                    output_summary = await self._generate_summary(output_text)

                # Determine final status
                if error_message:
                    status = MissionExecutionStatus.FAILED.value
                else:
                    status = MissionExecutionStatus.COMPLETED.value

                # Update execution record
                async with self.session_factory() as db:
                    exec_record = await db.get(MissionExecution, execution_id)
                    if exec_record:
                        exec_record.status = status
                        exec_record.completed_at = datetime.now(UTC)
                        exec_record.output_text = output_text
                        exec_record.output_summary = output_summary
                        exec_record.tool_count = tool_count
                        exec_record.error_message = error_message
                        await db.commit()
                        await db.refresh(exec_record)
                        execution = exec_record

                logger.info(
                    "Mission {} execution completed: status={}, tools={}, output_len={}",
                    mission.name,
                    status,
                    tool_count,
                    len(output_text),
                )

            finally:
                # Always close the session
                await self.agent_service.close_session(session.session_id)

            return execution

        except Exception as e:
            logger.exception("Mission {} execution failed", mission.name)

            # Update execution record with error
            async with self.session_factory() as db:
                exec_record = await db.get(MissionExecution, execution_id)
                if exec_record:
                    exec_record.status = MissionExecutionStatus.FAILED.value
                    exec_record.completed_at = datetime.now(UTC)
                    exec_record.error_message = str(e)
                    await db.commit()
                    await db.refresh(exec_record)
                    return exec_record

            raise

    async def _generate_summary(self, output_text: str) -> str | None:
        """Generate a summary for long output using Haiku.

        Args:
            output_text: The full output text

        Returns:
            A short summary, or None if generation fails
        """
        try:
            from dere_graph.llm_client import ClaudeClient, Message

            client = ClaudeClient(model="claude-haiku-4-5")

            # Take first and last portions for context
            max_context = 2000
            if len(output_text) > max_context * 2:
                context = output_text[:max_context] + "\n\n[...]\n\n" + output_text[-max_context:]
            else:
                context = output_text

            prompt = f"""Summarize this mission output in 1-2 sentences. Focus on the main result or outcome.

Output:
{context}

Summary:"""

            summary = await client.generate_text_response([Message(role="user", content=prompt)])
            return summary.strip()

        except Exception as e:
            logger.warning("Failed to generate summary: {}", e)
            return None
