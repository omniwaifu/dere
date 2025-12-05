"""Base protocol for session runners."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class PermissionCallback(Protocol):
    """Callback for handling tool permission requests."""

    async def __call__(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        context: Any,
    ) -> Any:
        """Handle permission request, return allow/deny result."""
        ...


class SessionRunner(ABC):
    """Abstract base for session execution backends.

    Implementations:
    - LocalSessionRunner: Uses ClaudeSDKClient directly
    - DockerSessionRunner: Runs Claude in a Docker container
    """

    @abstractmethod
    async def start(self) -> None:
        """Initialize the runner (start container, connect client, etc.)."""
        ...

    @abstractmethod
    async def query(self, prompt: str) -> None:
        """Submit a query to the runner."""
        ...

    @abstractmethod
    def receive_response(self) -> AsyncIterator[Any]:
        """Yield raw messages from the runner.

        Messages should match the format from ClaudeSDKClient.receive_response()
        so existing event extraction logic can be reused.
        """
        ...

    @abstractmethod
    async def close(self) -> None:
        """Cleanup resources (stop container, close connections)."""
        ...

    @property
    @abstractmethod
    def claude_session_id(self) -> str | None:
        """Return the Claude session ID if available."""
        ...

    @claude_session_id.setter
    @abstractmethod
    def claude_session_id(self, value: str) -> None:
        """Set the Claude session ID."""
        ...
