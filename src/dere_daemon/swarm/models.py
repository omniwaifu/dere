"""Pydantic models for swarm API requests and responses."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from dere_shared.models import SwarmAgentMode, SwarmAgentRole, SwarmStatus


class DependencyIncludeMode(str, Enum):
    """How much output to include from a dependency."""

    SUMMARY = "summary"  # LLM-generated summary (default)
    FULL = "full"  # Full output text
    NONE = "none"  # Just wait, don't inject output


class DependencySpec(BaseModel):
    """Detailed specification for a dependency."""

    agent: str = Field(..., description="Name of the agent to depend on")
    include: DependencyIncludeMode = Field(
        default=DependencyIncludeMode.SUMMARY,
        description="How much output to include from this dependency",
    )


class AgentSpec(BaseModel):
    """Specification for an agent to spawn in a swarm."""

    name: str = Field(..., description="Agent identifier within the swarm")
    prompt: str = Field(
        default="",
        description="Task prompt for assigned mode (optional for autonomous mode)",
    )
    role: SwarmAgentRole = Field(
        default=SwarmAgentRole.GENERIC,
        description="Agent role: implementation, review, research, or generic",
    )
    mode: SwarmAgentMode = Field(
        default=SwarmAgentMode.ASSIGNED,
        description="Execution mode: assigned (explicit prompt) or autonomous (discover work)",
    )
    personality: str | None = Field(
        default=None, description="Personality preset (e.g., 'tsun', 'kuu')"
    )
    plugins: list[str] | None = Field(
        default=None,
        description="Plugins to enable (e.g., ['dere_code']). None for lean mode.",
    )
    depends_on: list[DependencySpec] | None = Field(
        default=None,
        description="Dependencies: list of agent names or DependencySpec objects",
    )
    allowed_tools: list[str] | None = Field(
        default=None, description="Tool restrictions (None = default tools)"
    )
    thinking_budget: int | None = Field(default=None, description="Extended thinking token budget")
    model: str | None = Field(default=None, description="Claude model override")
    sandbox_mode: bool = Field(default=True, description="Run in Docker sandbox")

    # Autonomous mode configuration
    goal: str | None = Field(
        default=None,
        description="High-level objective for autonomous agents (used instead of prompt)",
    )
    capabilities: list[str] | None = Field(
        default=None,
        description="Tools the agent can use (for task matching in autonomous mode)",
    )
    task_types: list[str] | None = Field(
        default=None,
        description="Task types to filter (feature, bug, refactor, test, docs, research)",
    )
    max_tasks: int | None = Field(
        default=None,
        description="Max tasks to complete before terminating (autonomous mode)",
    )
    max_duration_seconds: int | None = Field(
        default=None,
        description="Max runtime in seconds before terminating (autonomous mode)",
    )
    idle_timeout_seconds: int = Field(
        default=60,
        description="Seconds without finding work before terminating (autonomous mode)",
    )

    @field_validator("depends_on", mode="before")
    @classmethod
    def normalize_depends_on(cls, v: list[str | dict] | None) -> list[DependencySpec] | None:
        """Convert string dependencies to DependencySpec objects."""
        if v is None:
            return None
        result = []
        for item in v:
            if isinstance(item, str):
                result.append(DependencySpec(agent=item))
            elif isinstance(item, dict):
                result.append(DependencySpec(**item))
            elif isinstance(item, DependencySpec):
                result.append(item)
            else:
                raise ValueError(f"Invalid dependency spec: {item}")
        return result


class AgentResult(BaseModel):
    """Result from a completed agent."""

    agent_id: int
    name: str
    role: str
    status: SwarmStatus
    output_text: str | None = None
    output_summary: str | None = None
    error_message: str | None = None
    tool_count: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


class SwarmStatusResponse(BaseModel):
    """Full swarm status response."""

    swarm_id: int
    name: str
    description: str | None = None
    status: SwarmStatus
    working_dir: str
    git_branch_prefix: str | None = None
    base_branch: str | None = None
    agents: list[AgentResult]
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    # Synthesis info
    auto_synthesize: bool = False
    synthesis_output: str | None = None
    synthesis_summary: str | None = None


class MergeResult(BaseModel):
    """Result of branch merge operation."""

    success: bool
    merged_branches: list[str] = Field(default_factory=list)
    failed_branches: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    error: str | None = None


class CreateSwarmRequest(BaseModel):
    """Request to create a new swarm."""

    parent_session_id: int
    name: str
    working_dir: str
    agents: list[AgentSpec]
    description: str | None = None
    git_branch_prefix: str | None = None
    base_branch: str | None = None
    auto_start: bool = Field(default=True, description="Start execution immediately after creation")
    auto_synthesize: bool = Field(
        default=False,
        description="Spawn a synthesis agent after all others complete to aggregate results",
    )
    synthesis_prompt: str | None = Field(
        default=None,
        description="Custom prompt for synthesis agent (auto-generated if None)",
    )
    skip_synthesis_on_failure: bool = Field(
        default=False,
        description="Skip synthesis if any agent failed",
    )


class CreateSwarmResponse(BaseModel):
    """Response from swarm creation."""

    swarm_id: int
    name: str
    status: SwarmStatus
    agents: list[dict]


class WaitRequest(BaseModel):
    """Request to wait for agents to complete."""

    agent_names: list[str] | None = Field(
        default=None, description="Specific agents to wait for (None = all)"
    )
    timeout_seconds: float | None = Field(
        default=None, description="Max time to wait (None = wait indefinitely)"
    )


class MergeRequest(BaseModel):
    """Request to merge agent branches."""

    target_branch: str = Field(default="main", description="Branch to merge into")
    strategy: str = Field(
        default="sequential",
        description="Merge strategy: 'sequential' (one by one) or 'squash'",
    )
