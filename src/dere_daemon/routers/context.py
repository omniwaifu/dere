"""Context building and caching endpoints."""

from __future__ import annotations

import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.context_tracking import build_context_metadata
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
    include_citations: bool = True
    citation_limit_per_edge: int = 2
    citation_max_chars: int = 160
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
            # Step 1: Get relevant facts with episode-mentions reranking
            # Recency weighting handles time preference without hard cutoffs
            search_results = await app_state.dere_graph.search(
                query=req.current_prompt,
                group_id=req.user_id or "default",
                limit=context_depth * 2,  # Get more for BFS expansion
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

            if search_results.nodes:
                await app_state.dere_graph.track_entity_retrievals(
                    [node.uuid for node in search_results.nodes]
                )

            citations_lookup = {}
            if req.include_citations and search_results.edges:
                citations = await app_state.dere_graph.get_edge_citations(
                    search_results.edges,
                    group_id=req.user_id or "default",
                    max_episodes_per_edge=req.citation_limit_per_edge,
                )
                citations_lookup = {c.edge_uuid: c.episodes for c in citations}

            fact_citations_lookup = {}
            if req.include_citations and search_results.facts:
                fact_citations = await app_state.dere_graph.get_fact_citations(
                    search_results.facts,
                    group_id=req.user_id or "default",
                    max_episodes_per_fact=req.citation_limit_per_edge,
                )
                fact_citations_lookup = {c.fact_uuid: c.episodes for c in fact_citations}

            fact_roles_lookup = {}
            if search_results.facts:
                fact_roles_lookup = await app_state.dere_graph.get_fact_roles(
                    search_results.facts,
                    group_id=req.user_id or "default",
                )

            def format_citation(episode) -> str:
                header_parts = [episode.name, episode.source_description]
                if episode.valid_at:
                    header_parts.append(episode.valid_at.date().isoformat())
                header = " - ".join([part for part in header_parts if part])
                snippet = " ".join(episode.content.split())
                if req.citation_max_chars > 0 and len(snippet) > req.citation_max_chars:
                    snippet = snippet[: req.citation_max_chars].rstrip() + "..."
                if snippet:
                    return f"{header}: {snippet}"
                return header

            def format_roles(roles) -> str:
                parts = []
                for role in roles:
                    entity_name = getattr(role, "entity_name", "") or ""
                    role_name = getattr(role, "role", "") or ""
                    if not entity_name or not role_name:
                        continue
                    role_desc = getattr(role, "role_description", None)
                    if role_desc:
                        parts.append(f"{role_name}={entity_name} ({role_desc})")
                    else:
                        parts.append(f"{role_name}={entity_name}")
                return "; ".join(parts)

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
                    fact_line = f"- {edge.fact}"
                    if req.include_citations:
                        episodes = citations_lookup.get(edge.uuid, [])
                        if episodes:
                            citations_text = "; ".join(format_citation(ep) for ep in episodes)
                            fact_line = f"{fact_line} (sources: {citations_text})"
                    context_parts.append(fact_line)

            # Add hyper-edge facts with roles
            if search_results.facts:
                context_parts.append("\n# Relevant Events")
                for fact in search_results.facts:
                    fact_line = f"- {fact.fact}"
                    suffixes = []
                    roles_text = format_roles(fact_roles_lookup.get(fact.uuid, []))
                    if roles_text:
                        suffixes.append(f"roles: {roles_text}")
                    if req.include_citations:
                        episodes = fact_citations_lookup.get(fact.uuid, [])
                        if episodes:
                            citations_text = "; ".join(format_citation(ep) for ep in episodes)
                            suffixes.append(f"sources: {citations_text}")
                    if suffixes:
                        fact_line = f"{fact_line} ({'; '.join(suffixes)})"
                    context_parts.append(fact_line)

            context_text = "\n".join(context_parts) if context_parts else ""
            context_metadata = build_context_metadata(
                search_results.nodes,
                search_results.edges,
            )

            # Cache the result (upsert - update if exists, insert if not)
            existing = await db.get(ContextCache, req.session_id)
            if existing:
                existing.context_text = context_text
                existing.context_metadata = context_metadata
                existing.updated_at = datetime.now(UTC)
            else:
                cache = ContextCache(
                    session_id=req.session_id,
                    context_text=context_text,
                    context_metadata=context_metadata,
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
