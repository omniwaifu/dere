"""Swarm management endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

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
from dere_shared.models import Swarm, SwarmAgent, SwarmScratchpadEntry, SwarmStatus

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
            auto_synthesize=req.auto_synthesize,
            synthesis_prompt=req.synthesis_prompt,
            skip_synthesis_on_failure=req.skip_synthesis_on_failure,
            auto_supervise=req.auto_supervise,
            supervisor_warn_seconds=req.supervisor_warn_seconds,
            supervisor_cancel_seconds=req.supervisor_cancel_seconds,
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


# --- Scratchpad Endpoints ---


class ScratchpadEntry(BaseModel):
    """A scratchpad entry."""

    key: str
    value: Any
    set_by_agent_id: int | None
    set_by_agent_name: str | None
    created_at: datetime
    updated_at: datetime


class ScratchpadSetRequest(BaseModel):
    """Request to set a scratchpad value."""

    value: Any
    agent_id: int | None = None
    agent_name: str | None = None


@router.get("/{swarm_id}/scratchpad", response_model=list[ScratchpadEntry])
async def list_scratchpad(
    swarm_id: int,
    db: AsyncSession = Depends(get_db),
    prefix: str | None = None,
):
    """List all scratchpad entries for a swarm, optionally filtered by key prefix."""
    # Verify swarm exists
    result = await db.execute(select(Swarm).where(Swarm.id == swarm_id))
    swarm = result.scalar_one_or_none()
    if not swarm:
        raise HTTPException(status_code=404, detail=f"Swarm {swarm_id} not found")

    stmt = select(SwarmScratchpadEntry).where(SwarmScratchpadEntry.swarm_id == swarm_id)
    if prefix:
        stmt = stmt.where(SwarmScratchpadEntry.key.startswith(prefix))
    stmt = stmt.order_by(SwarmScratchpadEntry.key)

    result = await db.execute(stmt)
    entries = result.scalars().all()

    return [
        ScratchpadEntry(
            key=e.key,
            value=e.value,
            set_by_agent_id=e.set_by_agent_id,
            set_by_agent_name=e.set_by_agent_name,
            created_at=e.created_at,
            updated_at=e.updated_at,
        )
        for e in entries
    ]


@router.get("/{swarm_id}/scratchpad/{key:path}", response_model=ScratchpadEntry)
async def get_scratchpad_entry(
    swarm_id: int,
    key: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific scratchpad entry by key."""
    result = await db.execute(
        select(SwarmScratchpadEntry).where(
            SwarmScratchpadEntry.swarm_id == swarm_id,
            SwarmScratchpadEntry.key == key,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found in swarm {swarm_id}")

    return ScratchpadEntry(
        key=entry.key,
        value=entry.value,
        set_by_agent_id=entry.set_by_agent_id,
        set_by_agent_name=entry.set_by_agent_name,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.put("/{swarm_id}/scratchpad/{key:path}", response_model=ScratchpadEntry)
async def set_scratchpad_entry(
    swarm_id: int,
    key: str,
    req: ScratchpadSetRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set or update a scratchpad entry."""
    from datetime import UTC, datetime

    # Verify swarm exists
    result = await db.execute(select(Swarm).where(Swarm.id == swarm_id))
    swarm = result.scalar_one_or_none()
    if not swarm:
        raise HTTPException(status_code=404, detail=f"Swarm {swarm_id} not found")

    # Check if entry exists
    result = await db.execute(
        select(SwarmScratchpadEntry).where(
            SwarmScratchpadEntry.swarm_id == swarm_id,
            SwarmScratchpadEntry.key == key,
        )
    )
    entry = result.scalar_one_or_none()

    now = datetime.now(UTC)
    if entry:
        # Update existing
        entry.value = req.value
        entry.set_by_agent_id = req.agent_id
        entry.set_by_agent_name = req.agent_name
        entry.updated_at = now
    else:
        # Create new
        entry = SwarmScratchpadEntry(
            swarm_id=swarm_id,
            key=key,
            value=req.value,
            set_by_agent_id=req.agent_id,
            set_by_agent_name=req.agent_name,
            created_at=now,
            updated_at=now,
        )
        db.add(entry)

    await db.commit()
    await db.refresh(entry)

    return ScratchpadEntry(
        key=entry.key,
        value=entry.value,
        set_by_agent_id=entry.set_by_agent_id,
        set_by_agent_name=entry.set_by_agent_name,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.delete("/{swarm_id}/scratchpad/{key:path}")
async def delete_scratchpad_entry(
    swarm_id: int,
    key: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a scratchpad entry."""
    result = await db.execute(
        select(SwarmScratchpadEntry).where(
            SwarmScratchpadEntry.swarm_id == swarm_id,
            SwarmScratchpadEntry.key == key,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Key '{key}' not found in swarm {swarm_id}")

    await db.delete(entry)
    await db.commit()

    return {"deleted": True, "key": key}
