#!/usr/bin/env python3
"""Entrypoint for sandboxed Claude Code execution.

Reads JSON commands from stdin, outputs JSON events to stdout.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, SystemMessage
from claude_agent_sdk.types import StreamEvent as SDKStreamEvent


def emit(event_type: str, data: dict[str, Any] | None = None) -> None:
    """Emit a JSON event to stdout."""
    event = {"type": event_type}
    if data:
        event["data"] = data
    print(json.dumps(event), flush=True)


def emit_error(message: str, recoverable: bool = True) -> None:
    """Emit an error event."""
    emit("error", {"message": message, "recoverable": recoverable})


class SandboxRunner:
    """Runs Claude Code in sandbox mode."""

    def __init__(self) -> None:
        self._client: ClaudeSDKClient | None = None
        self._settings_file: str | None = None
        self._session_id: str | None = None

    async def initialize(self) -> None:
        """Initialize the Claude SDK client."""
        # Read config from environment
        working_dir = os.environ.get("SANDBOX_WORKING_DIR", "/workspace")
        output_style = os.environ.get("SANDBOX_OUTPUT_STYLE", "default")
        system_prompt = os.environ.get("SANDBOX_SYSTEM_PROMPT", "")
        model = os.environ.get("SANDBOX_MODEL") or None
        thinking_budget_str = os.environ.get("SANDBOX_THINKING_BUDGET")
        thinking_budget = int(thinking_budget_str) if thinking_budget_str else None

        # Get allowed tools from environment (comma-separated)
        allowed_tools_str = os.environ.get("SANDBOX_ALLOWED_TOOLS", "")
        if allowed_tools_str:
            allowed_tools = [t.strip() for t in allowed_tools_str.split(",") if t.strip()]
        else:
            allowed_tools = ["Read", "Write", "Bash", "Edit", "Glob", "Grep"]

        # Fork session ID for continuing previous conversations
        fork_session_id = os.environ.get("SANDBOX_RESUME_SESSION_ID") or None

        # Auto-approve mode for autonomous missions
        auto_approve = os.environ.get("SANDBOX_AUTO_APPROVE") == "1"
        permission_mode = "bypassPermissions" if auto_approve else "acceptEdits"

        # Create settings file
        settings_data = {"outputStyle": output_style}
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(settings_data, f)
            self._settings_file = f.name

        # Find dere-core plugin
        dere_core_path = Path("/app/dere/src/dere_plugins/dere_core")
        plugins: list[dict[str, Any]] = []
        if dere_core_path.exists():
            plugins.append({"type": "local", "path": str(dere_core_path)})

        options = ClaudeAgentOptions(
            cwd=working_dir,
            settings=self._settings_file,
            setting_sources=["user", "project", "local"],
            system_prompt={
                "type": "preset",
                "preset": output_style,
                "append": system_prompt,
            } if system_prompt else None,
            allowed_tools=allowed_tools,
            permission_mode=permission_mode,
            plugins=plugins if plugins else None,
            model=model,
            include_partial_messages=True,
            max_thinking_tokens=thinking_budget,
            fork_session=fork_session_id,
        )

        self._client = ClaudeSDKClient(options=options)
        await self._client.__aenter__()

        emit("ready")

    async def process_query(self, prompt: str) -> None:
        """Process a query and emit events."""
        if not self._client:
            emit_error("Client not initialized", recoverable=False)
            return

        try:
            await self._client.query(prompt)
        except Exception as e:
            emit_error(str(e), recoverable=False)
            return

        response_chunks: list[str] = []
        tool_count = 0
        tool_id_to_name: dict[str, str] = {}

        try:
            async for message in self._client.receive_response():
                # Check for init message with session ID (SystemMessage with subtype="init")
                if isinstance(message, SystemMessage):
                    subtype = getattr(message, "subtype", None)
                    if subtype == "init":
                        session_id = message.data.get("session_id") if hasattr(message, "data") else None
                        if session_id:
                            self._session_id = session_id
                            emit("session_id", {"session_id": self._session_id})
                    continue

                # Handle streaming events
                if isinstance(message, SDKStreamEvent):
                    raw = message.event
                    event_type = raw.get("type", "")

                    if event_type == "content_block_start":
                        # Tool use blocks start here
                        content_block = raw.get("content_block", {})
                        if content_block.get("type") == "tool_use":
                            tool_id = content_block.get("id", "")
                            tool_name = content_block.get("name", "unknown")
                            tool_id_to_name[tool_id] = tool_name
                            tool_count += 1
                            # Emit tool_use - input will be empty initially
                            emit("tool_use", {
                                "id": tool_id,
                                "name": tool_name,
                                "input": {},
                            })

                    elif event_type == "content_block_delta":
                        delta = raw.get("delta", {})
                        delta_type = delta.get("type", "")
                        if delta_type == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                response_chunks.append(text)
                                emit("text", {"text": text})
                        elif delta_type == "thinking_delta":
                            thinking_text = delta.get("thinking", "")
                            if thinking_text:
                                emit("thinking", {"text": thinking_text})
                    continue

                # Handle other message types
                if hasattr(message, "type"):
                    msg_type = message.type
                    if msg_type == "assistant":
                        # Final assistant message
                        if hasattr(message, "message") and hasattr(message.message, "content"):
                            for block in message.message.content:
                                if hasattr(block, "type"):
                                    if block.type == "tool_use":
                                        tool_id_to_name[block.id] = block.name
                                        tool_count += 1
                                        emit("tool_use", {
                                            "id": block.id,
                                            "name": block.name,
                                            "input": block.input,
                                        })
                    elif msg_type == "result":
                        if hasattr(message, "tool_use_id"):
                            tool_name = tool_id_to_name.get(message.tool_use_id, "unknown")
                            is_error = getattr(message, "is_error", False)
                            output = getattr(message, "output", "")
                            emit("tool_result", {
                                "tool_use_id": message.tool_use_id,
                                "name": tool_name,
                                "output": output,
                                "is_error": is_error,
                            })

        except Exception as e:
            emit_error(str(e), recoverable=True)

        response_text = "".join(response_chunks)
        emit("done", {"response_text": response_text, "tool_count": tool_count})

    async def close(self) -> None:
        """Cleanup resources."""
        if self._client:
            await self._client.__aexit__(None, None, None)
            self._client = None

        if self._settings_file:
            try:
                Path(self._settings_file).unlink(missing_ok=True)
            except Exception:
                pass


async def main() -> None:
    """Main loop reading commands from stdin."""
    runner = SandboxRunner()

    try:
        await runner.initialize()
    except Exception as e:
        emit_error(f"Initialization failed: {e}", recoverable=False)
        sys.exit(1)

    # Use async stdin reading for better websocket compatibility
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    try:
        while True:
            line_bytes = await reader.readline()
            if not line_bytes:
                break
            line = line_bytes.decode().strip()
            if not line:
                continue

            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                emit_error(f"Invalid JSON: {e}")
                continue

            cmd_type = cmd.get("type")
            if cmd_type == "query":
                prompt = cmd.get("prompt", "")
                if prompt:
                    await runner.process_query(prompt)
            elif cmd_type == "close":
                break
            else:
                emit_error(f"Unknown command type: {cmd_type}")

    finally:
        await runner.close()


if __name__ == "__main__":
    asyncio.run(main())
