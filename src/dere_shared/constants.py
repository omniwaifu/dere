"""Shared constants for dere components.

Centralizes default URLs, ports, and configuration values to avoid hardcoding
throughout the codebase.
"""

from __future__ import annotations

# Daemon
DEFAULT_DAEMON_URL = "http://localhost:8787"
DEFAULT_DAEMON_PORT = 8787

# ActivityWatch
DEFAULT_ACTIVITYWATCH_URL = "http://localhost:5600"
DEFAULT_ACTIVITYWATCH_PORT = 5600

# Database
DEFAULT_DB_URL = "postgresql://postgres:dere@localhost/dere"
DEFAULT_DB_ASYNC_URL = "postgresql+asyncpg://postgres:dere@localhost/dere"

# DereGraph / Falkor
DEFAULT_FALKOR_HOST = "localhost"
DEFAULT_FALKOR_PORT = 6379
DEFAULT_FALKOR_DATABASE = "dere_graph"

# Discord
DEFAULT_DISCORD_IDLE_TIMEOUT = 1200  # 20 minutes

# Ambient Monitoring
DEFAULT_AMBIENT_IDLE_THRESHOLD_MINUTES = 60
DEFAULT_AMBIENT_CHECK_INTERVAL_MINUTES = 30

# Context
DEFAULT_ACTIVITY_LOOKBACK_MINUTES = 10
DEFAULT_RECENT_FILES_TIMEFRAME = "1h"
