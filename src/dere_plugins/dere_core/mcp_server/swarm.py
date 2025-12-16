"""FastMCP server for swarm agent coordination.

This MCP server exposes tools for spawning and managing swarm agents.
It communicates with the dere daemon via HTTP API.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastmcp import FastMCP

DAEMON_URL = os.environ.get("DERE_DAEMON_URL", "http://localhost:8787")
PARENT_SESSION_ID = os.environ.get("DERE_SESSION_ID")

mcp = FastMCP("Swarm Agent Coordinator")


def _get_session_id() -> int:
    """Get parent session ID from environment."""
    if not PARENT_SESSION_ID:
        raise RuntimeError(
            "spawn_agents can only be called from a dere session. "
            "DERE_SESSION_ID environment variable not set."
        )
    return int(PARENT_SESSION_ID)


@mcp.tool()
async def spawn_agents(
    swarm_name: str,
    agents: list[dict[str, Any]],
    description: str | None = None,
    git_branch_prefix: str | None = None,
    base_branch: str | None = None,
    working_dir: str | None = None,
    auto_start: bool = True,
    auto_synthesize: bool = False,
    synthesis_prompt: str | None = None,
    skip_synthesis_on_failure: bool = False,
) -> dict:
    """
    Spawn a swarm of background agents to work on tasks.

    By default, agents start executing immediately (auto_start=True).
    You do NOT need to call start_swarm after this - just use wait_for_agents.

    Args:
        swarm_name: Name for this swarm (e.g., "implement-auth-feature")
        agents: List of agent specs, each with:
            - name: Agent identifier (e.g., "auth-backend")
            - prompt: Task prompt for the agent
            - role: "implementation", "review", "research", or "generic" (default)
            - personality: Optional personality preset (e.g., "tsun", "kuu", "yan")
            - plugins: Optional plugin list (e.g., ["dere_code"]). None for lean mode.
            - depends_on: List of agent names this depends on
            - model: Optional model override
            - thinking_budget: Optional thinking token budget
            - sandbox_mode: Run in sandbox (default: True)
        description: Optional swarm description
        git_branch_prefix: If set, each agent gets its own git branch
        base_branch: Base branch to create from (default: current branch)
        working_dir: Working directory (defaults to current)
        auto_start: Whether to start immediately (default: True). Only set False
            if you need to inspect the swarm before starting.
        auto_synthesize: If True, spawn a synthesis agent that runs after all others
            complete to aggregate results and create follow-up tasks
        synthesis_prompt: Custom prompt for synthesis agent (auto-generated if None)
        skip_synthesis_on_failure: If True, skip synthesis if any agent failed

    Returns:
        Swarm info with ID and agent IDs. Status will be "running" if auto_start=True.
    """
    session_id = _get_session_id()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/swarm/create",
            json={
                "parent_session_id": session_id,
                "name": swarm_name,
                "description": description,
                "working_dir": working_dir or os.getcwd(),
                "git_branch_prefix": git_branch_prefix,
                "base_branch": base_branch,
                "agents": agents,
                "auto_start": auto_start,
                "auto_synthesize": auto_synthesize,
                "synthesis_prompt": synthesis_prompt,
                "skip_synthesis_on_failure": skip_synthesis_on_failure,
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def start_swarm(swarm_id: int) -> dict:
    """
    Start executing a pending swarm's agents.

    NOTE: You usually don't need this. spawn_agents() auto-starts by default.
    Only use this if you created a swarm with auto_start=False.

    Args:
        swarm_id: The swarm ID from spawn_agents

    Returns:
        Status update
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/swarm/{swarm_id}/start",
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def get_swarm_status(swarm_id: int) -> dict:
    """
    Get status of swarm and all agents.

    Args:
        swarm_id: The swarm ID

    Returns:
        Full status including each agent's progress
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/swarm/{swarm_id}",
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def wait_for_agents(
    swarm_id: int,
    agent_names: list[str] | None = None,
    timeout_seconds: float | None = None,
) -> dict:
    """
    Wait for agents to complete.

    This is a blocking call that returns when the specified agents finish
    or the timeout is reached.

    Args:
        swarm_id: The swarm ID
        agent_names: Specific agents to wait for (None = all)
        timeout_seconds: Max time to wait

    Returns:
        Dict with "agents" key containing list of agent results
    """
    # Set request timeout slightly higher than wait timeout
    request_timeout = (timeout_seconds + 30) if timeout_seconds else None

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/swarm/{swarm_id}/wait",
            json={
                "agent_names": agent_names,
                "timeout_seconds": timeout_seconds,
            },
            timeout=request_timeout,
        )
        resp.raise_for_status()
        return {"agents": resp.json()}


@mcp.tool()
async def get_agent_output(swarm_id: int, agent_name: str) -> dict:
    """
    Get full output from a specific agent.

    Args:
        swarm_id: The swarm ID
        agent_name: Name of the agent

    Returns:
        Agent's full output text and summary
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/swarm/{swarm_id}/agent/{agent_name}",
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def cancel_swarm(swarm_id: int) -> dict:
    """
    Cancel all running/pending agents in a swarm.

    Args:
        swarm_id: The swarm ID

    Returns:
        Cancellation status
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/swarm/{swarm_id}/cancel",
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def merge_agent_branches(
    swarm_id: int,
    target_branch: str = "main",
    strategy: str = "sequential",
) -> dict:
    """
    Merge agent branches back to target branch.

    Only merges branches from successfully completed agents.

    Args:
        swarm_id: The swarm ID
        target_branch: Branch to merge into (default: main)
        strategy: Merge strategy - "sequential" (one by one)

    Returns:
        Merge results including any conflicts
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{DAEMON_URL}/swarm/{swarm_id}/merge",
            json={
                "target_branch": target_branch,
                "strategy": strategy,
            },
            timeout=300.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def list_personalities() -> dict:
    """
    List available personalities for swarm agents.

    Returns:
        List of personality names (e.g., "tsun", "kuu", "yan", "dan")
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/swarm/personalities",
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def list_plugins() -> dict:
    """
    List available plugins that can be assigned to swarm agents.

    Each plugin provides different capabilities:
    - dere_core: Personality, emotion, memory (always recommended)
    - dere_code: Symbol-aware code navigation, refactoring tools
    - dere_productivity: Task management, calendar integration
    - dere_vault: Obsidian/Zettelkasten knowledge vault tools
    - dere_graph_features: Knowledge graph extraction utilities

    Use plugins=[] for lean research agents that only need web access.
    Use plugins=["dere_code"] for coding agents.

    Returns:
        List of plugins with name, description, and available MCP servers
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/swarm/plugins",
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()


# --- Scratchpad Tools (only available in swarm context) ---


def _get_swarm_context() -> tuple[int, int] | None:
    """Get (swarm_id, agent_id) if running as a swarm agent."""
    swarm_id = os.environ.get("DERE_SWARM_ID")
    agent_id = os.environ.get("DERE_SWARM_AGENT_ID")
    if swarm_id and agent_id:
        return int(swarm_id), int(agent_id)
    return None


def _require_swarm_context() -> tuple[int, int]:
    """Require swarm context, raise if not running as a swarm agent."""
    ctx = _get_swarm_context()
    if not ctx:
        raise RuntimeError(
            "Scratchpad tools are only available when running as a swarm agent. "
            "DERE_SWARM_ID and DERE_SWARM_AGENT_ID environment variables not set."
        )
    return ctx


@mcp.tool()
async def scratchpad_set(key: str, value: Any) -> dict:
    """
    Share a value with other agents in this swarm via the scratchpad.

    Use for emergent coordination:
    - Discoveries: "auth_location" -> {"path": "src/auth/", "framework": "JWT"}
    - Decisions: "api_style" -> {"choice": "REST", "reason": "matches existing patterns"}
    - Warnings: "blocked_files" -> ["src/config.py", "src/secrets.py"]

    Only available when running as a swarm agent.

    Args:
        key: A string key (use namespacing by convention, e.g., "discoveries/auth")
        value: Any JSON-serializable value

    Returns:
        The stored entry with metadata
    """
    swarm_id, agent_id = _require_swarm_context()

    # Get agent name for provenance
    async with httpx.AsyncClient() as client:
        # Get agent info to include name
        status_resp = await client.get(
            f"{DAEMON_URL}/swarm/{swarm_id}",
            timeout=10.0,
        )
        status_resp.raise_for_status()
        status = status_resp.json()

        agent_name = None
        for agent in status.get("agents", []):
            if agent.get("id") == agent_id:
                agent_name = agent.get("name")
                break

        # Set the scratchpad entry
        resp = await client.put(
            f"{DAEMON_URL}/swarm/{swarm_id}/scratchpad/{key}",
            json={
                "value": value,
                "agent_id": agent_id,
                "agent_name": agent_name,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def scratchpad_get(key: str) -> dict | None:
    """
    Get a value from the swarm scratchpad.

    Only available when running as a swarm agent.

    Args:
        key: The key to retrieve

    Returns:
        The entry with value and metadata, or None if not found
    """
    swarm_id, _ = _require_swarm_context()

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/swarm/{swarm_id}/scratchpad/{key}",
            timeout=30.0,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def scratchpad_list(prefix: str | None = None) -> list[dict]:
    """
    List all scratchpad entries in this swarm.

    Only available when running as a swarm agent.

    Args:
        prefix: Optional key prefix to filter by (e.g., "discoveries/")

    Returns:
        List of entries with key, value, set_by info, and timestamps
    """
    swarm_id, _ = _require_swarm_context()

    params = {}
    if prefix:
        params["prefix"] = prefix

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{DAEMON_URL}/swarm/{swarm_id}/scratchpad",
            params=params,
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def scratchpad_delete(key: str) -> dict:
    """
    Delete a key from the swarm scratchpad.

    Only available when running as a swarm agent.

    Args:
        key: The key to delete

    Returns:
        Confirmation of deletion
    """
    swarm_id, _ = _require_swarm_context()

    async with httpx.AsyncClient() as client:
        resp = await client.delete(
            f"{DAEMON_URL}/swarm/{swarm_id}/scratchpad/{key}",
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
