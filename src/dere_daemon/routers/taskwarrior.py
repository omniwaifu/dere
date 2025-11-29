"""Taskwarrior integration endpoints."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter(prefix="/taskwarrior", tags=["taskwarrior"])


class Task(BaseModel):
    """Taskwarrior task model."""

    uuid: str
    description: str
    status: str
    project: str | None = None
    tags: list[str] = []
    entry: str
    modified: str | None = None
    end: str | None = None
    due: str | None = None
    urgency: float = 0.0


class TasksResponse(BaseModel):
    """Response containing task list and counts."""

    tasks: list[Task]
    pending_count: int
    completed_count: int


@router.get("/tasks", response_model=TasksResponse)
async def get_tasks(
    status: str | None = None,
    project: str | None = None,
    include_completed: bool = True,
) -> TasksResponse:
    """Export tasks from Taskwarrior.

    Args:
        status: Filter by status (pending, completed, deleted)
        project: Filter by project name
        include_completed: Whether to include completed tasks (for analytics)
    """
    # Taskwarrior syntax: task <filters> export
    # Filters must come BEFORE the command
    cmd = ["task"]

    if status:
        cmd.append(f"status:{status}")
    if project:
        cmd.append(f"project:{project}")

    cmd.append("export")

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0:
            error_msg = stderr.decode().strip()
            logger.error("Taskwarrior export failed: {}", error_msg)
            raise HTTPException(status_code=500, detail=f"Taskwarrior error: {error_msg}")

        raw_tasks = json.loads(stdout.decode())

        tasks = []
        pending_count = 0
        completed_count = 0

        for raw in raw_tasks:
            task = Task(
                uuid=raw.get("uuid", ""),
                description=raw.get("description", ""),
                status=raw.get("status", "pending"),
                project=raw.get("project"),
                tags=raw.get("tags", []),
                entry=raw.get("entry", ""),
                modified=raw.get("modified"),
                end=raw.get("end"),
                due=raw.get("due"),
                urgency=raw.get("urgency", 0.0),
            )
            tasks.append(task)

            if task.status == "pending":
                pending_count += 1
            elif task.status == "completed":
                completed_count += 1

        if not include_completed:
            tasks = [t for t in tasks if t.status != "completed"]

        return TasksResponse(
            tasks=tasks,
            pending_count=pending_count,
            completed_count=completed_count,
        )

    except FileNotFoundError:
        logger.error("Taskwarrior not found - is it installed?")
        raise HTTPException(status_code=503, detail="Taskwarrior not installed")
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Taskwarrior output: {}", e)
        raise HTTPException(status_code=500, detail="Failed to parse Taskwarrior output")
