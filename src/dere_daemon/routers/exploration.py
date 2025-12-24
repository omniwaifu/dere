"""Exploration findings surfacing endpoints."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import ExplorationFinding, SurfacedFinding

router = APIRouter(prefix="/exploration", tags=["exploration"])


class SurfaceQueueRequest(BaseModel):
    user_id: str | None = None
    limit: int = 1
    session_id: int | None = None


@router.post("/queue")
async def get_shareable_findings(
    req: SurfaceQueueRequest,
    db: AsyncSession = Depends(get_db),
):
    """Return shareable findings to surface at natural touchpoints."""
    surfaced_cutoff = datetime.now(UTC) - timedelta(days=7)

    surfaced_exists = (
        exists()
        .where(SurfacedFinding.finding_id == ExplorationFinding.id)
        .where(SurfacedFinding.surfaced_at > surfaced_cutoff)
    )
    if req.session_id is not None:
        surfaced_exists = surfaced_exists.where(SurfacedFinding.session_id == req.session_id)

    query = (
        select(ExplorationFinding)
        .where(
            ExplorationFinding.worth_sharing.is_(True),
            ExplorationFinding.confidence >= 0.8,
            ~surfaced_exists,
        )
        .order_by(ExplorationFinding.created_at.desc())
    )
    if req.user_id:
        query = query.where(ExplorationFinding.user_id == req.user_id)

    findings = []
    results = list((await db.execute(query.limit(req.limit))).scalars().all())
    for finding in results:
        findings.append(
            {
                "finding_id": finding.id,
                "task_id": finding.task_id,
                "user_id": finding.user_id,
                "text": finding.share_message or finding.finding,
                "confidence": finding.confidence,
                "created_at": finding.created_at.isoformat(),
            }
        )
        if len(findings) >= req.limit:
            break

    return {"findings": findings}
