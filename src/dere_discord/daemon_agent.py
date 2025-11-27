"""WebSocket client for the daemon's centralized agent API."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import websockets
from loguru import logger
from websockets.asyncio.client import ClientConnection

from dere_shared.agent_models import (
    ClientMessage,
    ClientMessageType,
    SessionConfig,
    StreamEvent,
    StreamEventType,
)


class DaemonAgentClient:
    """WebSocket client for daemon agent API.

    Provides a clean interface for Discord (and other clients) to interact
    with the centralized Claude agent service in the daemon.
    """

    def __init__(self, daemon_url: str = "ws://localhost:8787"):
        self._base_url = daemon_url.rstrip("/")
        self._ws: ClientConnection | None = None
        self._current_session_id: int | None = None
        self._lock = asyncio.Lock()

    @property
    def session_id(self) -> int | None:
        """Current session ID if connected."""
        return self._current_session_id

    @property
    def connected(self) -> bool:
        """Whether WebSocket is connected."""
        return self._ws is not None and self._ws.state.name == "OPEN"

    async def connect(self) -> None:
        """Establish WebSocket connection to daemon."""
        if self.connected:
            return

        async with self._lock:
            if self.connected:
                return

            ws_url = f"{self._base_url}/agent/ws"
            logger.debug("Connecting to daemon agent at {}", ws_url)

            self._ws = await websockets.connect(ws_url)
            logger.info("Connected to daemon agent WebSocket")

    async def close(self) -> None:
        """Close WebSocket connection."""
        async with self._lock:
            if self._ws:
                try:
                    await self._ws.close()
                except Exception as e:
                    logger.debug("Error closing WebSocket: {}", e)
                finally:
                    self._ws = None
                    self._current_session_id = None

    async def _send(self, msg: ClientMessage) -> None:
        """Send a message to the daemon."""
        if not self._ws:
            raise RuntimeError("Not connected to daemon")

        await self._ws.send(msg.to_dict().__str__().replace("'", '"'))

    async def _send_json(self, data: dict[str, Any]) -> None:
        """Send JSON data to the daemon."""
        if not self._ws:
            raise RuntimeError("Not connected to daemon")

        import json

        await self._ws.send(json.dumps(data))

    async def _receive(self) -> StreamEvent:
        """Receive a single event from the daemon."""
        if not self._ws:
            raise RuntimeError("Not connected to daemon")

        import json

        data = await self._ws.recv()
        if isinstance(data, bytes):
            data = data.decode("utf-8")

        parsed = json.loads(data)
        return StreamEvent.from_dict(parsed)

    async def new_session(self, config: SessionConfig) -> int:
        """Create a new agent session.

        Args:
            config: Session configuration

        Returns:
            Session ID

        Raises:
            RuntimeError: If session creation fails
        """
        await self.connect()

        msg = ClientMessage(type=ClientMessageType.NEW_SESSION, config=config)
        await self._send_json(msg.to_dict())

        event = await self._receive()
        if event.type == StreamEventType.SESSION_READY:
            self._current_session_id = event.data.get("session_id")
            logger.info("Created new agent session: {}", self._current_session_id)
            return self._current_session_id
        elif event.type == StreamEventType.ERROR:
            raise RuntimeError(f"Failed to create session: {event.data.get('message')}")
        else:
            raise RuntimeError(f"Unexpected response: {event.type}")

    async def resume_session(self, session_id: int) -> bool:
        """Resume an existing session.

        Args:
            session_id: ID of session to resume

        Returns:
            True if resumed successfully

        Raises:
            RuntimeError: If resume fails
        """
        await self.connect()

        msg = ClientMessage(type=ClientMessageType.RESUME_SESSION, session_id=session_id)
        await self._send_json(msg.to_dict())

        event = await self._receive()
        if event.type == StreamEventType.SESSION_READY:
            self._current_session_id = event.data.get("session_id")
            logger.info("Resumed agent session: {}", self._current_session_id)
            return True
        elif event.type == StreamEventType.ERROR:
            logger.warning("Failed to resume session {}: {}", session_id, event.data.get("message"))
            return False
        else:
            raise RuntimeError(f"Unexpected response: {event.type}")

    async def update_config(self, config: SessionConfig) -> bool:
        """Update current session configuration.

        Args:
            config: New session configuration

        Returns:
            True if updated successfully
        """
        if not self._current_session_id:
            raise RuntimeError("No active session to update")

        msg = ClientMessage(type=ClientMessageType.UPDATE_CONFIG, config=config)
        await self._send_json(msg.to_dict())

        event = await self._receive()
        if event.type == StreamEventType.SESSION_READY:
            logger.info("Updated session config")
            return True
        elif event.type == StreamEventType.ERROR:
            logger.warning("Failed to update config: {}", event.data.get("message"))
            return False
        else:
            raise RuntimeError(f"Unexpected response: {event.type}")

    async def query(self, prompt: str) -> AsyncIterator[StreamEvent]:
        """Send a query and stream response events.

        Args:
            prompt: User prompt to send

        Yields:
            StreamEvent objects as they arrive

        Raises:
            RuntimeError: If no active session
        """
        if not self._current_session_id:
            raise RuntimeError("No active session. Call new_session or resume_session first.")

        msg = ClientMessage(type=ClientMessageType.QUERY, prompt=prompt)
        await self._send_json(msg.to_dict())

        while True:
            event = await self._receive()
            yield event

            if event.type in (StreamEventType.DONE, StreamEventType.ERROR):
                if event.type == StreamEventType.ERROR and not event.data.get("recoverable", True):
                    break
                if event.type == StreamEventType.DONE:
                    break

    async def ensure_session(
        self,
        config: SessionConfig,
        session_id: int | None = None,
    ) -> int:
        """Ensure a session exists, creating or resuming as needed.

        Args:
            config: Session configuration
            session_id: Optional session ID to resume

        Returns:
            Active session ID
        """
        await self.connect()

        if session_id:
            if await self.resume_session(session_id):
                return self._current_session_id

        return await self.new_session(config)
