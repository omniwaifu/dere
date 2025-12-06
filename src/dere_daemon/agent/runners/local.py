"""Local session runner using ClaudeSDKClient."""

from __future__ import annotations

import json
import tempfile
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from pathlib import Path
from typing import TYPE_CHECKING, Any

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from loguru import logger

from .base import PermissionCallback, SessionRunner

if TYPE_CHECKING:
    from ..models import SessionConfig


class LocalSessionRunner(SessionRunner):
    """Session runner using local ClaudeSDKClient."""

    def __init__(
        self,
        config: SessionConfig,
        system_prompt: str,
        permission_callback: PermissionCallback | None = None,
        resume_session_id: str | None = None,
        dere_core_plugin_path: str | None = None,
    ):
        self._config = config
        self._system_prompt = system_prompt
        self._permission_callback = permission_callback
        self._resume_session_id = resume_session_id
        self._dere_core_plugin_path = dere_core_plugin_path

        self._client: ClaudeSDKClient | None = None
        self._exit_stack: AsyncExitStack | None = None
        self._settings_file: str | None = None
        self._claude_session_id: str | None = resume_session_id

    async def start(self) -> None:
        """Initialize ClaudeSDKClient."""
        self._exit_stack = AsyncExitStack()

        # Create settings file
        settings_data = {"outputStyle": self._config.output_style}
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(settings_data, f)
            self._settings_file = f.name

        # Determine allowed tools
        allowed_tools = self._config.allowed_tools
        if allowed_tools is None:
            allowed_tools = ["Read", "Write", "Bash", "Edit", "Glob", "Grep"]

        # Build plugins list
        plugins: list[dict[str, Any]] = []
        if self._dere_core_plugin_path:
            plugins.append({"type": "local", "path": self._dere_core_plugin_path})

        # Use bypassPermissions for auto-approve sessions (e.g., missions)
        permission_mode = "bypassPermissions" if self._config.auto_approve else "acceptEdits"

        options = ClaudeAgentOptions(
            cwd=self._config.working_dir,
            settings=self._settings_file,
            setting_sources=["user", "project", "local"],
            system_prompt={
                "type": "preset",
                "preset": self._config.output_style,
                "append": self._system_prompt,
            },
            allowed_tools=allowed_tools,
            permission_mode=permission_mode,
            resume=self._resume_session_id,
            plugins=plugins if plugins else None,
            model=self._config.model,
            include_partial_messages=self._config.enable_streaming,
            can_use_tool=self._permission_callback if not self._config.auto_approve else None,
            max_thinking_tokens=self._config.thinking_budget,
        )

        self._client = ClaudeSDKClient(options=options)
        await self._exit_stack.enter_async_context(self._client)

        logger.debug(
            "LocalSessionRunner started with model={}, thinking_budget={}",
            self._config.model or "default",
            self._config.thinking_budget,
        )

    async def query(self, prompt: str) -> None:
        """Submit a query to Claude."""
        if not self._client:
            raise RuntimeError("Runner not started")
        await self._client.query(prompt)

    async def receive_response(self) -> AsyncIterator[Any]:
        """Yield messages from Claude SDK."""
        if not self._client:
            raise RuntimeError("Runner not started")
        async for message in self._client.receive_response():
            yield message

    async def close(self) -> None:
        """Cleanup resources."""
        if self._exit_stack:
            await self._exit_stack.aclose()
            self._exit_stack = None

        if self._settings_file:
            try:
                Path(self._settings_file).unlink(missing_ok=True)
            except Exception as e:
                logger.debug("Failed to cleanup settings file: {}", e)
            self._settings_file = None

        self._client = None
        logger.debug("LocalSessionRunner closed")

    @property
    def claude_session_id(self) -> str | None:
        return self._claude_session_id

    @claude_session_id.setter
    def claude_session_id(self, value: str) -> None:
        self._claude_session_id = value
