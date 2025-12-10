"""Async client for interacting with the dere daemon."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

import httpx

from dere_shared.constants import DEFAULT_DAEMON_URL


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
    medium: str
    user_id: str | None


class SessionEndPayload(TypedDict):
    session_id: int


@dataclass(slots=True)
class DaemonClient:
    """Minimal HTTP client for the dere daemon REST API."""

    base_url: str = DEFAULT_DAEMON_URL
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

    async def register_presence(
        self, user_id: str, available_channels: list[dict[str, Any]]
    ) -> None:
        """Register Discord presence with daemon.

        Args:
            user_id: Discord user ID
            available_channels: List of channel dicts with id, name, type
        """
        payload = {
            "medium": "discord",
            "user_id": user_id,
            "available_channels": available_channels,
        }
        resp = await self._client.post("/presence/register", json=payload)
        resp.raise_for_status()

    async def heartbeat_presence(self, user_id: str) -> None:
        """Send heartbeat to keep presence alive.

        Args:
            user_id: Discord user ID
        """
        payload = {"medium": "discord", "user_id": user_id}
        resp = await self._client.post("/presence/heartbeat", json=payload)
        resp.raise_for_status()

    async def unregister_presence(self, user_id: str) -> None:
        """Unregister Discord presence on shutdown.

        Args:
            user_id: Discord user ID
        """
        payload = {"medium": "discord", "user_id": user_id}
        resp = await self._client.post("/presence/unregister", json=payload)
        resp.raise_for_status()

    async def get_pending_notifications(self) -> list[dict[str, Any]]:
        """Get pending notifications for Discord medium.

        Returns:
            List of notification dicts
        """
        resp = await self._client.get("/notifications/pending", params={"medium": "discord"})
        resp.raise_for_status()
        data = resp.json()
        return data.get("notifications", [])

    async def mark_notification_delivered(self, notification_id: int) -> None:
        """Mark notification as delivered.

        Args:
            notification_id: Notification ID
        """
        resp = await self._client.post(f"/notifications/{notification_id}/delivered")
        resp.raise_for_status()


    async def mark_notification_acknowledged(self, notification_id: int) -> None:
        """Mark notification as acknowledged by user.

        Args:
            notification_id: Notification ID
        """
        resp = await self._client.post(f"/notifications/{notification_id}/acknowledge")
        resp.raise_for_status()

    async def mark_notification_failed(self, notification_id: int, error: str) -> None:
        """Mark notification as failed.

        Args:
            notification_id: Notification ID
            error: Error message
        """
        payload = {"notification_id": notification_id, "error_message": error}
        resp = await self._client.post(f"/notifications/{notification_id}/failed", json=payload)
        resp.raise_for_status()

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
        self,
        working_dir: str,
        personality: str,
        max_age_hours: int | None = None,
        user_id: str | None = None,
    ) -> tuple[int, bool, str | None]:
        """Find existing session or create new one.

        Args:
            working_dir: Working directory path
            personality: Personality label
            max_age_hours: Maximum age in hours to consider existing session active
            user_id: Discord user ID (optional, for cross-medium continuity)

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
            "user_id": user_id,
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
        resp = await self._client.post("/sessions/end", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def queue_summary(self, session_id: int) -> dict[str, Any]:
        payload: SessionEndPayload = {"session_id": session_id}
        return await self.end_session(payload)

    async def get_emotion_summary(self, session_id: int) -> str:
        """Get emotion summary for prompt injection"""
        resp = await self._client.get(f"/emotion/summary/{session_id}")
        resp.raise_for_status()
        data = resp.json()
        return data.get("summary", "Currently in a neutral emotional state.")
