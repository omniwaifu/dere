"""Swarm management endpoints."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from dere_daemon.dependencies import get_db
from dere_daemon.swarm.models import (
    AgentResult,
    CreateSwarmRequest,
    CreateSwarmResponse,
    MergeRequest,
    MergeResult,
    SwarmStatusResponse,
    WaitRequest,
)
from dere_shared.models import Swarm, SwarmAgent, SwarmStatus

router = APIRouter(prefix="/swarm", tags=["swarm"])


class SwarmListResponse(BaseModel):
    """Swarm list item."""

    id: int
    name: str
    description: str | None
    status: str
    agent_count: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ListPersonalitiesResponse(BaseModel):
    """Available personalities response."""

    personalities: list[str]


class PluginInfo(BaseModel):
    """Plugin metadata."""

    name: str
    version: str
    description: str
    has_mcp_servers: bool
    mcp_servers: list[str]


class ListPluginsResponse(BaseModel):
    """Available plugins response."""

    plugins: list[PluginInfo]


@router.post("/create", response_model=CreateSwarmResponse)
async def create_swarm(
    req: CreateSwarmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new swarm with agents.

    If auto_start is True (default), the swarm will start executing immediately.
    """
    # Anti-recursion: check if caller is a swarm agent
    if req.parent_session_id:
        result = await db.execute(
            select(SwarmAgent.id).where(SwarmAgent.session_id == req.parent_session_id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=403,
                detail="Swarm agents cannot spawn new swarms",
            )

    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        swarm = await coordinator.create_swarm(
            parent_session_id=req.parent_session_id,
            name=req.name,
            working_dir=req.working_dir,
            agents=req.agents,
            description=req.description,
            git_branch_prefix=req.git_branch_prefix,
            base_branch=req.base_branch,
        )

        if req.auto_start:
            await coordinator.start_swarm(swarm.id)

        # Build agent info
        agent_info = [
            {"id": a.id, "name": a.name, "status": a.status}
            for a in swarm.agents
        ]

        logger.info("Created swarm '{}' (id={}) with {} agents", swarm.name, swarm.id, len(agent_info))

        return CreateSwarmResponse(
            swarm_id=swarm.id,
            name=swarm.name,
            status=SwarmStatus(swarm.status),
            agents=agent_info,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("", response_model=list[SwarmListResponse])
async def list_swarms(
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
    limit: int = 50,
):
    """List swarms, optionally filtered by status."""
    stmt = (
        select(Swarm)
        .options(selectinload(Swarm.agents))
        .order_by(Swarm.created_at.desc())
        .limit(limit)
    )

    if status:
        stmt = stmt.where(Swarm.status == status)

    result = await db.execute(stmt)
    swarms = result.scalars().all()

    return [
        SwarmListResponse(
            id=s.id,
            name=s.name,
            description=s.description,
            status=s.status,
            agent_count=len(s.agents),
            created_at=s.created_at,
            started_at=s.started_at,
            completed_at=s.completed_at,
        )
        for s in swarms
    ]


@router.get("/personalities", response_model=ListPersonalitiesResponse)
async def list_personalities(request: Request):
    """List available personalities for swarm agents."""
    from dere_shared.personalities import PersonalityLoader

    try:
        loader = PersonalityLoader()
        personalities = loader.list_available()
        return ListPersonalitiesResponse(personalities=personalities)
    except Exception as e:
        logger.warning("Failed to load personalities: {}", e)
        return ListPersonalitiesResponse(personalities=[])


@router.get("/plugins", response_model=ListPluginsResponse)
async def list_plugins():
    """List available plugins for swarm agents.

    Scans the dere_plugins directory and returns metadata from each plugin.json.
    """
    import json
    from importlib.util import find_spec
    from pathlib import Path

    plugins: list[PluginInfo] = []

    # Find plugins directory - dere_plugins is a namespace package so __file__ is None
    spec = find_spec("dere_plugins")
    if not spec or not spec.submodule_search_locations:
        return ListPluginsResponse(plugins=[])
    plugins_dir = Path(spec.submodule_search_locations[0])

    for plugin_dir in plugins_dir.iterdir():
        if not plugin_dir.is_dir() or plugin_dir.name.startswith("_"):
            continue

        plugin_json = plugin_dir / ".claude-plugin" / "plugin.json"
        if not plugin_json.exists():
            continue

        try:
            data = json.loads(plugin_json.read_text())
            mcp_servers = list(data.get("mcpServers", {}).keys())
            plugins.append(
                PluginInfo(
                    name=plugin_dir.name,
                    version=data.get("version", "0.0.0"),
                    description=data.get("description", ""),
                    has_mcp_servers=bool(mcp_servers),
                    mcp_servers=mcp_servers,
                )
            )
        except Exception as e:
            logger.warning("Failed to load plugin {}: {}", plugin_dir.name, e)

    return ListPluginsResponse(plugins=plugins)


@router.get("/{swarm_id}", response_model=SwarmStatusResponse)
async def get_swarm(
    swarm_id: int,
    request: Request,
):
    """Get swarm status including all agents."""
    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        return await coordinator.get_swarm_status(swarm_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/{swarm_id}/start")
async def start_swarm(
    swarm_id: int,
    request: Request,
):
    """Start executing a pending swarm."""
    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        await coordinator.start_swarm(swarm_id)
        return {"status": "started", "swarm_id": swarm_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{swarm_id}/wait", response_model=list[AgentResult])
async def wait_for_swarm(
    swarm_id: int,
    req: WaitRequest,
    request: Request,
):
    """Wait for agents to complete.

    This is a blocking call that returns when the specified agents finish
    or the timeout is reached.
    """
    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        return await coordinator.wait_for_agents(
            swarm_id=swarm_id,
            agent_names=req.agent_names,
            timeout=req.timeout_seconds,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/{swarm_id}/agent/{agent_name}", response_model=AgentResult)
async def get_agent(
    swarm_id: int,
    agent_name: str,
    request: Request,
):
    """Get output from a specific agent."""
    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        return await coordinator.get_agent_output(swarm_id, agent_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/{swarm_id}/cancel")
async def cancel_swarm(
    swarm_id: int,
    request: Request,
):
    """Cancel all running/pending agents in the swarm."""
    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        await coordinator.cancel_swarm(swarm_id)
        return {"status": "cancelled", "swarm_id": swarm_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/{swarm_id}/merge", response_model=MergeResult)
async def merge_branches(
    swarm_id: int,
    req: MergeRequest,
    request: Request,
):
    """Merge agent branches back to target branch."""
    coordinator = getattr(request.app.state, "swarm_coordinator", None)
    if not coordinator:
        raise HTTPException(status_code=503, detail="Swarm coordinator not available")

    try:
        return await coordinator.merge_branches(
            swarm_id=swarm_id,
            target_branch=req.target_branch,
            strategy=req.strategy,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
