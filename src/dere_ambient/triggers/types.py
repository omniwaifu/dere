"""Shared models for curiosity trigger detection."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class CuriositySignal:
    curiosity_type: str
    topic: str
    source_context: str
    trigger_reason: str
    user_interest: float
    knowledge_gap: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)
