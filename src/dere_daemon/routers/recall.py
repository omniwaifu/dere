"""Conversation recall search endpoints."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db

router = APIRouter(prefix="/recall", tags=["recall"])


class RecallSearchResult(BaseModel):
    """Recall search result for a conversation block."""

    block_id: int
    conversation_id: int
    session_id: int
    message_type: str
    timestamp: int
    medium: str | None
    user_id: str | None
    text: str
    score: float


class RecallSearchResponse(BaseModel):
    """Recall search response."""

    query: str
    results: list[RecallSearchResult]


def _rrf_scores(result_lists: list[list[int]], rank_const: int = 60) -> dict[int, float]:
    scores: dict[int, float] = {}
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
    """Search conversation blocks with hybrid fulltext + vector similarity."""
    if not query or not query.strip():
        return RecallSearchResponse(query=query, results=[])

    cutoff_ts = None
    if days_back is not None and days_back > 0:
        cutoff_ts = int(time.time()) - (days_back * 86400)

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
    fulltext_ids = [row["block_id"] for row in fulltext_rows]

    vector_rows = []
    vector_ids: list[int] = []
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
            vector_ids = [row["block_id"] for row in vector_rows]
        except Exception:
            vector_rows = []
            vector_ids = []

    scores = _rrf_scores([fulltext_ids, vector_ids])
    ranked_ids = sorted(scores.keys(), key=lambda key: scores[key], reverse=True)[:limit]

    row_map: dict[int, dict[str, Any]] = {}
    for row in fulltext_rows:
        row_map.setdefault(row["block_id"], dict(row))
    for row in vector_rows:
        row_map.setdefault(row["block_id"], dict(row))

    results: list[RecallSearchResult] = []
    for block_id in ranked_ids:
        row = row_map.get(block_id)
        if not row:
            continue
        results.append(
            RecallSearchResult(
                block_id=row["block_id"],
                conversation_id=row["conversation_id"],
                session_id=row["session_id"],
                message_type=row["message_type"],
                timestamp=row["timestamp"],
                medium=row["medium"],
                user_id=row["user_id"],
                text=row["text"],
                score=scores.get(block_id, 0.0),
            )
        )

    return RecallSearchResponse(query=query, results=results)
