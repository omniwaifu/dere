"""Priority calculation for curiosity items."""

from __future__ import annotations

from dataclasses import dataclass

from .types import CuriositySignal


@dataclass
class PriorityWeights:
    user_interest: float = 0.30
    knowledge_gap: float = 0.25
    type_weight: float = 0.20
    recency: float = 0.15
    exploration_count: float = 0.10


_TYPE_WEIGHTS = {
    "correction": 0.9,
    "emotional_peak": 0.7,
    "unfamiliar_entity": 0.5,
    "unfinished_thread": 0.6,
    "knowledge_gap": 0.6,
    "research_chain": 0.4,
}


def compute_curiosity_priority(
    signal: CuriositySignal,
    *,
    exploration_count: int = 0,
    recency: float = 1.0,
    weights: PriorityWeights | None = None,
) -> tuple[float, dict[str, float]]:
    weights = weights or PriorityWeights()
    type_weight = _TYPE_WEIGHTS.get(signal.curiosity_type, 0.5)

    exploration_boost = 1.0 if exploration_count <= 0 else max(0.0, 1.0 - 0.1 * exploration_count)

    factors = {
        "user_interest": _clamp(signal.user_interest),
        "knowledge_gap": _clamp(signal.knowledge_gap),
        "type_weight": _clamp(type_weight),
        "recency": _clamp(recency),
        "exploration_boost": _clamp(exploration_boost),
    }

    score = (
        weights.user_interest * factors["user_interest"]
        + weights.knowledge_gap * factors["knowledge_gap"]
        + weights.type_weight * factors["type_weight"]
        + weights.recency * factors["recency"]
        + weights.exploration_count * factors["exploration_boost"]
    )

    return _clamp(score), factors


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))
