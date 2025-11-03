from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlmodel import SQLModel


def create_engine(database_url: str, **kwargs: Any) -> AsyncEngine:
    """Create async engine with proper pool configuration.

    Args:
        database_url: PostgreSQL connection URL (should start with postgresql+asyncpg://)
        **kwargs: Additional engine arguments

    Returns:
        Configured AsyncEngine
    """
    # Default pool settings for production
    defaults = {
        "pool_size": kwargs.pop("pool_size", 10),
        "max_overflow": kwargs.pop("max_overflow", 20),
        "pool_pre_ping": kwargs.pop("pool_pre_ping", True),
        "echo": kwargs.pop("echo", False),
    }
    defaults.update(kwargs)

    return create_async_engine(database_url, **defaults)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Create async session factory.

    Args:
        engine: AsyncEngine instance

    Returns:
        Sessionmaker configured for async operations
    """
    return async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )


async def get_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession]:
    """FastAPI dependency for database sessions.

    Provides proper session lifecycle with commit/rollback/close.

    Args:
        session_factory: Session factory from create_session_factory()

    Yields:
        AsyncSession instance
    """
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db(engine: AsyncEngine) -> None:
    """Initialize database schema (for development only).

    In production, use Alembic migrations instead.

    Args:
        engine: AsyncEngine instance
    """
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
