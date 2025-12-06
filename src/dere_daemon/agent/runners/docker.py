"""Docker session runner for sandboxed Claude execution."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

import aiodocker
from aiohttp import WSMsgType
from loguru import logger

from ..models import StreamEvent
from ..streaming import (
    done_event,
    error_event,
    text_event,
    thinking_event,
    tool_result_event,
    tool_use_event,
)
from .base import SessionRunner

if TYPE_CHECKING:
    from ..models import SessionConfig


class DockerSessionRunner(SessionRunner):
    """Session runner using Docker container for sandboxed execution."""

    def __init__(
        self,
        config: SessionConfig,
        system_prompt: str,
        resume_session_id: str | None = None,
        mount_type: Literal["direct", "copy", "none"] = "copy",
        image: str = "dere-sandbox:latest",
        memory_limit: str = "2g",
        cpu_limit: float = 2.0,
    ):
        self._config = config
        self._system_prompt = system_prompt
        self._resume_session_id = resume_session_id
        self._mount_type = mount_type
        self._image = image
        self._memory_limit = memory_limit
        self._cpu_limit = cpu_limit

        self._docker: aiodocker.Docker | None = None
        self._container: aiodocker.containers.DockerContainer | None = None
        self._ws: Any = None
        self._temp_dir: str | None = None
        self._claude_session_id: str | None = resume_session_id
        self._event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._reader_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the Docker container and initialize communication."""
        self._docker = aiodocker.Docker()

        # Build container configuration
        binds: list[str] = []
        working_dir = "/workspace"

        # Mount Claude config directory (needs write access for debug logs, session state)
        # Mount to /home/user since container runs as non-root
        claude_dir = Path.home() / ".claude"
        if claude_dir.exists():
            binds.append(f"{claude_dir}:/home/user/.claude:rw")

        # Handle working directory mount based on mount_type
        if self._config.working_dir and self._mount_type != "none":
            source_dir = Path(self._config.working_dir)
            if source_dir.exists():
                if self._mount_type == "direct":
                    binds.append(f"{source_dir}:{working_dir}:rw")
                elif self._mount_type == "copy":
                    # Copy to temp directory
                    self._temp_dir = tempfile.mkdtemp(prefix="dere-sandbox-")
                    shutil.copytree(source_dir, Path(self._temp_dir) / "workspace")
                    binds.append(f"{self._temp_dir}/workspace:{working_dir}:rw")

        # Environment variables for the entrypoint
        env = [
            "HOME=/home/user",
            f"SANDBOX_WORKING_DIR={working_dir}",
            f"SANDBOX_OUTPUT_STYLE={self._config.output_style}",
        ]
        if self._system_prompt:
            env.append(f"SANDBOX_SYSTEM_PROMPT={self._system_prompt}")
        if self._config.model:
            env.append(f"SANDBOX_MODEL={self._config.model}")
        if self._config.thinking_budget:
            env.append(f"SANDBOX_THINKING_BUDGET={self._config.thinking_budget}")
        if self._config.allowed_tools:
            env.append(f"SANDBOX_ALLOWED_TOOLS={','.join(self._config.allowed_tools)}")
        if self._resume_session_id:
            env.append(f"SANDBOX_RESUME_SESSION_ID={self._resume_session_id}")
        if self._config.auto_approve:
            env.append("SANDBOX_AUTO_APPROVE=1")

        # Run as host user so files are owned correctly
        uid = os.getuid()
        gid = os.getgid()

        container_config = {
            "Image": self._image,
            "Env": env,
            "WorkingDir": working_dir,
            "User": f"{uid}:{gid}",
            "HostConfig": {
                "Binds": binds,
                "Memory": self._parse_memory_limit(self._memory_limit),
                "NanoCpus": int(self._cpu_limit * 1e9),
                "NetworkMode": "bridge",
            },
            "AttachStdin": True,
            "AttachStdout": True,
            "AttachStderr": True,
            "OpenStdin": True,
            "StdinOnce": False,
            "Tty": False,
        }

        try:
            self._container = await self._docker.containers.create(config=container_config)
            logger.debug("Created sandbox container: {}", self._container.id[:12])
        except aiodocker.exceptions.DockerError as e:
            logger.error("Failed to create sandbox container: {}", e)
            raise RuntimeError(f"Failed to create sandbox container: {e}") from e

        # Get websocket BEFORE starting container (per aiodocker docs)
        self._ws = await self._container.websocket(stdin=True, stdout=True, stderr=True, stream=True)
        logger.info("Websocket connected for container: {}", self._container.id[:12])

        # Now start container
        await self._container.start()
        logger.info("Started sandbox container: {}", self._container.id[:12])

        # Start background reader for websocket messages
        self._reader_task = asyncio.create_task(self._read_ws())

        # Wait for ready signal
        logger.info("Waiting for container ready signal...")
        try:
            event = await asyncio.wait_for(self._event_queue.get(), timeout=30.0)
            logger.info("Received init event: {}", event)
            if event.get("type") != "ready":
                raise RuntimeError(f"Unexpected init event: {event}")
            logger.info("Sandbox container ready")
        except TimeoutError:
            await self.close()
            raise RuntimeError("Sandbox container did not become ready in time")

    def _parse_memory_limit(self, limit: str) -> int:
        """Parse memory limit string to bytes."""
        limit = limit.lower().strip()
        if limit.endswith("g"):
            return int(float(limit[:-1]) * 1024 * 1024 * 1024)
        elif limit.endswith("m"):
            return int(float(limit[:-1]) * 1024 * 1024)
        elif limit.endswith("k"):
            return int(float(limit[:-1]) * 1024)
        return int(limit)

    async def _read_ws(self) -> None:
        """Background task to read JSON events from container via websocket."""
        buffer = ""
        logger.info("WebSocket reader started")
        try:
            while True:
                msg = await self._ws.receive()
                if msg.type == WSMsgType.BINARY:
                    text = msg.data.decode("utf-8", errors="replace")
                    buffer += text
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            event = json.loads(line)
                            logger.info("Parsed event from container: type={}", event.get("type"))
                            await self._event_queue.put(event)
                        except json.JSONDecodeError:
                            logger.warning("Invalid JSON from container: {}", line[:100])
                elif msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Error reading from container websocket: {}", e)
            await self._event_queue.put({"type": "error", "data": {"message": str(e)}})

    async def query(self, prompt: str) -> None:
        """Send a query to the container."""
        if not self._ws:
            raise RuntimeError("Container not started")

        cmd = json.dumps({"type": "query", "prompt": prompt}) + "\n"
        logger.info("Sending query to container: {} bytes", len(cmd))
        await self._ws.send_bytes(cmd.encode())
        logger.info("Query sent to container")

    async def receive_response(self) -> AsyncIterator[StreamEvent | _DockerInitMessage]:
        """Yield events from the container."""
        logger.info("Starting to receive response from container")
        while True:
            try:
                event = await asyncio.wait_for(self._event_queue.get(), timeout=300.0)
            except TimeoutError:
                logger.warning("Container response timeout")
                break

            event_type = event.get("type")
            data = event.get("data", {})
            logger.info("Container event: type={}, data_keys={}", event_type, list(data.keys()) if data else [])

            if event_type == "done":
                yield done_event(
                    data.get("response_text", ""),
                    data.get("tool_count", 0),
                )
                break
            elif event_type == "error":
                logger.error("Container error: {}", data.get("message"))
                recoverable = data.get("recoverable", True)
                yield error_event(data.get("message", "Unknown error"), recoverable)
                if not recoverable:
                    break
            elif event_type == "session_id":
                self._claude_session_id = data.get("session_id")
                # Yield special init message for session ID capture
                yield _DockerInitMessage(self._claude_session_id)
            elif event_type == "text":
                text = data.get("text", "")
                if text:
                    yield text_event(text)
            elif event_type == "thinking":
                text = data.get("text", "")
                if text:
                    yield thinking_event(text)
            elif event_type == "tool_use":
                yield tool_use_event(
                    data.get("name", "unknown"),
                    data.get("input", {}),
                )
            elif event_type == "tool_result":
                yield tool_result_event(
                    data.get("name", "unknown"),
                    data.get("output", ""),
                    data.get("is_error", False),
                )

    async def close(self) -> None:
        """Stop container and cleanup resources."""
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
            self._reader_task = None

        if self._ws:
            try:
                cmd = json.dumps({"type": "close"}) + "\n"
                await self._ws.send_bytes(cmd.encode())
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

        if self._container:
            try:
                await self._container.stop()
                await self._container.delete(force=True)
                logger.debug("Stopped and removed sandbox container")
            except Exception as e:
                logger.warning("Error cleaning up container: {}", e)
            self._container = None

        if self._docker:
            await self._docker.close()
            self._docker = None

        if self._temp_dir:
            try:
                shutil.rmtree(self._temp_dir)
            except Exception as e:
                logger.debug("Failed to cleanup temp dir: {}", e)
            self._temp_dir = None

    @property
    def claude_session_id(self) -> str | None:
        return self._claude_session_id

    @claude_session_id.setter
    def claude_session_id(self, value: str) -> None:
        self._claude_session_id = value


# Init message for session ID capture (special case, not a StreamEvent)
class _DockerInitMessage:
    """Signals session ID was received from container."""

    type = "init"

    def __init__(self, session_id: str | None):
        self.session_id = session_id
