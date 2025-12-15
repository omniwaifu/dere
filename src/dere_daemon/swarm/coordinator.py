"""Swarm coordinator - manages spawning and coordination of agent swarms."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from dere_shared.agent_models import SessionConfig, StreamEventType
from dere_shared.models import Session, Swarm, SwarmAgent, SwarmStatus

from .git import (
    create_branch,
    get_current_branch,
    merge_branch,
)
from .models import AgentResult, AgentSpec, MergeResult, SwarmStatusResponse

if TYPE_CHECKING:
    from collections.abc import Callable

    from dere_daemon.agent.service import CentralizedAgentService

# Maximum output size to store per agent (50KB)
MAX_OUTPUT_SIZE = 50 * 1024

# Threshold for generating summary (1000 chars)
SUMMARY_THRESHOLD = 1000


@dataclass
class SwarmCoordinator:
    """Coordinates spawning and management of agent swarms."""

    agent_service: CentralizedAgentService
    session_factory: Callable[[], AsyncSession]

    # Track running agent tasks
    _running_tasks: dict[int, asyncio.Task] = field(default_factory=dict)
    _completion_events: dict[int, asyncio.Event] = field(default_factory=dict)

    async def create_swarm(
        self,
        parent_session_id: int | None,
        name: str,
        working_dir: str,
        agents: list[AgentSpec],
        description: str | None = None,
        git_branch_prefix: str | None = None,
        base_branch: str | None = None,
    ) -> Swarm:
        """Create a new swarm with specified agents.

        Args:
            parent_session_id: Session ID that's spawning this swarm (optional)
            name: Name for the swarm
            working_dir: Working directory for agents
            agents: List of agent specifications
            description: Optional description
            git_branch_prefix: If set, create branches for each agent
            base_branch: Base branch to create from (default: current branch)

        Returns:
            Created Swarm instance
        """
        # Resolve base branch if using git
        if git_branch_prefix and not base_branch:
            try:
                base_branch = await get_current_branch(working_dir)
            except Exception as e:
                logger.warning("Failed to get current branch: {}", e)

        async with self.session_factory() as db:
            # Verify parent session exists if provided
            verified_parent_id = None
            if parent_session_id:
                result = await db.execute(
                    select(Session.id).where(Session.id == parent_session_id)
                )
                if result.scalar_one_or_none():
                    verified_parent_id = parent_session_id
                else:
                    logger.info(
                        "Parent session {} not found in DB, creating swarm without parent",
                        parent_session_id,
                    )

            # Create swarm
            swarm = Swarm(
                name=name,
                description=description,
                parent_session_id=verified_parent_id,
                working_dir=working_dir,
                git_branch_prefix=git_branch_prefix,
                base_branch=base_branch,
                status=SwarmStatus.PENDING.value,
            )
            db.add(swarm)
            await db.flush()

            name_to_db_agent: dict[str, SwarmAgent] = {}

            # Create agents (first pass - without dependencies)
            for spec in agents:
                # Generate branch name if using git branches
                git_branch = None
                if git_branch_prefix:
                    git_branch = f"{git_branch_prefix}{spec.name}"

                agent = SwarmAgent(
                    swarm_id=swarm.id,
                    name=spec.name,
                    role=spec.role.value,
                    prompt=spec.prompt,
                    personality=spec.personality,
                    plugins=spec.plugins,
                    git_branch=git_branch,
                    allowed_tools=spec.allowed_tools,
                    thinking_budget=spec.thinking_budget,
                    model=spec.model,
                    sandbox_mode=spec.sandbox_mode,
                    status=SwarmStatus.PENDING.value,
                )
                db.add(agent)
                await db.flush()
                name_to_db_agent[spec.name] = agent

            # Second pass - resolve dependencies
            for spec in agents:
                if spec.depends_on:
                    agent = name_to_db_agent[spec.name]
                    dep_ids = []
                    for dep_name in spec.depends_on:
                        if dep_name not in name_to_db_agent:
                            raise ValueError(
                                f"Agent '{spec.name}' depends on unknown agent '{dep_name}'"
                            )
                        dep_ids.append(name_to_db_agent[dep_name].id)
                    agent.depends_on = dep_ids

            await db.commit()

            # Re-fetch with agents eagerly loaded (avoid DetachedInstanceError)
            result = await db.execute(
                select(Swarm)
                .options(selectinload(Swarm.agents))
                .where(Swarm.id == swarm.id)
            )
            swarm = result.scalar_one()

            logger.info(
                "Created swarm '{}' (id={}) with {} agents",
                name,
                swarm.id,
                len(agents),
            )

            return swarm

    async def start_swarm(self, swarm_id: int) -> None:
        """Begin executing agents in dependency order.

        Agents without dependencies start immediately.
        Agents with dependencies wait for their dependencies to complete.
        """
        async with self.session_factory() as db:
            swarm = await db.get(
                Swarm, swarm_id, options=[selectinload(Swarm.agents)]
            )
            if not swarm:
                raise ValueError(f"Swarm {swarm_id} not found")

            if swarm.status != SwarmStatus.PENDING.value:
                raise ValueError(f"Swarm {swarm_id} is not in pending state")

            swarm.status = SwarmStatus.RUNNING.value
            swarm.started_at = datetime.now(UTC)
            await db.commit()

        # Create completion events for each agent
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            for agent in swarm.agents:
                self._completion_events[agent.id] = asyncio.Event()

        # Create branches if needed
        if swarm.git_branch_prefix:
            await self._create_agent_branches(swarm)

        # Start agent tasks
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            for agent in swarm.agents:
                task = asyncio.create_task(
                    self._execute_agent_with_dependencies(agent.id)
                )
                self._running_tasks[agent.id] = task

        logger.info("Started swarm {} with {} agents", swarm_id, len(swarm.agents))

    async def _create_agent_branches(self, swarm: Swarm) -> None:
        """Create git branches for all agents in the swarm."""
        for agent in swarm.agents:
            if agent.git_branch:
                try:
                    await create_branch(
                        swarm.working_dir,
                        agent.git_branch,
                        swarm.base_branch or "HEAD",
                    )
                except Exception as e:
                    logger.error(
                        "Failed to create branch '{}' for agent '{}': {}",
                        agent.git_branch,
                        agent.name,
                        e,
                    )
                    raise

    async def _execute_agent_with_dependencies(self, agent_id: int) -> None:
        """Execute an agent after waiting for its dependencies."""
        async with self.session_factory() as db:
            agent = await db.get(SwarmAgent, agent_id)
            if not agent:
                return

            # Wait for dependencies
            if agent.depends_on:
                for dep_id in agent.depends_on:
                    if dep_id in self._completion_events:
                        await self._completion_events[dep_id].wait()

        # Execute the agent
        await self._execute_agent(agent_id)

        # Signal completion
        if agent_id in self._completion_events:
            self._completion_events[agent_id].set()

    async def _execute_agent(self, agent_id: int) -> None:
        """Execute a single agent."""
        async with self.session_factory() as db:
            agent = await db.get(SwarmAgent, agent_id)
            swarm = await db.get(Swarm, agent.swarm_id)

            if not agent or not swarm:
                return

            agent.status = SwarmStatus.RUNNING.value
            agent.started_at = datetime.now(UTC)
            await db.commit()

        logger.info(
            "Executing agent '{}' (id={}) in swarm '{}'",
            agent.name,
            agent_id,
            swarm.name,
        )

        try:
            # Build session config
            # Determine if this is lean mode (no plugins specified)
            lean_mode = agent.plugins is None

            config = SessionConfig(
                working_dir=swarm.working_dir,
                output_style="default",
                personality=agent.personality or "",
                allowed_tools=agent.allowed_tools,
                thinking_budget=agent.thinking_budget,
                model=agent.model,
                sandbox_mode=agent.sandbox_mode,
                include_context=False,  # Swarm agents don't need emotion/KG
                auto_approve=True,  # Autonomous execution
                lean_mode=lean_mode,
                swarm_agent_id=agent_id,
                plugins=agent.plugins,
                session_name=f"swarm:{swarm.name}:{agent.name}",
            )

            # If agent has a git branch, include it in the prompt
            prompt = agent.prompt
            if agent.git_branch:
                prompt = f"You are working on branch '{agent.git_branch}'. Make sure to checkout this branch before making changes.\n\n{prompt}"

            # Create and run session
            session = await self.agent_service.create_session(config)

            try:
                output_chunks: list[str] = []
                tool_count = 0
                error_message: str | None = None

                async for event in self.agent_service.query(session, prompt):
                    if event.type == StreamEventType.TEXT:
                        text = event.data.get("text", "")
                        if text:
                            output_chunks.append(text)

                    elif event.type == StreamEventType.TOOL_USE:
                        tool_count += 1

                    elif event.type == StreamEventType.DONE:
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
                    status = SwarmStatus.FAILED.value
                else:
                    status = SwarmStatus.COMPLETED.value

                # Update agent record
                async with self.session_factory() as db:
                    agent_record = await db.get(SwarmAgent, agent_id)
                    if agent_record:
                        agent_record.status = status
                        agent_record.completed_at = datetime.now(UTC)
                        agent_record.output_text = output_text
                        agent_record.output_summary = output_summary
                        agent_record.tool_count = tool_count
                        agent_record.error_message = error_message
                        agent_record.session_id = session.session_id
                        await db.commit()

                logger.info(
                    "Agent '{}' completed: status={}, tools={}, output_len={}",
                    agent.name,
                    status,
                    tool_count,
                    len(output_text),
                )

            finally:
                await self.agent_service.close_session(session.session_id)

        except Exception as e:
            logger.exception("Agent '{}' execution failed", agent.name)

            async with self.session_factory() as db:
                agent_record = await db.get(SwarmAgent, agent_id)
                if agent_record:
                    agent_record.status = SwarmStatus.FAILED.value
                    agent_record.completed_at = datetime.now(UTC)
                    agent_record.error_message = str(e)
                    await db.commit()

        # Check if all agents are done and update swarm status
        await self._check_swarm_completion(swarm.id)

    async def _check_swarm_completion(self, swarm_id: int) -> None:
        """Check if all agents in swarm are done and update swarm status."""
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                return

            all_done = all(
                a.status in (SwarmStatus.COMPLETED.value, SwarmStatus.FAILED.value, SwarmStatus.CANCELLED.value)
                for a in swarm.agents
            )

            if all_done:
                any_failed = any(
                    a.status == SwarmStatus.FAILED.value for a in swarm.agents
                )
                swarm.status = SwarmStatus.FAILED.value if any_failed else SwarmStatus.COMPLETED.value
                swarm.completed_at = datetime.now(UTC)
                await db.commit()

                logger.info(
                    "Swarm '{}' completed with status={}",
                    swarm.name,
                    swarm.status,
                )

    async def get_swarm_status(self, swarm_id: int) -> SwarmStatusResponse:
        """Get current status of swarm and all agents."""
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                raise ValueError(f"Swarm {swarm_id} not found")

            agents = [
                AgentResult(
                    agent_id=a.id,
                    name=a.name,
                    role=a.role,
                    status=SwarmStatus(a.status),
                    output_text=a.output_text,
                    output_summary=a.output_summary,
                    error_message=a.error_message,
                    tool_count=a.tool_count,
                    started_at=a.started_at,
                    completed_at=a.completed_at,
                )
                for a in swarm.agents
            ]

            return SwarmStatusResponse(
                swarm_id=swarm.id,
                name=swarm.name,
                description=swarm.description,
                status=SwarmStatus(swarm.status),
                working_dir=swarm.working_dir,
                git_branch_prefix=swarm.git_branch_prefix,
                base_branch=swarm.base_branch,
                agents=agents,
                created_at=swarm.created_at,
                started_at=swarm.started_at,
                completed_at=swarm.completed_at,
            )

    async def wait_for_agents(
        self,
        swarm_id: int,
        agent_names: list[str] | None = None,
        timeout: float | None = None,
    ) -> list[AgentResult]:
        """Wait for specific agents or all agents to complete.

        Args:
            swarm_id: The swarm ID
            agent_names: Specific agent names to wait for (None = all)
            timeout: Maximum time to wait in seconds

        Returns:
            Results from completed agents
        """
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                raise ValueError(f"Swarm {swarm_id} not found")

            # Determine which agents to wait for
            agents_to_wait = swarm.agents
            if agent_names:
                agents_to_wait = [a for a in swarm.agents if a.name in agent_names]

            agent_ids = [a.id for a in agents_to_wait]

        # Wait for completion events
        events_to_wait = [
            self._completion_events[aid]
            for aid in agent_ids
            if aid in self._completion_events
        ]

        if events_to_wait:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*[e.wait() for e in events_to_wait]),
                    timeout=timeout,
                )
            except TimeoutError:
                logger.warning("Timeout waiting for agents in swarm {}", swarm_id)

        # Get final results
        async with self.session_factory() as db:
            result = await db.execute(
                select(SwarmAgent).where(SwarmAgent.id.in_(agent_ids))
            )
            agents = result.scalars().all()

            return [
                AgentResult(
                    agent_id=a.id,
                    name=a.name,
                    role=a.role,
                    status=SwarmStatus(a.status),
                    output_text=a.output_text,
                    output_summary=a.output_summary,
                    error_message=a.error_message,
                    tool_count=a.tool_count,
                    started_at=a.started_at,
                    completed_at=a.completed_at,
                )
                for a in agents
            ]

    async def cancel_swarm(self, swarm_id: int) -> None:
        """Cancel all running/pending agents in swarm."""
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                raise ValueError(f"Swarm {swarm_id} not found")

            # Cancel running tasks
            for agent in swarm.agents:
                if agent.id in self._running_tasks:
                    task = self._running_tasks[agent.id]
                    if not task.done():
                        task.cancel()

                # Update status
                if agent.status in (SwarmStatus.PENDING.value, SwarmStatus.RUNNING.value):
                    agent.status = SwarmStatus.CANCELLED.value
                    agent.completed_at = datetime.now(UTC)

            swarm.status = SwarmStatus.CANCELLED.value
            swarm.completed_at = datetime.now(UTC)
            await db.commit()

        logger.info("Cancelled swarm {}", swarm_id)

    async def merge_branches(
        self,
        swarm_id: int,
        target_branch: str,
        strategy: str = "sequential",
    ) -> MergeResult:
        """Merge agent branches back to target branch.

        Args:
            swarm_id: The swarm ID
            target_branch: Branch to merge into
            strategy: 'sequential' merges one by one, 'squash' not implemented yet

        Returns:
            MergeResult with success status and any conflicts
        """
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                raise ValueError(f"Swarm {swarm_id} not found")

            if not swarm.git_branch_prefix:
                return MergeResult(
                    success=False,
                    error="Swarm does not have git branch management enabled",
                )

            merged = []
            failed = []
            conflicts = []

            # Get agents with branches that completed successfully
            agents_to_merge = [
                a for a in swarm.agents
                if a.git_branch and a.status == SwarmStatus.COMPLETED.value
            ]

            for agent in agents_to_merge:
                success, error = await merge_branch(
                    swarm.working_dir,
                    agent.git_branch,
                    target_branch,
                    message=f"Merge swarm agent '{agent.name}' ({swarm.name})",
                )

                if success:
                    merged.append(agent.git_branch)
                else:
                    failed.append(agent.git_branch)
                    if "conflict" in (error or "").lower():
                        conflicts.append(agent.git_branch)

            return MergeResult(
                success=len(failed) == 0,
                merged_branches=merged,
                failed_branches=failed,
                conflicts=conflicts,
                error=f"Failed to merge: {', '.join(failed)}" if failed else None,
            )

    async def _generate_summary(self, output_text: str) -> str | None:
        """Generate a summary for long output using Haiku."""
        try:
            from dere_graph.llm_client import ClaudeClient, Message

            client = ClaudeClient(model="claude-haiku-4-5")

            max_context = 2000
            if len(output_text) > max_context * 2:
                context = output_text[:max_context] + "\n\n[...]\n\n" + output_text[-max_context:]
            else:
                context = output_text

            prompt = f"""Summarize this agent output in 1-2 sentences. Focus on the main result or outcome.

Output:
{context}

Summary:"""

            summary = await client.generate_text_response([Message(role="user", content=prompt)])
            return summary.strip()

        except Exception as e:
            logger.warning("Failed to generate summary: {}", e)
            return None

    async def get_agent_output(self, swarm_id: int, agent_name: str) -> AgentResult:
        """Get full output from a specific agent."""
        async with self.session_factory() as db:
            result = await db.execute(
                select(SwarmAgent)
                .where(SwarmAgent.swarm_id == swarm_id)
                .where(SwarmAgent.name == agent_name)
            )
            agent = result.scalar_one_or_none()

            if not agent:
                raise ValueError(f"Agent '{agent_name}' not found in swarm {swarm_id}")

            return AgentResult(
                agent_id=agent.id,
                name=agent.name,
                role=agent.role,
                status=SwarmStatus(agent.status),
                output_text=agent.output_text,
                output_summary=agent.output_summary,
                error_message=agent.error_message,
                tool_count=agent.tool_count,
                started_at=agent.started_at,
                completed_at=agent.completed_at,
            )
