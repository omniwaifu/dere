"""Work queue management endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

router = APIRouter(prefix="/work-queue", tags=["work-queue"])


# --- Request/Response Models ---


class CreateTaskRequest(BaseModel):
    """Request to create a new task."""

    title: str
    description: str | None = None
    working_dir: str
    acceptance_criteria: str | None = None
    context_summary: str | None = None
    scope_paths: list[str] | None = None
    required_tools: list[str] | None = None
    task_type: str | None = None
    tags: list[str] | None = None
    estimated_effort: str | None = None
    priority: int = 0
    blocked_by: list[int] | None = None
    related_task_ids: list[int] | None = None
    created_by_session_id: int | None = None
    created_by_agent_id: int | None = None
    discovered_from_task_id: int | None = None
    discovery_reason: str | None = None
    extra: dict[str, Any] | None = None


class ClaimTaskRequest(BaseModel):
    """Request to claim a task."""

    session_id: int | None = None
    agent_id: int | None = None


class ReleaseTaskRequest(BaseModel):
    """Request to release a task."""

    reason: str | None = None


class UpdateTaskRequest(BaseModel):
    """Request to update a task."""

    status: str | None = None
    title: str | None = None
    description: str | None = None
    priority: int | None = None
    tags: list[str] | None = None
    outcome: str | None = None
    completion_notes: str | None = None
    files_changed: list[str] | None = None
    last_error: str | None = None


class TaskResponse(BaseModel):
    """Task details response."""

    id: int
    working_dir: str
    title: str
    description: str | None
    acceptance_criteria: str | None
    context_summary: str | None
    scope_paths: list[str] | None
    required_tools: list[str] | None
    task_type: str | None
    tags: list[str] | None
    estimated_effort: str | None
    priority: int
    status: str
    claimed_by_session_id: int | None
    claimed_by_agent_id: int | None
    claimed_at: datetime | None
    attempt_count: int
    blocked_by: list[int] | None
    related_task_ids: list[int] | None
    created_by_session_id: int | None
    created_by_agent_id: int | None
    discovered_from_task_id: int | None
    discovery_reason: str | None
    outcome: str | None
    completion_notes: str | None
    files_changed: list[str] | None
    follow_up_task_ids: list[int] | None
    last_error: str | None
    extra: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class TaskListResponse(BaseModel):
    """Task list response."""

    tasks: list[TaskResponse]
    total: int


def _task_to_response(task) -> TaskResponse:
    """Convert a ProjectTask to TaskResponse."""
    return TaskResponse(
        id=task.id,
        working_dir=task.working_dir,
        title=task.title,
        description=task.description,
        acceptance_criteria=task.acceptance_criteria,
        context_summary=task.context_summary,
        scope_paths=task.scope_paths,
        required_tools=task.required_tools,
        task_type=task.task_type,
        tags=task.tags,
        estimated_effort=task.estimated_effort,
        priority=task.priority,
        status=task.status,
        claimed_by_session_id=task.claimed_by_session_id,
        claimed_by_agent_id=task.claimed_by_agent_id,
        claimed_at=task.claimed_at,
        attempt_count=task.attempt_count,
        blocked_by=task.blocked_by,
        related_task_ids=task.related_task_ids,
        created_by_session_id=task.created_by_session_id,
        created_by_agent_id=task.created_by_agent_id,
        discovered_from_task_id=task.discovered_from_task_id,
        discovery_reason=task.discovery_reason,
        outcome=task.outcome,
        completion_notes=task.completion_notes,
        files_changed=task.files_changed,
        follow_up_task_ids=task.follow_up_task_ids,
        last_error=task.last_error,
        extra=task.extra,
        created_at=task.created_at,
        updated_at=task.updated_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


# --- Endpoints ---


@router.post("/tasks", response_model=TaskResponse)
async def create_task(req: CreateTaskRequest, request: Request):
    """Create a new project task."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    try:
        task = await coordinator.create_task(
            working_dir=req.working_dir,
            title=req.title,
            description=req.description,
            acceptance_criteria=req.acceptance_criteria,
            context_summary=req.context_summary,
            scope_paths=req.scope_paths,
            required_tools=req.required_tools,
            task_type=req.task_type,
            tags=req.tags,
            estimated_effort=req.estimated_effort,
            priority=req.priority,
            blocked_by=req.blocked_by,
            related_task_ids=req.related_task_ids,
            created_by_session_id=req.created_by_session_id,
            created_by_agent_id=req.created_by_agent_id,
            discovered_from_task_id=req.discovered_from_task_id,
            discovery_reason=req.discovery_reason,
            extra=req.extra,
        )
        return _task_to_response(task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(
    request: Request,
    working_dir: str | None = None,
    status: str | None = None,
    task_type: str | None = None,
    tags: list[str] | None = Query(default=None),
    limit: int = 50,
    offset: int = 0,
):
    """List tasks with optional filtering."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    tasks, total = await coordinator.list_tasks(
        working_dir=working_dir,
        status=status,
        task_type=task_type,
        tags=tags,
        limit=limit,
        offset=offset,
    )
    return TaskListResponse(
        tasks=[_task_to_response(t) for t in tasks],
        total=total,
    )


@router.get("/tasks/ready", response_model=TaskListResponse)
async def get_ready_tasks(
    request: Request,
    working_dir: str,
    task_type: str | None = None,
    required_tools: list[str] | None = Query(default=None),
    limit: int = 10,
):
    """Get tasks ready for work (unblocked, unclaimed)."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    tasks = await coordinator.get_ready_tasks(
        working_dir=working_dir,
        task_type=task_type,
        required_tools=required_tools,
        limit=limit,
    )
    return TaskListResponse(
        tasks=[_task_to_response(t) for t in tasks],
        total=len(tasks),
    )


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: int, request: Request):
    """Get a specific task by ID."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    task = await coordinator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return _task_to_response(task)


@router.post("/tasks/{task_id}/claim", response_model=TaskResponse)
async def claim_task(task_id: int, req: ClaimTaskRequest, request: Request):
    """Atomically claim a ready task."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    try:
        task = await coordinator.claim_task(
            task_id=task_id,
            session_id=req.session_id,
            agent_id=req.agent_id,
        )
        return _task_to_response(task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/tasks/{task_id}/release", response_model=TaskResponse)
async def release_task(task_id: int, req: ReleaseTaskRequest, request: Request):
    """Release a claimed task back to ready."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    try:
        task = await coordinator.release_task(
            task_id=task_id,
            reason=req.reason,
        )
        return _task_to_response(task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: int, req: UpdateTaskRequest, request: Request):
    """Update task details or status."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    try:
        task = await coordinator.update_task(
            task_id=task_id,
            status=req.status,
            title=req.title,
            description=req.description,
            priority=req.priority,
            tags=req.tags,
            outcome=req.outcome,
            completion_notes=req.completion_notes,
            files_changed=req.files_changed,
            last_error=req.last_error,
        )
        return _task_to_response(task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, request: Request):
    """Delete a task."""
    coordinator = getattr(request.app.state, "work_queue_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Work queue coordinator not available")

    deleted = await coordinator.delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return {"deleted": True}
