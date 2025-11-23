"""Retry utilities for Discord bot operations."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import wraps
from typing import TypeVar

from loguru import logger

T = TypeVar("T")


def exponential_backoff_retry(
    max_retries: int = 5,
    base_delay: float = 1.0,
    operation_name: str = "operation",
):
    """Decorator for retrying async functions with exponential backoff.

    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Base delay in seconds (doubled each retry)
        operation_name: Name of operation for logging
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    if attempt < max_retries - 1:
                        delay = base_delay * (2**attempt)
                        logger.warning(
                            "Failed {} (attempt {}/{}): {} - retrying in {}s",
                            operation_name,
                            attempt + 1,
                            max_retries,
                            e,
                            delay,
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.error(
                            "Failed {} after {} attempts: {}",
                            operation_name,
                            max_retries,
                            e,
                        )
                        raise

        return wrapper

    return decorator
