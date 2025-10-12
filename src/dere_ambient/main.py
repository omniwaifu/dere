"""Ambient monitoring module - integrated into dere_daemon.

This module is no longer a standalone daemon. Instead, the AmbientMonitor
runs as a background task within the main dere_daemon process.

See dere_daemon.main for integration.
"""

from __future__ import annotations

from .config import AmbientConfig, load_ambient_config
from .monitor import AmbientMonitor

__all__ = ["AmbientConfig", "AmbientMonitor", "load_ambient_config"]
