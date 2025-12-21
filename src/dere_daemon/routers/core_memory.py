"""Core memory block endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import ConsolidationRun, CoreMemoryBlock, CoreMemoryVersion, Session

router = APIRouter(prefix="/memory", tags=["core_memory"])

CORE_MEMORY_BLOCK_TYPES = {"persona", "human", "task"}
DEFAULT_CHAR_LIMIT = 8192


class CoreMemoryEditRequest(BaseModel):
    block_type: Literal["persona", "human", "task"]
    content: str
    reason: str | None = None
    scope: Literal["user", "session"] = "user"
    session_id: int | None = None
    user_id: str | None = None
    char_limit: int | None = None


class CoreMemoryBlockResponse(BaseModel):
    id: int
    block_type: str
    content: str
    scope: str
    session_id: int | None
    user_id: str | None
    char_limit: int
    version: int
    updated_at: datetime | None


class CoreMemoryEditResponse(BaseModel):
    block: CoreMemoryBlockResponse
    created: bool


class CoreMemoryHistoryResponse(BaseModel):
    block_id: int
    version: int
    content: str
    reason: str | None
    created_at: datetime | None


class CoreMemoryRollbackRequest(BaseModel):
    block_type: Literal["persona", "human", "task"]
    target_version: int
    reason: str | None = None
    scope: Literal["user", "session"] = "user"
    session_id: int | None = None
    user_id: str | None = None


class CoreMemoryRollbackResponse(BaseModel):
    block: CoreMemoryBlockResponse
    rolled_back_to: int


class ConsolidationRunResponse(BaseModel):
    id: int
    user_id: str | None
    task_id: int | None
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    recency_days: int | None
    community_resolution: float | None
    update_core_memory: bool
    triggered_by: str | None
    stats: dict | None
    error_message: str | None


class ConsolidationRunListResponse(BaseModel):
    runs: list[ConsolidationRunResponse]
    total: int
    offset: int
    limit: int


def _validate_content(content: str, char_limit: int) -> None:
    if char_limit <= 0:
        raise HTTPException(status_code=400, detail="char_limit must be positive")
    if len(content) > char_limit:
        raise HTTPException(
            status_code=400,
            detail=f"Content exceeds char_limit ({len(content)}/{char_limit})",
        )


def _block_response(block: CoreMemoryBlock, scope: str) -> CoreMemoryBlockResponse:
    return CoreMemoryBlockResponse(
        id=block.id or 0,
        block_type=block.block_type,
        content=block.content,
        scope=scope,
        session_id=block.session_id,
        user_id=block.user_id,
        char_limit=block.char_limit,
        version=block.version,
        updated_at=block.updated_at,
    )


def _run_response(run: ConsolidationRun) -> ConsolidationRunResponse:
    return ConsolidationRunResponse(
        id=run.id or 0,
        user_id=run.user_id,
        task_id=run.task_id,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        recency_days=run.recency_days,
        community_resolution=run.community_resolution,
        update_core_memory=run.update_core_memory,
        triggered_by=run.triggered_by,
        stats=run.stats,
        error_message=run.error_message,
    )


async def _resolve_block(
    db: AsyncSession,
    *,
    block_type: str,
    scope: str,
    session_id: int | None,
    user_id: str | None,
) -> tuple[CoreMemoryBlock | None, str]:
    resolved_scope = scope
    if scope == "session":
        if session_id is None:
            raise HTTPException(status_code=400, detail="session_id required for session scope")
        stmt = select(CoreMemoryBlock).where(
            CoreMemoryBlock.session_id == session_id,
            CoreMemoryBlock.block_type == block_type,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none(), resolved_scope

    resolved_user_id = user_id
    if resolved_user_id is None and session_id is not None:
        session = await db.get(Session, session_id)
        resolved_user_id = session.user_id if session else None
    if not resolved_user_id:
        raise HTTPException(status_code=400, detail="user_id not found for session")

    stmt = select(CoreMemoryBlock).where(
        CoreMemoryBlock.user_id == resolved_user_id,
        CoreMemoryBlock.session_id.is_(None),
        CoreMemoryBlock.block_type == block_type,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none(), resolved_scope


@router.post("/core/edit", response_model=CoreMemoryEditResponse)
async def edit_core_memory(
    payload: CoreMemoryEditRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create or update a core memory block."""
    block_type = payload.block_type.strip().lower()
    if block_type not in CORE_MEMORY_BLOCK_TYPES:
        raise HTTPException(status_code=400, detail="Invalid block_type")

    scope = payload.scope
    session_id = payload.session_id
    user_id = payload.user_id

    if scope == "session":
        if session_id is None:
            raise HTTPException(status_code=400, detail="session_id required for session scope")
    else:
        if user_id is None and session_id is None:
            raise HTTPException(status_code=400, detail="user_id or session_id required")
        if user_id is None and session_id is not None:
            session = await db.get(Session, session_id)
            user_id = session.user_id if session else None
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id not found for session")

    if payload.char_limit is not None and payload.char_limit <= 0:
        raise HTTPException(status_code=400, detail="char_limit must be positive")

    now = datetime.now(UTC)

    block, resolved_scope = await _resolve_block(
        db,
        block_type=block_type,
        scope=scope,
        session_id=session_id,
        user_id=user_id,
    )

    created = False
    if block:
        char_limit = payload.char_limit or block.char_limit or DEFAULT_CHAR_LIMIT
        _validate_content(payload.content, char_limit)
        block.content = payload.content
        block.char_limit = char_limit
        block.version = (block.version or 1) + 1
        block.updated_at = now
    else:
        created = True
        char_limit = payload.char_limit or DEFAULT_CHAR_LIMIT
        _validate_content(payload.content, char_limit)
        block = CoreMemoryBlock(
            user_id=None if scope == "session" else user_id,
            session_id=session_id if scope == "session" else None,
            block_type=block_type,
            content=payload.content,
            char_limit=char_limit,
            version=1,
            created_at=now,
            updated_at=now,
        )
        db.add(block)
        await db.flush()

    version = CoreMemoryVersion(
        block_id=block.id,  # type: ignore[arg-type]
        version=block.version,
        content=block.content,
        reason=payload.reason,
        created_at=now,
    )
    db.add(version)
    await db.commit()

    return CoreMemoryEditResponse(block=_block_response(block, resolved_scope), created=created)


@router.get("/core", response_model=list[CoreMemoryBlockResponse])
async def list_core_memory(
    request: Request,
    session_id: int | None = None,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List core memory blocks for a session or user."""
    resolved_user_id = user_id
    if session_id is not None:
        session = await db.get(Session, session_id)
        if session and session.user_id:
            resolved_user_id = session.user_id

    if not session_id and not resolved_user_id:
        raise HTTPException(status_code=400, detail="session_id or user_id required")

    blocks: dict[str, CoreMemoryBlock] = {}
    if session_id is not None:
        stmt = select(CoreMemoryBlock).where(
            CoreMemoryBlock.session_id == session_id,
            CoreMemoryBlock.block_type.in_(CORE_MEMORY_BLOCK_TYPES),
        )
        result = await db.execute(stmt)
        for block in result.scalars().all():
            blocks[block.block_type] = block

    if resolved_user_id:
        stmt = select(CoreMemoryBlock).where(
            CoreMemoryBlock.user_id == resolved_user_id,
            CoreMemoryBlock.session_id.is_(None),
            CoreMemoryBlock.block_type.in_(CORE_MEMORY_BLOCK_TYPES),
        )
        result = await db.execute(stmt)
        for block in result.scalars().all():
            if block.block_type not in blocks:
                blocks[block.block_type] = block

    response = []
    for block_type in ("persona", "human", "task"):
        block = blocks.get(block_type)
        if not block:
            continue
        scope = "session" if block.session_id else "user"
        response.append(_block_response(block, scope))

    return response


@router.get("/core/history", response_model=list[CoreMemoryHistoryResponse])
async def core_memory_history(
    request: Request,
    block_type: Literal["persona", "human", "task"],
    limit: int = 20,
    scope: Literal["user", "session"] = "user",
    session_id: int | None = None,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Return version history for a core memory block."""
    block, _scope = await _resolve_block(
        db,
        block_type=block_type,
        scope=scope,
        session_id=session_id,
        user_id=user_id,
    )
    if not block:
        raise HTTPException(status_code=404, detail="Core memory block not found")

    stmt = (
        select(CoreMemoryVersion)
        .where(CoreMemoryVersion.block_id == block.id)
        .order_by(CoreMemoryVersion.version.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    versions = result.scalars().all()

    return [
        CoreMemoryHistoryResponse(
            block_id=block.id or 0,
            version=version.version,
            content=version.content,
            reason=version.reason,
            created_at=version.created_at,
        )
        for version in versions
    ]


@router.post("/core/rollback", response_model=CoreMemoryRollbackResponse)
async def core_memory_rollback(
    payload: CoreMemoryRollbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Rollback a core memory block to a previous version."""
    block, resolved_scope = await _resolve_block(
        db,
        block_type=payload.block_type,
        scope=payload.scope,
        session_id=payload.session_id,
        user_id=payload.user_id,
    )
    if not block:
        raise HTTPException(status_code=404, detail="Core memory block not found")

    if payload.target_version <= 0:
        raise HTTPException(status_code=400, detail="target_version must be positive")

    stmt = select(CoreMemoryVersion).where(
        CoreMemoryVersion.block_id == block.id,
        CoreMemoryVersion.version == payload.target_version,
    )
    result = await db.execute(stmt)
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Target version not found")

    _validate_content(target.content, block.char_limit)

    now = datetime.now(UTC)
    block.content = target.content
    block.version = (block.version or 1) + 1
    block.updated_at = now

    reason = payload.reason or f"rollback to v{payload.target_version}"
    db.add(
        CoreMemoryVersion(
            block_id=block.id,  # type: ignore[arg-type]
            version=block.version,
            content=block.content,
            reason=reason,
            created_at=now,
        )
    )
    await db.commit()

    return CoreMemoryRollbackResponse(
        block=_block_response(block, resolved_scope),
        rolled_back_to=payload.target_version,
    )


@router.get("/consolidation/runs", response_model=ConsolidationRunListResponse)
async def list_consolidation_runs(
    request: Request,
    user_id: str | None = None,
    status: str | None = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """List recent memory consolidation runs."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    stmt = select(ConsolidationRun)
    count_stmt = select(func.count()).select_from(ConsolidationRun)

    if user_id:
        stmt = stmt.where(ConsolidationRun.user_id == user_id)
        count_stmt = count_stmt.where(ConsolidationRun.user_id == user_id)
    if status:
        stmt = stmt.where(ConsolidationRun.status == status)
        count_stmt = count_stmt.where(ConsolidationRun.status == status)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(
        stmt.order_by(ConsolidationRun.started_at.desc()).offset(offset).limit(limit)
    )
    runs = result.scalars().all()

    return ConsolidationRunListResponse(
        runs=[_run_response(run) for run in runs],
        total=total,
        offset=offset,
        limit=limit,
    )
