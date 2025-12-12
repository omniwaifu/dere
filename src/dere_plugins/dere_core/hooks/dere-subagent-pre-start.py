#!/usr/bin/env python3
"""
Subagent pre-start hook - injects personality context before subagent execution.
Triggered by PreToolUse event with Task matcher.

This hook:
1. Detects when a subagent is about to be invoked
2. Loads the active personality configuration
3. Injects personality-aware context into the subagent's task description
4. Logs subagent activity to the daemon API
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Add hooks directory to Python path for rpc_client import
hooks_dir = Path(__file__).parent
sys.path.insert(0, str(hooks_dir))

from rpc_client import RPCClient


def load_personality_config(personality_name: str) -> dict | None:
    """Load personality configuration from TOML file."""
    try:
        import tomllib

        # Check common locations for personality configs
        config_paths = [
            Path.cwd() / "src" / "dere_shared" / "personalities" / f"{personality_name}.toml",
            Path.home() / ".config" / "dere" / "personalities" / f"{personality_name}.toml",
        ]

        for config_path in config_paths:
            if config_path.exists():
                with open(config_path, "rb") as f:
                    return tomllib.load(f)

        return None
    except Exception as e:
        with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
            f.write(f"Error loading personality config: {e}\n")
        return None


def format_personality_context(personality_name: str, config: dict | None) -> str:
    """Format personality context for injection into subagent task."""
    if not config:
        return f"[Personality: {personality_name}]"

    # Extract key personality attributes
    identity = config.get("identity", {})
    goals = config.get("goals", [])
    standards = config.get("standards", [])

    context_parts = [f"[Personality: {personality_name}]"]

    if archetype := identity.get("archetype"):
        context_parts.append(f"Archetype: {archetype}")

    if core_traits := identity.get("core_traits"):
        context_parts.append(f"Core traits: {', '.join(core_traits)}")

    if goals:
        context_parts.append(f"Goals: {', '.join(goals[:3])}")  # Top 3 goals

    if standards:
        context_parts.append(f"Standards: {', '.join(standards[:3])}")  # Top 3 standards

    return "\n".join(context_parts)


def main() -> None:
    """Main hook execution."""
    # Debug logging
    with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
        f.write(f"PreToolUse hook called with args: {sys.argv}\n")

    try:
        # Read hook input from stdin
        stdin_data = sys.stdin.read().strip()

        with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
            f.write(f"Stdin data: {stdin_data}\n")

        if not stdin_data:
            with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
                f.write("No stdin data received\n")
            # Return default allow decision
            print(json.dumps({"permissionDecision": "allow"}))
            sys.exit(0)

        hook_data = json.loads(stdin_data)

        # Only process if this is a Task (subagent) call
        tool_name = hook_data.get("tool_name")
        if tool_name != "Task":
            with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
                f.write(f"Not a Task call (tool_name={tool_name}), skipping\n")
            print(json.dumps({"permissionDecision": "allow"}))
            sys.exit(0)

        # Only process if DERE_PERSONALITY is set (this is a dere session)
        personality = os.getenv("DERE_PERSONALITY")
        if not personality:
            with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
                f.write("Skipping - not a dere session (no DERE_PERSONALITY)\n")
            print(json.dumps({"permissionDecision": "allow"}))
            sys.exit(0)

        # Extract tool input
        tool_input = hook_data.get("tool_input", {})
        subagent_type = tool_input.get("subagent_type")
        description = tool_input.get("description", "")
        prompt = tool_input.get("prompt", "")

        with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
            f.write(f"Subagent invocation detected: {subagent_type or 'unknown'}\n")
            f.write(f"Description: {description}\n")

        # Load personality configuration
        config = load_personality_config(personality)
        personality_context = format_personality_context(personality, config)

        # Inject personality context into prompt
        enhanced_prompt = f"""{personality_context}

{prompt}

Remember to maintain personality consistency throughout this subagent task.
"""

        with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
            f.write("Personality context injected into subagent prompt\n")

        # Log subagent invocation to daemon API (optional, non-blocking)
        try:
            session_id = int(os.getenv("DERE_SESSION_ID", "0"))
            if session_id > 0:
                rpc = RPCClient()
                rpc_result = rpc.call_method(
                    "log_subagent_start",
                    {
                        "session_id": session_id,
                        "personality": personality,
                        "subagent_type": subagent_type or "unknown",
                        "description": description,
                    },
                )
                with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
                    f.write(f"Logged subagent start to daemon: {rpc_result}\n")
        except Exception as e:
            # Don't fail hook if logging fails
            with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
                f.write(f"Failed to log subagent start (non-fatal): {e}\n")

        # Return modified input with personality context
        output = {
            "permissionDecision": "allow",
            "updatedInput": {"prompt": enhanced_prompt},
        }

        print(json.dumps(output))

        with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
            f.write("PreToolUse hook completed successfully\n")

    except Exception as e:
        with open("/tmp/dere_subagent_pre_start_debug.log", "a") as f:
            f.write(f"Error in PreToolUse hook: {e}\n")
            import traceback

            f.write(traceback.format_exc())

        # On error, allow the tool to proceed without modification
        print(json.dumps({"permissionDecision": "allow"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
