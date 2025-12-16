"""FastMCP server for project work queue management.

This MCP server exposes tools for creating, claiming, and managing project tasks.
It communicates with the dere daemon via HTTP API.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastmcp import FastMCP

DAEMON_URL = os.environ.get("DERE_DAEMON_URL", "http://localhost:8787")
SESSION_ID = os.environ.get("DERE_SESSION_ID")
AGENT_ID = os.environ.get("DERE_SWARM_AGENT_ID")

mcp = FastMCP("Project Work Queue")


def _get_session_id() -> int | None:
    """Get session ID from environment."""
    return int(SESSION_ID) if SESSION_ID else None


def _get_agent_id() -> int | None:
    """Get swarm agent ID from environment if running as a swarm agent."""
    return int(AGENT_ID) if AGENT_ID else None


@mcp.tool()
async def list_tasks(
    working_dir: str | None = None,
    status: str | None = None,
    task_type: str | None = None,
    tags: list[str] | None = None,
    limit: int = 50,
) -> dict:
    """
    List project tasks with optional filtering.

    Args:
        working_dir: Filter by project directory (defaults to current)
        status: Filter by status ('backlog', 'ready', 'claimed', 'in_progress', 'done', 'blocked', 'cancelled')
        task_type: Filter by task type ('feature', 'bug', 'refactor', 'test', 'docs', 'research')
        tags: Filter by tags (returns tasks with any matching tag)
        limit: Maximum tasks to return (default 50)

    Returns:
        List of tasks with their details
    """
    params: dict[str, Any] = {"limit": limit}
    if working_dir:
        params["working_dir"] = working_dir
    else:
        params["working_dir"] = os.getcwd()
    if status:
        params["status"] = status
    if task_type:
        params["task_type"] = task_type
    if tags:
        params["tags"] = tags

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/work-queue/tasks",
            params=params,
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def create_task(
    title: str,
    description: str | None = None,
    working_dir: str | None = None,
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
    discovered_from_task_id: int | None = None,
    discovery_reason: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict:
    """
    Create a new project task.

    Args:
        title: Task title (required)
        description: Detailed description of what needs to be done
        working_dir: Project directory (defaults to current)
        acceptance_criteria: Clear definition of when the task is done
        context_summary: Background information for the agent
        scope_paths: Files/directories relevant to this task
        required_tools: Tools needed (e.g., ["Edit", "Bash", "Grep"])
        task_type: Type ('feature', 'bug', 'refactor', 'test', 'docs', 'research')
        tags: Task tags for categorization
        estimated_effort: Effort estimate ('trivial', 'small', 'medium', 'large', 'epic')
        priority: Priority level (higher = more important, default 0)
        blocked_by: List of task IDs that must complete first
        related_task_ids: List of related (but not blocking) task IDs
        discovered_from_task_id: Parent task that led to discovering this one
        discovery_reason: Why this task was created
        extra: Additional structured data

    Returns:
        Created task details
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/work-queue/tasks",
            json={
                "title": title,
                "description": description,
                "working_dir": working_dir or os.getcwd(),
                "acceptance_criteria": acceptance_criteria,
                "context_summary": context_summary,
                "scope_paths": scope_paths,
                "required_tools": required_tools,
                "task_type": task_type,
                "tags": tags,
                "estimated_effort": estimated_effort,
                "priority": priority,
                "blocked_by": blocked_by,
                "related_task_ids": related_task_ids,
                "created_by_session_id": _get_session_id(),
                "created_by_agent_id": _get_agent_id(),
                "discovered_from_task_id": discovered_from_task_id,
                "discovery_reason": discovery_reason,
                "extra": extra,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def get_ready_tasks(
    working_dir: str | None = None,
    task_type: str | None = None,
    required_tools: list[str] | None = None,
    limit: int = 10,
) -> dict:
    """
    Find tasks that are ready for work (unblocked, unclaimed).

    This is the primary discovery tool for autonomous agents looking for work.

    Args:
        working_dir: Project directory (defaults to current)
        task_type: Filter by task type
        required_tools: Only return tasks requiring these tools (agent capabilities)
        limit: Maximum tasks to return (default 10)

    Returns:
        List of ready tasks, sorted by priority (descending)
    """
    params: dict[str, Any] = {
        "working_dir": working_dir or os.getcwd(),
        "limit": limit,
    }
    if task_type:
        params["task_type"] = task_type
    if required_tools:
        params["required_tools"] = required_tools

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/work-queue/tasks/ready",
            params=params,
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def claim_task(task_id: int) -> dict:
    """
    Atomically claim a ready task for the current session/agent.

    Will fail if:
    - Task doesn't exist
    - Task is not in 'ready' status
    - Task is already claimed by another agent

    After claiming, use update_task to set status to 'in_progress' when starting work.

    Args:
        task_id: ID of the task to claim

    Returns:
        Claimed task details or error
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/work-queue/tasks/{task_id}/claim",
            json={
                "session_id": _get_session_id(),
                "agent_id": _get_agent_id(),
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def release_task(task_id: int, reason: str | None = None) -> dict:
    """
    Release a claimed task back to ready status.

    Use when you cannot complete a task and want to make it available for others.

    Args:
        task_id: ID of the task to release
        reason: Optional reason for releasing (stored in last_error)

    Returns:
        Updated task details
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/work-queue/tasks/{task_id}/release",
            json={"reason": reason},
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def update_task(
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
) -> dict:
    """
    Update a task's details or status.

    Common status transitions:
    - claimed -> in_progress: Start working
    - in_progress -> done: Complete the task
    - any -> cancelled: Cancel the task

    When completing a task, provide:
    - outcome: Brief summary of what was accomplished
    - completion_notes: Detailed notes
    - files_changed: List of files that were modified

    Args:
        task_id: Task to update
        status: New status (optional)
        title: New title (optional)
        description: New description (optional)
        priority: New priority (optional)
        tags: New tags (optional, replaces existing)
        outcome: Success summary or failure reason (optional)
        completion_notes: Detailed notes on completion (optional)
        files_changed: List of files modified (optional)
        last_error: Error message if failed (optional)

    Returns:
        Updated task details
    """
    payload: dict[str, Any] = {}
    if status is not None:
        payload["status"] = status
    if title is not None:
        payload["title"] = title
    if description is not None:
        payload["description"] = description
    if priority is not None:
        payload["priority"] = priority
    if tags is not None:
        payload["tags"] = tags
    if outcome is not None:
        payload["outcome"] = outcome
    if completion_notes is not None:
        payload["completion_notes"] = completion_notes
    if files_changed is not None:
        payload["files_changed"] = files_changed
    if last_error is not None:
        payload["last_error"] = last_error

    async with httpx.AsyncClient() as client:
        resp = await client.patch(
            f"{DAEMON_URL}/work-queue/tasks/{task_id}",
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def get_task(task_id: int) -> dict:
    """
    Get details of a specific task.

    Args:
        task_id: ID of the task

    Returns:
        Task details
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/work-queue/tasks/{task_id}",
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
