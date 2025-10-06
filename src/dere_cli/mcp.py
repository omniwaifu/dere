from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any


def load_dere_mcp_config(config_dir: Path) -> dict[str, Any]:
    """Load dere MCP configuration"""
    config_path = config_dir / "mcp_config.json"

    if not config_path.exists():
        return {"mcpServers": {}, "profiles": {}}

    with open(config_path) as f:
        config = json.load(f)

    if "mcpServers" not in config:
        config["mcpServers"] = {}
    if "profiles" not in config:
        config["profiles"] = {}

    return config


def resolve_mcp_servers(server_specs: list[str], dere_config: dict[str, Any]) -> list[str]:
    """Resolve server names, profiles, patterns to actual server list"""
    if not server_specs:
        return []

    mcp_servers = dere_config.get("mcpServers", {})
    profiles = dere_config.get("profiles", {})

    resolved = []
    seen = set()

    for spec in server_specs:
        # Check if it's a profile
        if spec in profiles:
            for server_name in profiles[spec].get("servers", []):
                if server_name not in seen:
                    resolved.append(server_name)
                    seen.add(server_name)
            continue

        # Check if it's a direct server name
        if spec in mcp_servers:
            if spec not in seen:
                resolved.append(spec)
                seen.add(spec)
            continue

        # Handle wildcards
        if "*" in spec:
            pattern = spec.replace("*", "")
            for server_name in mcp_servers:
                if pattern in server_name and server_name not in seen:
                    resolved.append(server_name)
                    seen.add(server_name)
            continue

        # Handle tag-based selection
        if spec.startswith("tag:"):
            tag = spec[4:]
            for server_name, server_config in mcp_servers.items():
                if tag in server_config.get("tags", []) and server_name not in seen:
                    resolved.append(server_name)
                    seen.add(server_name)
            continue

        raise ValueError(f"MCP server, profile, or pattern '{spec}' not found")

    return resolved


def build_mcp_config(server_specs: list[str], config_dir: Path) -> str | None:
    """Build filtered MCP config file and return path"""
    if not server_specs:
        return None

    # Load dere MCP config
    dere_config = load_dere_mcp_config(config_dir)

    # Resolve server specs to actual names
    server_names = resolve_mcp_servers(server_specs, dere_config)

    if not server_names:
        return None

    # Build filtered config
    mcp_servers = dere_config.get("mcpServers", {})
    filtered = {"mcpServers": {}}

    for server_name in server_names:
        if server_name not in mcp_servers:
            raise ValueError(f"MCP server '{server_name}' not found in dere config")

        server_config = mcp_servers[server_name]
        # Only include command, args, env for Claude
        filtered["mcpServers"][server_name] = {
            "command": server_config["command"],
            "args": server_config.get("args", []),
        }
        if "env" in server_config:
            filtered["mcpServers"][server_name]["env"] = server_config["env"]

    # Write to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(filtered, f, indent=2)
        return f.name
