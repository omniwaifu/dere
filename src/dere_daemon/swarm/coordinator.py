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
from dere_shared.models import (
    ProjectTask,
    ProjectTaskStatus,
    Session,
    Swarm,
    SwarmAgent,
    SwarmAgentMode,
    SwarmAgentRole,
    SwarmStatus,
)

from .git import (
    create_branch,
    get_current_branch,
    merge_branch,
)
from .models import (
    AgentResult,
    AgentSpec,
    DAGEdge,
    DAGNode,
    MergeResult,
    SwarmDAGResponse,
    SwarmStatusResponse,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from dere_daemon.agent.service import CentralizedAgentService
    from dere_daemon.work_queue.coordinator import WorkQueueCoordinator

# Maximum output size to store per agent (50KB)
MAX_OUTPUT_SIZE = 50 * 1024

# Threshold for generating summary (1000 chars)
SUMMARY_THRESHOLD = 1000


def detect_dependency_cycle(agents: list[AgentSpec]) -> list[str] | None:
    """Detect cycles in agent dependencies using DFS.

    Args:
        agents: List of agent specifications with depends_on fields

    Returns:
        List of agent names forming a cycle, or None if no cycle exists
    """
    # Build adjacency list: agent -> agents it depends on
    adj: dict[str, list[str]] = {}
    agent_names = {spec.name for spec in agents}

    for spec in agents:
        deps = []
        if spec.depends_on:
            for dep in spec.depends_on:
                if dep.agent in agent_names:
                    deps.append(dep.agent)
        adj[spec.name] = deps

    # DFS with path tracking (0=unvisited, 1=in progress, 2=done)
    visiting, visited = 1, 2
    state = {name: 0 for name in agent_names}
    path: list[str] = []

    def dfs(node: str) -> list[str] | None:
        state[node] = visiting
        path.append(node)

        for neighbor in adj.get(node, []):
            if state[neighbor] == visiting:
                # Found cycle - extract it from path
                cycle_start = path.index(neighbor)
                return path[cycle_start:] + [neighbor]
            if state[neighbor] == 0:
                result = dfs(neighbor)
                if result:
                    return result

        path.pop()
        state[node] = visited
        return None

    for name in agent_names:
        if state[name] == 0:
            cycle = dfs(name)
            if cycle:
                return cycle

    return None


@dataclass
class SwarmCoordinator:
    """Coordinates spawning and management of agent swarms."""

    agent_service: CentralizedAgentService
    session_factory: Callable[[], AsyncSession]
    work_queue: WorkQueueCoordinator | None = None

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
        auto_synthesize: bool = False,
        synthesis_prompt: str | None = None,
        skip_synthesis_on_failure: bool = False,
        auto_supervise: bool = False,
        supervisor_warn_seconds: int = 600,
        supervisor_cancel_seconds: int = 1800,
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
            auto_synthesize: Spawn a synthesis agent after all others complete
            synthesis_prompt: Custom prompt for synthesis agent (auto-generated if None)
            skip_synthesis_on_failure: Skip synthesis if any agent failed
            auto_supervise: Spawn a watchdog supervisor to monitor agents
            supervisor_warn_seconds: Seconds before supervisor warns a stalling agent
            supervisor_cancel_seconds: Seconds before supervisor marks agent as stuck

        Returns:
            Created Swarm instance
        """
        # Resolve base branch if using git
        if git_branch_prefix and not base_branch:
            try:
                base_branch = await get_current_branch(working_dir)
            except Exception as e:
                logger.warning("Failed to get current branch: {}", e)

        # Validate no cycles in dependencies
        cycle = detect_dependency_cycle(agents)
        if cycle:
            cycle_str = " -> ".join(cycle)
            raise ValueError(f"Circular dependency detected: {cycle_str}")

        async with self.session_factory() as db:
            # Verify parent session exists if provided
            verified_parent_id = None
            if parent_session_id:
                result = await db.execute(select(Session.id).where(Session.id == parent_session_id))
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
                auto_synthesize=auto_synthesize,
                synthesis_prompt=synthesis_prompt,
                skip_synthesis_on_failure=skip_synthesis_on_failure,
                auto_supervise=auto_supervise,
                supervisor_warn_seconds=supervisor_warn_seconds,
                supervisor_cancel_seconds=supervisor_cancel_seconds,
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
                    mode=spec.mode.value,
                    prompt=spec.prompt,
                    personality=spec.personality,
                    plugins=spec.plugins,
                    git_branch=git_branch,
                    allowed_tools=spec.allowed_tools,
                    thinking_budget=spec.thinking_budget,
                    model=spec.model,
                    sandbox_mode=spec.sandbox_mode,
                    status=SwarmStatus.PENDING.value,
                    # Autonomous mode fields
                    goal=spec.goal,
                    capabilities=spec.capabilities,
                    task_types=spec.task_types,
                    max_tasks=spec.max_tasks,
                    max_duration_seconds=spec.max_duration_seconds,
                    idle_timeout_seconds=spec.idle_timeout_seconds,
                )
                db.add(agent)
                await db.flush()
                name_to_db_agent[spec.name] = agent

            # Second pass - resolve dependencies
            for spec in agents:
                if spec.depends_on:
                    agent = name_to_db_agent[spec.name]
                    dep_specs = []
                    for dep_spec in spec.depends_on:
                        if dep_spec.agent not in name_to_db_agent:
                            raise ValueError(
                                f"Agent '{spec.name}' depends on unknown agent '{dep_spec.agent}'"
                            )
                        dep_specs.append(
                            {
                                "agent_id": name_to_db_agent[dep_spec.agent].id,
                                "include": dep_spec.include.value,
                            }
                        )
                    agent.depends_on = dep_specs

            # Create synthesis agent if enabled
            if auto_synthesize:
                # Build default prompt if not provided
                final_synthesis_prompt = synthesis_prompt or self._build_default_synthesis_prompt(
                    name
                )

                # Synthesis agent depends on ALL other agents with full output
                synthesis_deps = [
                    {"agent_id": db_agent.id, "include": "full"}
                    for db_agent in name_to_db_agent.values()
                ]

                synthesis_agent = SwarmAgent(
                    swarm_id=swarm.id,
                    name="synthesis",
                    role=SwarmAgentRole.SYNTHESIS.value,
                    prompt=final_synthesis_prompt,
                    personality=None,
                    plugins=["dere_core"],  # For work-queue access
                    git_branch=None,
                    allowed_tools=None,
                    thinking_budget=None,
                    model=None,
                    sandbox_mode=True,
                    depends_on=synthesis_deps,
                    is_synthesis_agent=True,
                )
                db.add(synthesis_agent)
                await db.flush()

                logger.info(
                    "Created synthesis agent for swarm '{}' with {} dependencies",
                    name,
                    len(synthesis_deps),
                )

            # Create supervisor agent if enabled
            if auto_supervise:
                supervisor_prompt = self._build_supervisor_prompt(
                    swarm_name=name,
                    agent_names=[spec.name for spec in agents],
                    warn_seconds=supervisor_warn_seconds,
                    cancel_seconds=supervisor_cancel_seconds,
                )

                supervisor_agent = SwarmAgent(
                    swarm_id=swarm.id,
                    name="supervisor",
                    role=SwarmAgentRole.SUPERVISOR.value,
                    prompt=supervisor_prompt,
                    personality=None,
                    plugins=["dere_core"],  # For swarm status + messaging
                    git_branch=None,
                    allowed_tools=None,
                    thinking_budget=None,
                    model=None,
                    sandbox_mode=True,
                    depends_on=None,  # No dependencies - runs in parallel
                    is_synthesis_agent=False,
                )
                db.add(supervisor_agent)
                await db.flush()

                logger.info(
                    "Created supervisor agent for swarm '{}' (warn={}s, cancel={}s)",
                    name,
                    supervisor_warn_seconds,
                    supervisor_cancel_seconds,
                )

            await db.commit()

            # Re-fetch with agents eagerly loaded (avoid DetachedInstanceError)
            result = await db.execute(
                select(Swarm).options(selectinload(Swarm.agents)).where(Swarm.id == swarm.id)
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
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
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
                task = asyncio.create_task(self._execute_agent_with_dependencies(agent.id))
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
                for dep_spec in agent.depends_on:
                    dep_id = dep_spec["agent_id"]
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

        # Branch based on mode
        if agent.mode == SwarmAgentMode.AUTONOMOUS.value:
            await self._execute_autonomous_agent(agent_id)
            return

        # Below is assigned mode execution
        async with self.session_factory() as db:
            agent = await db.get(SwarmAgent, agent_id)
            swarm = await db.get(Swarm, agent.swarm_id)

            # Build dependency context
            dependency_context = ""
            if agent.depends_on:
                dep_sections = []
                for dep_spec in agent.depends_on:
                    include_mode = dep_spec.get("include", "summary")
                    if include_mode == "none":
                        continue

                    dep_agent = await db.get(SwarmAgent, dep_spec["agent_id"])
                    if not dep_agent:
                        continue

                    # Get the appropriate output based on include mode
                    if include_mode == "full":
                        output = dep_agent.output_text or "(no output)"
                    else:  # summary (default)
                        output = dep_agent.output_summary or dep_agent.output_text or "(no output)"

                    dep_sections.append(f"## Output from '{dep_agent.name}'\n{output}")

                if dep_sections:
                    dependency_context = (
                        "# Context from dependencies\n\n"
                        + "\n\n".join(dep_sections)
                        + "\n\n---\n\n"
                    )

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

            # All agents use bridge network - they communicate with daemon via Unix socket
            config = SessionConfig(
                working_dir=swarm.working_dir,
                output_style="default",
                personality=agent.personality or "",
                allowed_tools=agent.allowed_tools,
                thinking_budget=agent.thinking_budget,
                model=agent.model,
                sandbox_mode=agent.sandbox_mode,
                sandbox_network_mode="bridge",
                include_context=False,  # Swarm agents don't need emotion/KG
                auto_approve=True,  # Autonomous execution
                lean_mode=lean_mode,
                swarm_agent_id=agent_id,
                plugins=agent.plugins,
                session_name=f"swarm:{swarm.name}:{agent.name}",
                env={
                    "DERE_SWARM_ID": str(swarm.id),
                    "DERE_SWARM_AGENT_ID": str(agent_id),
                    "DERE_SWARM_AGENT_NAME": agent.name,
                },
            )

            # Build prompt with dependency context and git branch info
            prompt = dependency_context + agent.prompt
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

    async def _execute_autonomous_agent(self, agent_id: int) -> None:
        """Execute an autonomous agent that discovers work from the queue."""
        if not self.work_queue:
            raise RuntimeError(
                "WorkQueueCoordinator required for autonomous agents. "
                "Set work_queue on SwarmCoordinator."
            )

        async with self.session_factory() as db:
            agent = await db.get(SwarmAgent, agent_id)
            swarm = await db.get(Swarm, agent.swarm_id)

        if not agent or not swarm:
            return

        logger.info(
            "Starting autonomous agent '{}' (id={}) with goal: {}",
            agent.name,
            agent_id,
            agent.goal or "(no goal)",
        )

        start_time = datetime.now(UTC)
        last_task_time = start_time

        try:
            while True:
                # Check termination conditions
                elapsed = (datetime.now(UTC) - start_time).total_seconds()

                if agent.max_duration_seconds and elapsed >= agent.max_duration_seconds:
                    logger.info(
                        "Agent '{}' reached max duration ({:.0f}s)",
                        agent.name,
                        elapsed,
                    )
                    break

                if agent.max_tasks and agent.tasks_completed >= agent.max_tasks:
                    logger.info(
                        "Agent '{}' reached max tasks ({})",
                        agent.name,
                        agent.tasks_completed,
                    )
                    break

                # Discover and claim a task
                task = await self._discover_and_claim_task(agent, swarm.working_dir)

                if not task:
                    # Check idle timeout
                    idle_time = (datetime.now(UTC) - last_task_time).total_seconds()
                    if idle_time >= agent.idle_timeout_seconds:
                        logger.info(
                            "Agent '{}' idle timeout ({:.0f}s without work)",
                            agent.name,
                            idle_time,
                        )
                        break

                    # Wait and retry
                    await asyncio.sleep(5)
                    continue

                last_task_time = datetime.now(UTC)

                # Execute the task
                success = await self._execute_single_task(agent_id, agent, task, swarm)

                # Update tracking
                async with self.session_factory() as db:
                    agent_record = await db.get(SwarmAgent, agent_id)
                    if agent_record:
                        if success:
                            agent_record.tasks_completed += 1
                        else:
                            agent_record.tasks_failed += 1
                        agent_record.current_task_id = None
                        await db.commit()
                        # Refresh local copy
                        agent.tasks_completed = agent_record.tasks_completed
                        agent.tasks_failed = agent_record.tasks_failed

            # Autonomous agent completed successfully
            async with self.session_factory() as db:
                agent_record = await db.get(SwarmAgent, agent_id)
                if agent_record:
                    agent_record.status = SwarmStatus.COMPLETED.value
                    agent_record.completed_at = datetime.now(UTC)
                    agent_record.output_text = (
                        f"Autonomous agent completed. "
                        f"Tasks: {agent.tasks_completed} completed, {agent.tasks_failed} failed."
                    )
                    await db.commit()

            logger.info(
                "Autonomous agent '{}' finished: {} completed, {} failed",
                agent.name,
                agent.tasks_completed,
                agent.tasks_failed,
            )

        except Exception as e:
            logger.exception("Autonomous agent '{}' execution failed", agent.name)

            async with self.session_factory() as db:
                agent_record = await db.get(SwarmAgent, agent_id)
                if agent_record:
                    agent_record.status = SwarmStatus.FAILED.value
                    agent_record.completed_at = datetime.now(UTC)
                    agent_record.error_message = str(e)
                    await db.commit()

        # Check swarm completion
        await self._check_swarm_completion(swarm.id)

    async def _discover_and_claim_task(
        self, agent: SwarmAgent, working_dir: str
    ) -> ProjectTask | None:
        """Discover and atomically claim a task from the work queue."""
        # Get ready tasks that match agent's capabilities
        ready_tasks = await self.work_queue.get_ready_tasks(
            working_dir=working_dir,
            limit=5,
            task_type=agent.task_types[0] if agent.task_types else None,
            required_tools=agent.capabilities,
        )

        # Try to claim one
        for task in ready_tasks:
            try:
                claimed = await self.work_queue.claim_task(
                    task_id=task.id,
                    agent_id=agent.id,
                )
                # Update agent's current task
                async with self.session_factory() as db:
                    agent_record = await db.get(SwarmAgent, agent.id)
                    if agent_record:
                        agent_record.current_task_id = claimed.id
                        await db.commit()
                return claimed
            except ValueError:
                # Task was claimed by someone else, try next
                continue

        return None

    async def _execute_single_task(
        self,
        agent_id: int,
        agent: SwarmAgent,
        task: ProjectTask,
        swarm: Swarm,
    ) -> bool:
        """Execute a single task from the work queue. Returns True if successful."""
        logger.info(
            "Agent '{}' executing task {}: {}",
            agent.name,
            task.id,
            task.title,
        )

        # Mark task as in progress
        await self.work_queue.update_task(
            task_id=task.id,
            status=ProjectTaskStatus.IN_PROGRESS.value,
        )

        # Build prompt from goal + task
        prompt = self._build_task_prompt(agent, task)

        try:
            # Build session config (similar to assigned mode)
            lean_mode = agent.plugins is None
            config = SessionConfig(
                working_dir=swarm.working_dir,
                output_style="default",
                personality=agent.personality or "",
                allowed_tools=agent.allowed_tools,
                thinking_budget=agent.thinking_budget,
                model=agent.model,
                sandbox_mode=agent.sandbox_mode,
                include_context=False,
                auto_approve=True,
                lean_mode=lean_mode,
                swarm_agent_id=agent_id,
                plugins=agent.plugins,
                session_name=f"swarm:{swarm.name}:{agent.name}:task-{task.id}",
                env={
                    "DERE_SWARM_ID": str(swarm.id),
                    "DERE_SWARM_AGENT_ID": str(agent_id),
                    "DERE_SWARM_AGENT_NAME": agent.name,
                },
            )

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

                # Update task based on result
                if error_message:
                    # Task failed - re-queue as ready for retry
                    await self.work_queue.update_task(
                        task_id=task.id,
                        status=ProjectTaskStatus.READY.value,
                        last_error=error_message,
                    )
                    # Clear claim
                    await self.work_queue.release_task(task.id, reason=error_message)
                    return False
                else:
                    # Task succeeded
                    await self.work_queue.update_task(
                        task_id=task.id,
                        status=ProjectTaskStatus.DONE.value,
                        outcome=f"Completed by autonomous agent '{agent.name}'",
                        completion_notes=output_text[:2000] if output_text else None,
                    )
                    return True

            finally:
                await self.agent_service.close_session(session.session_id)

        except Exception as e:
            logger.exception("Task {} execution failed", task.id)
            # Re-queue task
            try:
                await self.work_queue.release_task(task.id, reason=str(e))
            except Exception:
                pass
            return False

    def _build_task_prompt(self, agent: SwarmAgent, task: ProjectTask) -> str:
        """Build a prompt for executing a task, combining agent goal with task details."""
        sections = []

        # Agent's high-level goal
        if agent.goal:
            sections.append(f"# Your Goal\n\n{agent.goal}")

        # Task details
        sections.append(f"# Current Task\n\n**{task.title}**")

        if task.description:
            sections.append(f"## Description\n\n{task.description}")

        if task.acceptance_criteria:
            sections.append(f"## Acceptance Criteria\n\n{task.acceptance_criteria}")

        if task.context_summary:
            sections.append(f"## Context\n\n{task.context_summary}")

        if task.scope_paths:
            sections.append(f"## Scope\n\nFocus on: {', '.join(task.scope_paths)}")

        # Instructions for sub-task creation
        sections.append(
            "## Instructions\n\n"
            "1. Complete this task thoroughly\n"
            "2. If you discover additional work needed, use work-queue tools to create follow-up tasks\n"
            "3. Mark this task complete when done"
        )

        return "\n\n".join(sections)

    async def _check_swarm_completion(self, swarm_id: int) -> None:
        """Check if all agents in swarm are done and update swarm status."""
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                return

            # Separate regular agents from synthesis agent
            regular_agents = [a for a in swarm.agents if not a.is_synthesis_agent]
            synthesis_agent = next((a for a in swarm.agents if a.is_synthesis_agent), None)

            # Check if all regular agents are done
            regular_done = all(
                a.status
                in (
                    SwarmStatus.COMPLETED.value,
                    SwarmStatus.FAILED.value,
                    SwarmStatus.CANCELLED.value,
                )
                for a in regular_agents
            )

            if not regular_done:
                return

            # If synthesis is enabled and pending, check if we should skip or let it run
            if synthesis_agent and synthesis_agent.status == SwarmStatus.PENDING.value:
                any_failed = any(a.status == SwarmStatus.FAILED.value for a in regular_agents)

                if any_failed and swarm.skip_synthesis_on_failure:
                    # Mark synthesis as skipped (cancelled)
                    synthesis_agent.status = SwarmStatus.CANCELLED.value
                    synthesis_agent.error_message = "Skipped due to agent failures"
                    synthesis_agent.completed_at = datetime.now(UTC)
                    await db.commit()
                    logger.info("Skipping synthesis for swarm '{}' due to failures", swarm.name)
                    # Signal completion for synthesis so waiters don't hang
                    if synthesis_agent.id in self._completion_events:
                        self._completion_events[synthesis_agent.id].set()
                else:
                    # Synthesis will run via normal dependency mechanism
                    return

            # Check if synthesis is still running
            if synthesis_agent and synthesis_agent.status == SwarmStatus.RUNNING.value:
                return

            # All agents (including synthesis if present) are done
            all_done = all(
                a.status
                in (
                    SwarmStatus.COMPLETED.value,
                    SwarmStatus.FAILED.value,
                    SwarmStatus.CANCELLED.value,
                )
                for a in swarm.agents
            )

            if all_done:
                any_failed = any(a.status == SwarmStatus.FAILED.value for a in swarm.agents)
                swarm.status = (
                    SwarmStatus.FAILED.value if any_failed else SwarmStatus.COMPLETED.value
                )
                swarm.completed_at = datetime.now(UTC)

                # Copy synthesis output to swarm for easy access
                if synthesis_agent and synthesis_agent.status == SwarmStatus.COMPLETED.value:
                    swarm.synthesis_output = synthesis_agent.output_text
                    swarm.synthesis_summary = synthesis_agent.output_summary

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
                auto_synthesize=swarm.auto_synthesize,
                synthesis_output=swarm.synthesis_output,
                synthesis_summary=swarm.synthesis_summary,
            )

    async def get_swarm_dag(self, swarm_id: int) -> SwarmDAGResponse:
        """Get DAG representation of swarm for visualization.

        Computes topological levels and critical path for graph layout.
        """
        async with self.session_factory() as db:
            swarm = await db.get(Swarm, swarm_id, options=[selectinload(Swarm.agents)])
            if not swarm:
                raise ValueError(f"Swarm {swarm_id} not found")

            # Build lookup maps
            id_to_agent = {a.id: a for a in swarm.agents}
            name_to_agent = {a.name: a for a in swarm.agents}

            # Compute topological levels (0 = no dependencies)
            levels: dict[str, int] = {}

            def compute_level(agent_name: str) -> int:
                if agent_name in levels:
                    return levels[agent_name]

                agent = name_to_agent.get(agent_name)
                if not agent or not agent.depends_on:
                    levels[agent_name] = 0
                    return 0

                max_dep_level = -1
                for dep_spec in agent.depends_on:
                    dep_agent = id_to_agent.get(dep_spec.get("agent_id"))
                    if dep_agent:
                        max_dep_level = max(max_dep_level, compute_level(dep_agent.name))

                levels[agent_name] = max_dep_level + 1
                return levels[agent_name]

            for agent in swarm.agents:
                compute_level(agent.name)

            # Build nodes
            nodes = [
                DAGNode(
                    id=a.id,
                    name=a.name,
                    role=a.role,
                    status=SwarmStatus(a.status),
                    level=levels.get(a.name, 0),
                    started_at=a.started_at,
                    completed_at=a.completed_at,
                    error_message=a.error_message,
                )
                for a in swarm.agents
            ]

            # Build edges
            edges = []
            for agent in swarm.agents:
                if agent.depends_on:
                    for dep_spec in agent.depends_on:
                        dep_agent = id_to_agent.get(dep_spec.get("agent_id"))
                        if dep_agent:
                            edges.append(
                                DAGEdge(
                                    source=dep_agent.name,
                                    target=agent.name,
                                    include_mode=dep_spec.get("include", "summary"),
                                )
                            )

            # Compute critical path (longest path through the DAG)
            # Use dynamic programming on topological order
            max_level = max(levels.values()) if levels else 0
            critical_path: list[str] | None = None

            if max_level > 0:
                # For each node, track the longest path ending at that node
                path_to: dict[str, list[str]] = {a.name: [a.name] for a in swarm.agents}

                # Process in topological order (by level)
                for level in range(1, max_level + 1):
                    for agent in swarm.agents:
                        if levels.get(agent.name) != level:
                            continue
                        if not agent.depends_on:
                            continue

                        # Find longest path among dependencies
                        longest_dep_path: list[str] = []
                        for dep_spec in agent.depends_on:
                            dep_agent = id_to_agent.get(dep_spec.get("agent_id"))
                            if dep_agent and len(path_to[dep_agent.name]) > len(longest_dep_path):
                                longest_dep_path = path_to[dep_agent.name]

                        path_to[agent.name] = longest_dep_path + [agent.name]

                # Find the longest path overall
                critical_path = max(path_to.values(), key=len)

            return SwarmDAGResponse(
                swarm_id=swarm.id,
                name=swarm.name,
                status=SwarmStatus(swarm.status),
                nodes=nodes,
                edges=edges,
                max_level=max_level,
                critical_path=critical_path,
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
            self._completion_events[aid] for aid in agent_ids if aid in self._completion_events
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
            result = await db.execute(select(SwarmAgent).where(SwarmAgent.id.in_(agent_ids)))
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
                a for a in swarm.agents if a.git_branch and a.status == SwarmStatus.COMPLETED.value
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

    def _build_supervisor_prompt(
        self,
        swarm_name: str,
        agent_names: list[str],
        warn_seconds: int,
        cancel_seconds: int,
    ) -> str:
        """Build prompt for watchdog supervisor agent."""
        check_interval = 30
        agent_list = ", ".join(f"'{n}'" for n in agent_names)

        return f"""You are the watchdog supervisor for swarm '{swarm_name}'.

## Your Job

Monitor these agents: {agent_list}

You observe, warn, and record - but don't interfere with working agents.

## Monitoring Loop

Every {check_interval} seconds:

1. Call `get_swarm_status()` to check all agents
2. For each RUNNING agent:
   - If running > {warn_seconds}s: send a warning message asking them to wrap up
   - If running > {cancel_seconds}s: note they may be stuck in scratchpad
3. For FAILED agents: record the failure reason in scratchpad
4. Exit when all monitored agents are COMPLETED, FAILED, or CANCELLED

## Tools Available

- `get_swarm_status()`: Get status of all agents (check started_at timestamps)
- `send_message(to, text, priority)`: Send message to an agent (use priority="urgent" for warnings)
- `scratchpad_set(key, value)`: Record observations for synthesis to review

## Scratchpad Keys to Use

- `supervisor/warnings/{{agent_name}}`: Agents you've warned
- `supervisor/stuck/{{agent_name}}`: Agents that exceeded cancel threshold
- `supervisor/failures/{{agent_name}}`: Agents that failed with error details
- `supervisor/summary`: Final monitoring summary when done

## Important

- Be patient - agents doing real work take time
- Only warn if genuinely concerned about progress
- Don't spam messages - one warning per threshold is enough
- Record anomalies for synthesis to review
- Your observations help improve future swarms

Start by calling get_swarm_status() to see the current state, then begin your monitoring loop."""

    def _build_default_synthesis_prompt(self, swarm_name: str) -> str:
        """Build default prompt for synthesis agent."""
        return f"""You are the synthesis agent for swarm '{swarm_name}'.

Your task is to:
1. Review the outputs from all agents provided in the context
2. Create a unified summary of what was accomplished
3. Identify any inconsistencies, conflicts, or issues between agent outputs
4. **Create follow-up tasks** for any unfinished work using the work-queue tools

## Work-Queue Tools Available

You have access to work-queue tools:
- `list_tasks` - View existing tasks in the queue
- `create_task` - Create new tasks for follow-up work
- `get_ready_tasks` - See what tasks are ready for work

When creating follow-up tasks with `create_task()`, include:
- **title**: Clear, actionable title
- **description**: What needs to be done
- **acceptance_criteria**: How to know when it's complete
- **task_type**: 'feature', 'bug', 'refactor', 'test', 'docs', or 'research'
- **estimated_effort**: 'trivial', 'small', 'medium', 'large', or 'epic'
- **scope_paths**: Relevant files/directories
- **required_tools**: Tools needed (e.g., ["Edit", "Bash", "Grep"])
- **context_summary**: Background info from this swarm's work

## Important

- Focus on synthesis and aggregation, not implementation
- Note which agents succeeded vs failed
- **Always** create work-queue tasks for any follow-up work discovered
- Provide a clear, concise summary at the end

Review the agent outputs below and provide your synthesis."""

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
