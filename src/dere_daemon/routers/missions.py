"""Mission management endpoints."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_daemon.missions.schedule_parser import is_valid_cron, parse_natural_language_schedule
from dere_shared.models import (
    Mission,
    MissionExecution,
    MissionStatus,
    MissionTriggerType,
)

router = APIRouter(prefix="/missions", tags=["missions"])


# Request/Response models
class CreateMissionRequest(BaseModel):
    """Request to create a new mission."""

    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    prompt: str = Field(..., min_length=1)
    schedule: str = Field(..., description="Cron expression or natural language schedule")
    personality: str | None = None
    allowed_tools: list[str] | None = None
    mcp_servers: list[str] | None = None
    plugins: list[str] | None = None
    thinking_budget: int | None = None
    model: str = "claude-sonnet-4-20250514"
    working_dir: str = "/workspace"
    sandbox_mode: bool = True
    sandbox_mount_type: str = "none"
    run_once: bool = False


class UpdateMissionRequest(BaseModel):
    """Request to update a mission."""

    name: str | None = None
    description: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    personality: str | None = None
    allowed_tools: list[str] | None = None
    mcp_servers: list[str] | None = None
    plugins: list[str] | None = None
    thinking_budget: int | None = None
    model: str | None = None
    working_dir: str | None = None
    sandbox_mode: bool | None = None
    sandbox_mount_type: str | None = None
    run_once: bool | None = None


class MissionResponse(BaseModel):
    """Mission details response."""

    id: int
    name: str
    description: str | None
    prompt: str
    cron_expression: str
    natural_language_schedule: str | None
    timezone: str
    status: str
    next_execution_at: datetime | None
    last_execution_at: datetime | None
    personality: str | None
    allowed_tools: list[str] | None
    mcp_servers: list[str] | None
    plugins: list[str] | None
    thinking_budget: int | None
    model: str
    working_dir: str
    sandbox_mode: bool
    sandbox_mount_type: str
    run_once: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExecutionResponse(BaseModel):
    """Mission execution details response."""

    id: int
    mission_id: int
    status: str
    trigger_type: str
    triggered_by: str | None
    started_at: datetime | None
    completed_at: datetime | None
    output_text: str | None
    output_summary: str | None
    tool_count: int
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


async def _parse_schedule(schedule: str) -> tuple[str, str, str | None]:
    """Parse schedule input (cron or NL) into cron expression.

    Returns: (cron_expression, timezone, natural_language_schedule)
    """
    # Try as cron first
    if is_valid_cron(schedule):
        return schedule, "UTC", None

    # Parse as natural language
    cron_expr, timezone = await parse_natural_language_schedule(schedule)
    return cron_expr, timezone, schedule


@router.post("", response_model=MissionResponse)
async def create_mission(
    req: CreateMissionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a new mission.

    Accepts either a cron expression or natural language schedule.
    """
    try:
        cron_expr, timezone, nl_schedule = await _parse_schedule(req.schedule)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Calculate first execution time
    now = datetime.now(UTC)
    next_run = croniter(cron_expr, now).get_next(datetime)

    mission = Mission(
        name=req.name,
        description=req.description,
        prompt=req.prompt,
        cron_expression=cron_expr,
        natural_language_schedule=nl_schedule,
        timezone=timezone,
        next_execution_at=next_run,
        personality=req.personality,
        allowed_tools=req.allowed_tools,
        mcp_servers=req.mcp_servers,
        plugins=req.plugins,
        thinking_budget=req.thinking_budget,
        model=req.model,
        working_dir=req.working_dir,
        sandbox_mode=req.sandbox_mode,
        sandbox_mount_type=req.sandbox_mount_type,
        run_once=req.run_once,
    )

    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    logger.info("Created mission {}: {} (next run: {})", mission.id, mission.name, next_run)

    return mission


@router.get("", response_model=list[MissionResponse])
async def list_missions(
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
):
    """List all missions, optionally filtered by status."""
    stmt = select(Mission).order_by(Mission.created_at.desc())

    if status:
        stmt = stmt.where(Mission.status == status)

    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{mission_id}", response_model=MissionResponse)
async def get_mission(
    mission_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get mission details."""
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    return mission


@router.patch("/{mission_id}", response_model=MissionResponse)
async def update_mission(
    mission_id: int,
    req: UpdateMissionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a mission."""
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    # Update fields if provided
    update_data = req.model_dump(exclude_unset=True)

    # Handle schedule change specially
    if "schedule" in update_data:
        schedule = update_data.pop("schedule")
        try:
            cron_expr, timezone, nl_schedule = await _parse_schedule(schedule)
            mission.cron_expression = cron_expr
            mission.timezone = timezone
            mission.natural_language_schedule = nl_schedule

            # Recalculate next execution
            now = datetime.now(UTC)
            mission.next_execution_at = croniter(cron_expr, now).get_next(datetime)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    # Apply other updates
    for field, value in update_data.items():
        setattr(mission, field, value)

    mission.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(mission)

    logger.info("Updated mission {}: {}", mission.id, mission.name)

    return mission


@router.delete("/{mission_id}")
async def delete_mission(
    mission_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a mission and its execution history."""
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    await db.delete(mission)
    await db.commit()

    logger.info("Deleted mission {}: {}", mission_id, mission.name)

    return {"status": "deleted", "id": mission_id}


@router.post("/{mission_id}/pause", response_model=MissionResponse)
async def pause_mission(
    mission_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Pause a mission (prevents scheduled execution)."""
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    mission.status = MissionStatus.PAUSED.value
    mission.updated_at = datetime.now(UTC)

    await db.commit()
    await db.refresh(mission)

    logger.info("Paused mission {}: {}", mission.id, mission.name)

    return mission


@router.post("/{mission_id}/resume", response_model=MissionResponse)
async def resume_mission(
    mission_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Resume a paused mission."""
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    mission.status = MissionStatus.ACTIVE.value

    # Recalculate next execution from now
    now = datetime.now(UTC)
    mission.next_execution_at = croniter(mission.cron_expression, now).get_next(datetime)
    mission.updated_at = now

    await db.commit()
    await db.refresh(mission)

    logger.info("Resumed mission {}: {} (next run: {})", mission.id, mission.name, mission.next_execution_at)

    return mission


@router.post("/{mission_id}/execute")
async def trigger_execution(
    mission_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a mission execution.

    The execution runs asynchronously; use GET /missions/{id}/executions to check status.
    """
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    # Get executor from app state
    executor = getattr(request.app.state, "mission_executor", None)
    if not executor:
        raise HTTPException(status_code=503, detail="Mission executor not available")

    # Execute asynchronously (don't block request)
    asyncio.create_task(
        executor.execute(
            mission,
            trigger_type=MissionTriggerType.MANUAL.value,
            triggered_by="user",
        )
    )

    logger.info("Manually triggered mission {}: {}", mission.id, mission.name)

    return {"status": "triggered", "mission_id": mission_id}


@router.get("/{mission_id}/executions", response_model=list[ExecutionResponse])
async def list_executions(
    mission_id: int,
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
):
    """Get execution history for a mission."""
    # Verify mission exists
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    stmt = (
        select(MissionExecution)
        .where(MissionExecution.mission_id == mission_id)
        .order_by(MissionExecution.started_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{mission_id}/executions/{execution_id}", response_model=ExecutionResponse)
async def get_execution(
    mission_id: int,
    execution_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get details of a specific execution."""
    execution = await db.get(MissionExecution, execution_id)
    if not execution or execution.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution
