"""Context building and caching endpoints."""

from __future__ import annotations

import subprocess
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dere_daemon.context_tracking import build_context_metadata
from dere_daemon.dependencies import get_db
from dere_shared.config import load_dere_config
from dere_shared.models import ContextCache, Session

try:
    from dere_graph.filters import ComparisonOperator, DateFilter, SearchFilters
except ImportError:
    # Fallback if dere_graph not installed
    SearchFilters = None
    DateFilter = None
    ComparisonOperator = None

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
                # Merge metadata to preserve session-start flags
                existing_metadata = existing.context_metadata or {}
                existing_metadata.update(context_metadata)
                existing.context_metadata = existing_metadata
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


def _is_code_project_dir(working_dir: str) -> bool:
    """Check if directory looks like a code project."""
    if not working_dir or not working_dir.strip():
        return False

    try:
        path = Path(working_dir)
        if not path.exists() or not path.is_dir():
            return False

        # Check for version control
        if (path / ".git").exists():
            return True

        # Check for common project files
        project_markers = [
            "pyproject.toml",
            "setup.py",
            "package.json",
            "Cargo.toml",
            "go.mod",
            "pom.xml",
            "build.gradle",
            "CMakeLists.txt",
            "Makefile",
        ]

        for marker in project_markers:
            if (path / marker).exists():
                return True

        # Check if under configured code directories
        try:
            config = load_dere_config()
            code_plugin_config = config.get("plugins", {}).get("dere_code", {})
            code_dirs = code_plugin_config.get("directories", [])

            for code_dir in code_dirs:
                code_path = Path(code_dir).expanduser().resolve()
                try:
                    path.resolve().relative_to(code_path)
                    return True  # Path is under a configured code directory
                except ValueError:
                    continue
        except Exception:
            pass

        return False
    except Exception:
        return False


def _detect_session_type(session: Session) -> str:
    """Detect session type based on working_dir and medium.

    Returns: "code" | "conversational"
    """
    # Discord/Telegram are always conversational
    if session.medium in ["discord", "telegram"]:
        return "conversational"

    # Empty working_dir = conversational
    if not session.working_dir or not session.working_dir.strip():
        return "conversational"

    # Check if working_dir is a code project
    if _is_code_project_dir(session.working_dir):
        return "code"

    # Default: conversational (CLI in non-code directory)
    return "conversational"


def _extract_project_name(working_dir: str) -> str | None:
    """Extract project name from working directory path.

    Examples:
        /mnt/data/Code/omni/dere -> "dere"
        /home/user/projects/my-app -> "my-app"
    """
    if not working_dir or not working_dir.strip():
        return None

    try:
        path = Path(working_dir).resolve()
        name = path.name
        # Truncate if too long
        if len(name) > 50:
            return name[:47] + "..."
        return name or None
    except Exception as e:
        logger.warning(f"Failed to extract project name from {working_dir}: {e}")
        return None


def _get_recent_git_commits(working_dir: str, limit: int = 5) -> list[str]:
    """Get recent git commits from project directory.

    Returns empty list if .git doesn't exist or command fails.
    """
    try:
        git_dir = Path(working_dir) / ".git"
        if not git_dir.exists():
            return []

        result = subprocess.run(
            ["git", "log", f"-{limit}", "--oneline", "--no-decorate"],
            cwd=working_dir,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split("\n")
            return [line for line in lines if line.strip()]
        return []
    except Exception as e:
        logger.warning(f"Failed to get git commits from {working_dir}: {e}")
        return []


def _build_code_session_context(
    project_name: str | None,
    kg_results: list,
    git_commits: list[str],
    limit: int = 5,
) -> str:
    """Format code session context as XML."""
    parts = []
    parts.append(f'<session_start_context type="code" project="{project_name or "unknown"}">')

    if kg_results:
        parts.append("  <recent_work>")
        for item in kg_results[:limit]:
            # Handle both nodes and facts
            if hasattr(item, "summary"):
                parts.append(f"    - {item.summary}")
            elif hasattr(item, "fact"):
                parts.append(f"    - {item.fact}")
        parts.append("  </recent_work>")

    if git_commits:
        parts.append("  <recent_commits>")
        for commit in git_commits:
            parts.append(f"    {commit}")
        parts.append("  </recent_commits>")

    parts.append("</session_start_context>")
    return "\n".join(parts)


def _build_conversational_context(kg_results: list, limit: int = 5) -> str:
    """Format conversational session context as XML."""
    parts = []
    parts.append('<session_start_context type="conversational">')

    if kg_results:
        parts.append("  <recent_topics>")
        for item in kg_results[:limit]:
            # Handle both nodes and facts
            if hasattr(item, "summary"):
                parts.append(f"    - {item.name}: {item.summary}")
            elif hasattr(item, "fact"):
                parts.append(f"    - {item.fact}")
        parts.append("  </recent_topics>")

    parts.append("</session_start_context>")
    return "\n".join(parts)


class SessionStartContextRequest(BaseModel):
    session_id: int
    user_id: str | None = None
    working_dir: str | None = None  # Fallback if session doesn't exist
    medium: str | None = None  # Fallback if session doesn't exist


@router.post("/build_session_start")
async def context_build_session_start(
    req: SessionStartContextRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Build session-start context based on session type.

    For code sessions: Recent work in project + git commits (if .git exists)
    For conversational sessions: Recent discussions and entities

    Caches result to avoid re-querying on subsequent prompts.
    """
    app_state = request.app.state

    # Get session from database, create if missing
    stmt = select(Session).where(Session.id == req.session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        # Create session if it doesn't exist (SessionStart may fire before session commit)
        session = Session(
            id=req.session_id,
            working_dir=req.working_dir or "",
            medium=req.medium or "cli",
            start_time=int(time.time()),
            last_activity=datetime.now(UTC),
            user_id=req.user_id,
        )
        db.add(session)
        await db.flush()
        logger.info(f"Created session {req.session_id} for session-start context")

    # Check if already queried (cached)
    existing_cache = await db.get(ContextCache, req.session_id)
    if existing_cache and existing_cache.context_metadata:
        if existing_cache.context_metadata.get("session_start_queried"):
            logger.debug(f"Session-start context already cached for session {req.session_id}")
            return {
                "status": "cached",
                "context": existing_cache.context_metadata.get("session_start_results", ""),
            }

    # Load config
    try:
        config = load_dere_config()
        context_config = config.get("context", {})
        session_start_enabled = context_config.get("session_start_enabled", True)
        session_start_limit = context_config.get("session_start_limit", 5)
        session_start_git_commits = context_config.get("session_start_git_commits", 5)
        session_start_conversational_days = context_config.get(
            "session_start_conversational_days", 30
        )
        session_start_code_days = context_config.get("session_start_code_days", 7)
    except Exception as e:
        logger.warning(f"Failed to load config, using defaults: {e}")
        session_start_enabled = True
        session_start_limit = 5
        session_start_git_commits = 5
        session_start_conversational_days = 30
        session_start_code_days = 7

    # Check if feature is enabled
    if not session_start_enabled:
        logger.debug("Session-start context is disabled in config")
        return {"status": "disabled", "context": ""}

    # Detect session type
    session_type = _detect_session_type(session)
    logger.info(
        f"Building session-start context for session {req.session_id} (type: {session_type})"
    )

    # Initialize variables
    context_text = ""
    kg_results = []
    git_commits = []
    project_name = None

    # Query knowledge graph if available
    if app_state.dere_graph:
        try:
            if session_type == "code":
                # Code session: query for project-specific work
                project_name = _extract_project_name(session.working_dir)
                query = f"recent work in {project_name}" if project_name else "recent code work"

                # Create temporal filter for code lookback window
                filters = None
                if SearchFilters and DateFilter and ComparisonOperator:
                    cutoff_date = datetime.now(UTC) - timedelta(days=session_start_code_days)
                    filters = SearchFilters(
                        created_at=DateFilter(
                            operator=ComparisonOperator.GREATER_THAN_EQUAL, value=cutoff_date
                        )
                    )

                search_results = await app_state.dere_graph.search(
                    query=query,
                    group_id=req.user_id or session.user_id or "default",
                    limit=session_start_limit,
                    rerank_method="episode_mentions",
                    filters=filters,
                )

                # Combine nodes and facts for results
                kg_results = (search_results.nodes or []) + (search_results.facts or [])

                # Get git commits if .git exists
                if session.working_dir:
                    git_commits = _get_recent_git_commits(
                        session.working_dir, limit=session_start_git_commits
                    )

                context_text = _build_code_session_context(
                    project_name, kg_results, git_commits, session_start_limit
                )

            else:
                # Conversational session: query for recent discussions
                query = "recent conversations and entities discussed"

                # Create temporal filter for conversational lookback window
                filters = None
                if SearchFilters and DateFilter and ComparisonOperator:
                    cutoff_date = datetime.now(UTC) - timedelta(
                        days=session_start_conversational_days
                    )
                    filters = SearchFilters(
                        created_at=DateFilter(
                            operator=ComparisonOperator.GREATER_THAN_EQUAL, value=cutoff_date
                        )
                    )

                search_results = await app_state.dere_graph.search(
                    query=query,
                    group_id=req.user_id or session.user_id or "default",
                    limit=session_start_limit,
                    rerank_method="recency",
                    filters=filters,
                )

                kg_results = (search_results.nodes or []) + (search_results.facts or [])
                context_text = _build_conversational_context(kg_results, session_start_limit)

        except Exception as e:
            logger.error(f"Session-start KG search failed: {e}")
            context_text = f'<session_start_context type="{session_type}"><error>Context unavailable</error></session_start_context>'

    # Cache the result
    cache_metadata = {
        "session_start_queried": True,
        "session_start_results": context_text,
        "session_type": session_type,
        "query_timestamp": int(time.time()),
    }

    if existing_cache:
        # Update existing cache metadata
        existing_metadata = existing_cache.context_metadata or {}
        existing_metadata.update(cache_metadata)
        existing_cache.context_metadata = existing_metadata
        existing_cache.updated_at = datetime.now(UTC)
    else:
        # Create new cache entry
        cache = ContextCache(
            session_id=req.session_id,
            context_text="",  # Not used for session-start context
            context_metadata=cache_metadata,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(cache)

    await db.commit()

    return {
        "status": "ready",
        "context": context_text,
        "session_type": session_type,
        "project_name": project_name,
    }


@router.get("")
async def context_full(session_id: int | None = None):
    """Get full context string for hook injection."""
    from dere_shared.context import get_full_context

    context = await get_full_context(session_id=session_id)
    return {"context": context}
