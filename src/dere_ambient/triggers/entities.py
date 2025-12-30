"""Detect unfamiliar entities from newly created knowledge graph nodes."""

from __future__ import annotations

import re
from typing import Any

from .types import CuriositySignal

_GENERIC_ENTITY_NAMES = {
    "user",
    "assistant",
    "ai",
    "system",
    "daemon",
}


def detect_unfamiliar_entities(
    *,
    prompt: str,
    nodes: list[Any] | None,
    speaker_name: str | None,
    personality: str | None,
    max_entities: int = 3,
) -> list[CuriositySignal]:
    if not nodes or not prompt.strip():
        return []

    signals: list[CuriositySignal] = []
    for node in nodes:
        name = str(getattr(node, "name", "") or "").strip()
        if not name:
            continue

        if _is_generic_entity(node, name, speaker_name, personality):
            continue
        if _appears_as_log_prefix(name, prompt):
            continue

        signals.append(
            CuriositySignal(
                curiosity_type="unfamiliar_entity",
                topic=name,
                source_context=_truncate(prompt, 400),
                trigger_reason="New entity extracted from user message",
                user_interest=0.4,
            )
        )

        if len(signals) >= max_entities:
            break

    return signals


def _is_generic_entity(
    node: Any,
    name: str,
    speaker_name: str | None,
    personality: str | None,
) -> bool:
    if len(name) < 3:
        return True

    normalized = name.casefold()
    if normalized in _GENERIC_ENTITY_NAMES:
        return True

    labels = {str(label).lower() for label in getattr(node, "labels", [])}
    if labels & {"user", "assistant", "ai"}:
        return True

    if speaker_name and normalized == speaker_name.strip().lower():
        return True

    if personality and normalized == personality.strip().lower():
        return True

    return False


def _appears_as_log_prefix(name: str, prompt: str) -> bool:
    normalized = name.casefold()
    if not normalized:
        return False

    pattern = re.compile(rf"^\s*{re.escape(normalized)}(?:\.\d+)?\s*\|")
    for line in prompt.splitlines():
        if pattern.search(line.casefold()):
            return True
    return False


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."
