"""Async client for interacting with the dere daemon."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

import httpx


class DaemonError(RuntimeError):
    """Raised when the daemon returns an unexpected response."""


class ConversationCapturePayload(TypedDict, total=False):
    session_id: int
    personality: str
    project_path: str
    prompt: str
    message_type: Literal["user", "assistant", "system"]
    command_name: str | None
    command_args: str | None
    exit_code: int
    is_command: bool


class SessionEndPayload(TypedDict, total=False):
    session_id: int
    exit_reason: str
    duration_seconds: int


@dataclass(slots=True)
class DaemonClient:
    """Minimal HTTP client for the dere daemon REST API."""

    base_url: str = "http://localhost:8787"
    timeout: float = 10.0
    _client: httpx.AsyncClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)

    async def close(self) -> None:
        await self._client.aclose()

    async def health(self) -> dict[str, Any]:
        resp = await self._client.get("/health")
        resp.raise_for_status()
        return resp.json()

    async def create_session(self, working_dir: str, personality: str) -> int:
        payload = {
            "working_dir": working_dir,
            "personality": personality,
            "medium": "discord",
        }
        resp = await self._client.post("/sessions/create", json=payload)
        resp.raise_for_status()
        data = resp.json()
        try:
            return int(data["session_id"])
        except (KeyError, ValueError, TypeError) as exc:
            raise DaemonError(f"Invalid session response: {data!r}") from exc

    async def find_or_create_session(
        self, working_dir: str, personality: str, max_age_hours: int | None = None
    ) -> tuple[int, bool, str | None]:
        """Find existing session or create new one.

        Returns:
            Tuple of (session_id, resumed, claude_session_id) where:
            - session_id: daemon session ID
            - resumed: True if existing session was found
            - claude_session_id: Claude SDK session ID (if exists)
        """
        payload = {
            "working_dir": working_dir,
            "personality": personality,
            "medium": "discord",
            "max_age_hours": max_age_hours,
        }
        resp = await self._client.post("/sessions/find_or_create", json=payload)
        resp.raise_for_status()
        data = resp.json()
        try:
            return (
                int(data["session_id"]),
                bool(data["resumed"]),
                data.get("claude_session_id"),
            )
        except (KeyError, ValueError, TypeError) as exc:
            raise DaemonError(f"Invalid session response: {data!r}") from exc

    async def update_claude_session_id(self, session_id: int, claude_session_id: str) -> None:
        """Update the Claude SDK session ID for a daemon session.

        Args:
            session_id: Daemon session ID
            claude_session_id: Claude SDK session ID to store
        """
        resp = await self._client.post(
            f"/sessions/{session_id}/claude_session",
            json=claude_session_id,  # Send as JSON string
        )
        resp.raise_for_status()

    async def capture_message(self, payload: ConversationCapturePayload) -> None:
        resp = await self._client.post("/conversation/capture", json=payload)
        resp.raise_for_status()

    async def end_session(self, payload: SessionEndPayload) -> dict[str, Any]:
        resp = await self._client.post("/session/end", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def queue_summary(self, session_id: int) -> dict[str, Any]:
        payload: SessionEndPayload = {
            "session_id": session_id,
            "exit_reason": "idle_timeout",
            "duration_seconds": 0,
        }
        return await self.end_session(payload)
