"""Context building and caching endpoints."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.dependencies import get_db
from dere_shared.models import ContextCache, Session

router = APIRouter(prefix="/context", tags=["context"])


# Request/Response models
class ContextBuildRequest(BaseModel):
    session_id: int
    project_path: str
    personality: str
    user_id: str | None = None
    context_depth: int = 5
    include_entities: bool = False
    max_tokens: int = 2000
    context_mode: str = "smart"
    current_prompt: str


class ContextGetRequest(BaseModel):
    session_id: int
    max_age_minutes: int = 30


@router.post("/build")
async def context_build(
    req: ContextBuildRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    """Build context using knowledge graph search"""
    app_state = request.app.state

    # Ensure session exists
    stmt = select(Session).where(Session.id == req.session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        session = Session(
            id=req.session_id,
            working_dir=req.project_path or "",
            start_time=int(time.time()),
            last_activity=datetime.now(UTC),
        )
        db.add(session)
        await db.flush()

    # Set defaults
    context_depth = req.context_depth or 5

    # Use knowledge graph if available
    if app_state.dere_graph:
        try:
            from dere_graph.filters import ComparisonOperator, DateFilter, SearchFilters

            # Build temporal filter for last 7 days
            filters = SearchFilters(
                created_at=DateFilter(
                    operator=ComparisonOperator.GREATER_THAN,
                    value=datetime.now() - timedelta(days=7),
                )
            )

            # Step 1: Get relevant recent facts with episode-mentions reranking
            # This prioritizes frequently mentioned entities for better context
            search_results = await app_state.dere_graph.search(
                query=req.current_prompt,
                group_id=req.user_id or "default",
                limit=context_depth * 2,  # Get more for BFS expansion
                filters=filters,
                rerank_method="episode_mentions",  # Boost frequently mentioned entities
                rerank_alpha=0.5,  # Balance between frequency and base relevance
                recency_weight=0.3,  # Slight recency boost
            )

            # Step 2: BFS expansion for related concepts
            if search_results.nodes:
                origin_uuids = [n.uuid for n in search_results.nodes[:3]]
                related_nodes = await app_state.dere_graph.bfs_search_nodes(
                    origin_uuids=origin_uuids,
                    group_id=req.user_id or "default",
                    max_depth=2,
                    limit=context_depth,
                )

                # Merge and deduplicate
                all_nodes = search_results.nodes + related_nodes
                seen_uuids = set()
                unique_nodes = []
                for node in all_nodes:
                    if node.uuid not in seen_uuids:
                        seen_uuids.add(node.uuid)
                        unique_nodes.append(node)

                search_results.nodes = unique_nodes[:context_depth]

            # Format results into context text
            context_parts = []

            # Add entity context
            if search_results.nodes:
                context_parts.append("# Relevant Entities")
                for node in search_results.nodes:
                    context_parts.append(f"- {node.name}: {node.summary}")

            # Add relationship context
            if search_results.edges:
                context_parts.append("\n# Relevant Facts")
                for edge in search_results.edges:
                    context_parts.append(f"- {edge.fact}")

            context_text = "\n".join(context_parts) if context_parts else ""

            # Cache the result (upsert - update if exists, insert if not)
            existing = await db.get(ContextCache, req.session_id)
            if existing:
                existing.context_text = context_text
                existing.updated_at = datetime.now(UTC)
            else:
                cache = ContextCache(
                    session_id=req.session_id,
                    context_text=context_text,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
                db.add(cache)
            await db.commit()

            return {"status": "ready", "context": context_text}

        except Exception as e:
            logger.error(f"Knowledge graph search failed: {e}")
            return {"status": "error", "context": "", "error": str(e)}

    # Fallback: return empty context if graph unavailable
    return {"status": "unavailable", "context": ""}


@router.post("/get")
async def context_get(req: ContextGetRequest, db: AsyncSession = Depends(get_db)):
    """Get cached context for session (body)"""
    max_age = req.max_age_minutes or 30
    max_age_seconds = max_age * 60
    min_timestamp = datetime.fromtimestamp(int(time.time()) - max_age_seconds)

    stmt = (
        select(ContextCache.context_text)
        .where(ContextCache.session_id == req.session_id)
        .where(ContextCache.created_at >= min_timestamp)
        .order_by(ContextCache.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    context = result.scalar_one_or_none()

    return {"found": context is not None, "context": context or ""}


@router.get("")
async def context_full(session_id: int | None = None):
    """Get full context string for hook injection."""
    from dere_shared.context import get_full_context

    context = await get_full_context(session_id=session_id)
    return {"context": context}
