"""Shared filesystem helpers for dere-discord."""

from __future__ import annotations

from dere_shared.paths import get_config_dir

__all__ = ["get_config_dir", "format_project_path"]


def format_project_path(
    *,
    guild_id: int | None,
    channel_id: int,
    user_id: int | None = None,
) -> str:
    """Build a project path string understood by the daemon."""

    if guild_id is None:
        return f"discord://dm/{user_id or channel_id}"
    return f"discord://guild/{guild_id}/channel/{channel_id}"
