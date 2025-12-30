"""Metrics endpoints for ambient exploration and related systems."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import ExplorationFinding, ProjectTask, ProjectTaskStatus, SurfacedFinding

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/exploration")
async def exploration_metrics(
    user_id: str | None = None,
    days_back: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """Summary metrics for ambient exploration."""
    cutoff = datetime.now(UTC) - timedelta(days=days_back)

    tasks_query = select(ProjectTask).where(ProjectTask.task_type == "curiosity")
    findings_query = select(ExplorationFinding)
    surfaced_query = select(SurfacedFinding)

    if user_id:
        tasks_query = tasks_query.where(ProjectTask.extra["user_id"].astext == user_id)
        findings_query = findings_query.where(ExplorationFinding.user_id == user_id)

    tasks_query = tasks_query.where(ProjectTask.created_at >= cutoff)
    findings_query = findings_query.where(ExplorationFinding.created_at >= cutoff)
    surfaced_query = surfaced_query.where(SurfacedFinding.surfaced_at >= cutoff)

    tasks = list((await db.execute(tasks_query)).scalars().all())
    findings = list((await db.execute(findings_query)).scalars().all())
    surfaced = list((await db.execute(surfaced_query)).scalars().all())

    status_counts = {
        status.value: 0
        for status in ProjectTaskStatus
    }
    for task in tasks:
        status_counts[task.status] = status_counts.get(task.status, 0) + 1

    shareable = [f for f in findings if f.worth_sharing]
    avg_confidence = None
    if findings:
        avg_confidence = sum(f.confidence for f in findings) / len(findings)

    return {
        "window_days": days_back,
        "curiosity_tasks": {
            "total": len(tasks),
            "by_status": status_counts,
        },
        "findings": {
            "total": len(findings),
            "shareable": len(shareable),
            "avg_confidence": avg_confidence,
        },
        "surfaced": {
            "total": len(surfaced),
        },
    }
