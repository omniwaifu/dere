"""FastAPI dependencies for dere-daemon."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from dere_shared.database import get_session

if TYPE_CHECKING:
    from fastapi import Request


async def get_db(request: Request) -> AsyncSession:
    """FastAPI dependency for database sessions."""
    async for session in get_session(request.app.state.session_factory):
        yield session
