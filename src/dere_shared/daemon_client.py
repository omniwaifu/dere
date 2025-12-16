"""Daemon HTTP client with Unix Domain Socket support.

Provides a factory for creating httpx clients that can connect to the daemon
via either TCP or Unix Domain Socket, based on DERE_DAEMON_URL.

URL formats:
- http://localhost:8787 - Standard TCP connection
- http+unix:///run/dere/daemon.sock - Unix Domain Socket connection
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import httpx

from .constants import DEFAULT_DAEMON_URL

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def get_daemon_url() -> str:
    """Get the daemon URL from environment or default."""
    return os.environ.get("DERE_DAEMON_URL", DEFAULT_DAEMON_URL)


def parse_daemon_url(url: str) -> tuple[str, str | None]:
    """Parse daemon URL into (base_url, socket_path).

    Args:
        url: Either http://host:port or http+unix:///path/to/socket

    Returns:
        Tuple of (base_url for requests, socket_path or None)
    """
    if url.startswith("http+unix://"):
        socket_path = url.replace("http+unix://", "")
        # For UDS, base_url is a dummy - httpx routes via the socket
        return "http://daemon", socket_path
    return url, None


@asynccontextmanager
async def daemon_client(timeout: float = 30.0) -> AsyncIterator[httpx.AsyncClient]:
    """Create an async httpx client configured for the daemon.

    Automatically handles Unix Domain Socket connections when DERE_DAEMON_URL
    is set to http+unix:// scheme.

    Usage:
        async with daemon_client() as client:
            resp = await client.get("/health")
    """
    url = get_daemon_url()
    base_url, socket_path = parse_daemon_url(url)

    if socket_path:
        # Unix Domain Socket transport
        transport = httpx.AsyncHTTPTransport(uds=socket_path)
        async with httpx.AsyncClient(
            transport=transport,
            base_url=base_url,
            timeout=timeout,
        ) as client:
            yield client
    else:
        # Standard TCP transport
        async with httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
        ) as client:
            yield client


class DaemonClient:
    """Reusable daemon client for when you need persistent connections.

    For most cases, prefer the daemon_client() context manager instead.
    """

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None
        self._socket_path: str | None = None

    async def __aenter__(self) -> httpx.AsyncClient:
        url = get_daemon_url()
        base_url, self._socket_path = parse_daemon_url(url)

        if self._socket_path:
            transport = httpx.AsyncHTTPTransport(uds=self._socket_path)
            self._client = httpx.AsyncClient(
                transport=transport,
                base_url=base_url,
                timeout=self.timeout,
            )
        else:
            self._client = httpx.AsyncClient(
                base_url=base_url,
                timeout=self.timeout,
            )

        return self._client

    async def __aexit__(self, *args) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
