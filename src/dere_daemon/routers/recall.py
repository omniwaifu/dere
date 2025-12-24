"""Conversation recall search endpoints."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db

router = APIRouter(prefix="/recall", tags=["recall"])


class RecallSearchResult(BaseModel):
    """Recall search result for a conversation block or exploration finding."""

    result_id: str
    result_type: Literal["conversation", "exploration_finding"]
    score: float
    text: str
    timestamp: int
    user_id: str | None
    message_type: str | None = None
    medium: str | None = None
    session_id: int | None = None
    conversation_id: int | None = None
    block_id: int | None = None
    finding_id: int | None = None
    task_id: int | None = None
    confidence: float | None = None


class RecallSearchResponse(BaseModel):
    """Recall search response."""

    query: str
    results: list[RecallSearchResult]


class SurfaceFindingRequest(BaseModel):
    finding_id: int
    session_id: int | None = None
    surfaced_at: datetime | None = None


def _rrf_scores(
    result_lists: list[list[str]],
    rank_const: int = 60,
) -> dict[str, float]:
    scores: dict[str, float] = {}
    for results in result_lists:
        for idx, block_id in enumerate(results):
            scores[block_id] = scores.get(block_id, 0.0) + 1.0 / (idx + rank_const)
    return scores


def _vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in embedding) + "]"


def _build_filters(
    *,
    session_id: int | None,
    user_id: str | None,
    cutoff_ts: int | None,
) -> tuple[list[str], dict[str, Any]]:
    clauses = [
        "cb.block_type = 'text'",
        "cb.text IS NOT NULL",
        "cb.text <> ''",
        "c.message_type IN ('user', 'assistant', 'system')",
    ]
    params: dict[str, Any] = {}

    if session_id is not None:
        clauses.append("c.session_id = :session_id")
        params["session_id"] = session_id
    if user_id:
        clauses.append("c.user_id = :user_id")
        params["user_id"] = user_id
    if cutoff_ts is not None:
        clauses.append("c.timestamp >= :cutoff_ts")
        params["cutoff_ts"] = cutoff_ts

    return clauses, params


def _finding_filters(
    *,
    user_id: str | None,
    cutoff_dt: datetime | None,
    surfaced_cutoff: datetime,
    session_id: int | None,
) -> tuple[list[str], dict[str, Any]]:
    clauses = [
        "f.finding IS NOT NULL",
        "f.finding <> ''",
    ]
    params: dict[str, Any] = {"surfaced_cutoff": surfaced_cutoff}

    if user_id:
        clauses.append("f.user_id = :user_id")
        params["user_id"] = user_id
    if cutoff_dt is not None:
        clauses.append("f.created_at >= :cutoff_dt")
        params["cutoff_dt"] = cutoff_dt

    surfaced_clause = "sf.surfaced_at > :surfaced_cutoff"
    if session_id is not None:
        params["session_id"] = session_id
        surfaced_clause = f"({surfaced_clause} OR sf.session_id = :session_id)"

    clauses.append(
        "NOT EXISTS (SELECT 1 FROM surfaced_findings sf "
        "WHERE sf.finding_id = f.id AND "
        f"{surfaced_clause})"
    )

    return clauses, params


@router.get("/search", response_model=RecallSearchResponse)
async def recall_search(
    request: Request,
    query: str,
    limit: int = 10,
    days_back: int | None = None,
    session_id: int | None = None,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Search conversation blocks and exploration findings with hybrid recall."""
    if not query or not query.strip():
        return RecallSearchResponse(query=query, results=[])

    cutoff_ts = None
    cutoff_dt = None
    if days_back is not None and days_back > 0:
        cutoff_ts = int(time.time()) - (days_back * 86400)
        cutoff_dt = datetime.now(UTC) - timedelta(days=days_back)

    filters, params = _build_filters(
        session_id=session_id,
        user_id=user_id,
        cutoff_ts=cutoff_ts,
    )
    where_clause = " AND ".join(filters)

    fulltext_sql = text(
        f"""
        SELECT
            cb.id AS block_id,
            cb.text AS text,
            c.id AS conversation_id,
            c.session_id AS session_id,
            c.message_type AS message_type,
            c.timestamp AS timestamp,
            c.medium AS medium,
            c.user_id AS user_id,
            ts_rank_cd(
                to_tsvector('english', cb.text),
                websearch_to_tsquery('english', :query)
            ) AS score
        FROM conversation_blocks cb
        JOIN conversations c ON c.id = cb.conversation_id
        WHERE {where_clause}
          AND to_tsvector('english', cb.text) @@ websearch_to_tsquery('english', :query)
        ORDER BY score DESC
        LIMIT :limit
        """
    )

    vector_sql = text(
        f"""
        SELECT
            cb.id AS block_id,
            cb.text AS text,
            c.id AS conversation_id,
            c.session_id AS session_id,
            c.message_type AS message_type,
            c.timestamp AS timestamp,
            c.medium AS medium,
            c.user_id AS user_id,
            1 - (cb.content_embedding <=> :query_vector::vector) AS score
        FROM conversation_blocks cb
        JOIN conversations c ON c.id = cb.conversation_id
        WHERE {where_clause}
          AND cb.content_embedding IS NOT NULL
        ORDER BY cb.content_embedding <=> :query_vector::vector
        LIMIT :limit
        """
    )

    fulltext_params = {**params, "query": query, "limit": limit * 2}

    fulltext_result = await db.execute(fulltext_sql, fulltext_params)
    fulltext_rows = fulltext_result.mappings().all()
    fulltext_ids = [f"conv:{row['block_id']}" for row in fulltext_rows]

    vector_rows = []
    vector_ids: list[str] = []
    embedder = getattr(request.app.state, "dere_graph", None)
    if embedder and getattr(embedder, "embedder", None):
        try:
            query_embedding = await embedder.embedder.create(query.replace("\n", " "))
            vector_literal = _vector_literal(query_embedding)
            vector_params = {
                **params,
                "query_vector": vector_literal,
                "limit": limit * 2,
            }
            vector_result = await db.execute(vector_sql, vector_params)
            vector_rows = vector_result.mappings().all()
            vector_ids = [f"conv:{row['block_id']}" for row in vector_rows]
        except Exception:
            vector_rows = []
            vector_ids = []

    finding_rows = []
    finding_ids: list[str] = []
    finding_filters, finding_params = _finding_filters(
        user_id=user_id,
        cutoff_dt=cutoff_dt,
        surfaced_cutoff=datetime.now(UTC) - timedelta(days=7),
        session_id=session_id,
    )
    finding_where = " AND ".join(finding_filters)
    finding_sql = text(
        f"""
        SELECT
            f.id AS finding_id,
            f.task_id AS task_id,
            f.finding AS text,
            f.share_message AS share_message,
            f.worth_sharing AS worth_sharing,
            f.user_id AS user_id,
            f.confidence AS confidence,
            f.created_at AS created_at,
            ts_rank_cd(
                to_tsvector('english', f.finding),
                websearch_to_tsquery('english', :query)
            ) AS score
        FROM exploration_findings f
        WHERE {finding_where}
          AND to_tsvector('english', f.finding) @@ websearch_to_tsquery('english', :query)
        ORDER BY score DESC
        LIMIT :limit
        """
    )
    finding_params = {**finding_params, "query": query, "limit": limit * 2}
    try:
        finding_result = await db.execute(finding_sql, finding_params)
        finding_rows = finding_result.mappings().all()
        finding_ids = [f"finding:{row['finding_id']}" for row in finding_rows]
    except Exception:
        finding_rows = []
        finding_ids = []

    scores = _rrf_scores([fulltext_ids, vector_ids, finding_ids])
    ranked_ids = sorted(scores.keys(), key=lambda key: scores[key], reverse=True)[:limit]

    row_map: dict[str, dict[str, Any]] = {}
    for row in fulltext_rows:
        row_map.setdefault(f"conv:{row['block_id']}", dict(row))
    for row in vector_rows:
        row_map.setdefault(f"conv:{row['block_id']}", dict(row))
    for row in finding_rows:
        row_map.setdefault(f"finding:{row['finding_id']}", dict(row))

    results: list[RecallSearchResult] = []
    for result_id in ranked_ids:
        row = row_map.get(result_id)
        if not row:
            continue

        if result_id.startswith("conv:"):
            results.append(
                RecallSearchResult(
                    result_id=result_id,
                    result_type="conversation",
                    block_id=row["block_id"],
                    conversation_id=row["conversation_id"],
                    session_id=row["session_id"],
                    message_type=row["message_type"],
                    timestamp=row["timestamp"],
                    medium=row["medium"],
                    user_id=row["user_id"],
                    text=row["text"],
                    score=scores.get(result_id, 0.0),
                )
            )
        else:
            created_at = row.get("created_at")
            timestamp = int(created_at.timestamp()) if created_at else 0
            display_text = row.get("text")
            if row.get("worth_sharing") and row.get("share_message"):
                display_text = row.get("share_message")
            results.append(
                RecallSearchResult(
                    result_id=result_id,
                    result_type="exploration_finding",
                    finding_id=row["finding_id"],
                    task_id=row["task_id"],
                    user_id=row["user_id"],
                    text=display_text,
                    timestamp=timestamp,
                    message_type="exploration",
                    confidence=row.get("confidence"),
                    score=scores.get(result_id, 0.0),
                )
            )

    return RecallSearchResponse(query=query, results=results)


@router.post("/findings/surface")
async def mark_finding_surfaced(
    req: SurfaceFindingRequest,
    db: AsyncSession = Depends(get_db),
):
    """Mark an exploration finding as surfaced for deduplication."""
    from dere_shared.models import SurfacedFinding

    stmt = (
        select(SurfacedFinding)
        .where(SurfacedFinding.finding_id == req.finding_id)
        .where(SurfacedFinding.session_id == req.session_id)
        .limit(1)
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        return {"status": "exists"}

    surfaced_at = req.surfaced_at or datetime.now(UTC)
    db.add(
        SurfacedFinding(
            finding_id=req.finding_id,
            session_id=req.session_id,
            surfaced_at=surfaced_at,
        )
    )
    await db.commit()
    return {"status": "marked"}
