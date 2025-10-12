"""Proactive monitoring and engagement service for dere."""

from __future__ import annotations

from .config import AmbientConfig, load_ambient_config
from .monitor import AmbientMonitor

__version__ = "0.1.0"
__all__ = ["AmbientConfig", "AmbientMonitor", "load_ambient_config"]
