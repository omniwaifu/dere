"""Detect assistant uncertainty that suggests a knowledge gap."""

from __future__ import annotations

import re

from .types import CuriositySignal

_HEDGING_PATTERNS = [
    re.compile(r"\bi think\b", re.IGNORECASE),
    re.compile(r"\bnot sure\b", re.IGNORECASE),
    re.compile(r"\bnot certain\b", re.IGNORECASE),
    re.compile(r"\buncertain\b", re.IGNORECASE),
    re.compile(r"\bI don't know\b", re.IGNORECASE),
    re.compile(r"\bI do not know\b", re.IGNORECASE),
    re.compile(r"\bcan't verify\b", re.IGNORECASE),
    re.compile(r"\bcannot verify\b", re.IGNORECASE),
    re.compile(r"\bcan't confirm\b", re.IGNORECASE),
    re.compile(r"\bcannot confirm\b", re.IGNORECASE),
    re.compile(r"\bprobably\b", re.IGNORECASE),
    re.compile(r"\bmaybe\b", re.IGNORECASE),
    re.compile(r"\bguess\b", re.IGNORECASE),
]

_TOPIC_PATTERNS = [
    re.compile(r"\babout\s+(?P<topic>[^.?!]+)", re.IGNORECASE),
    re.compile(r"\bfor\s+(?P<topic>[^.?!]+)", re.IGNORECASE),
    re.compile(r"\bon\s+(?P<topic>[^.?!]+)", re.IGNORECASE),
]


def detect_knowledge_gap(*, prompt: str, previous_user: str | None) -> CuriositySignal | None:
    text = prompt.strip()
    if len(text) < 20:
        return None

    reason = _find_reason(text)
    if not reason:
        return None

    topic = _extract_topic(text) or _truncate(previous_user or text, 80)
    source_context = "Assistant: {assistant}\nUser: {user}".format(
        assistant=_truncate(text, 220),
        user=_truncate(previous_user or "", 200),
    )

    return CuriositySignal(
        curiosity_type="knowledge_gap",
        topic=topic,
        source_context=source_context,
        trigger_reason=reason,
        user_interest=0.4,
        knowledge_gap=0.8,
    )


def _find_reason(text: str) -> str | None:
    for pattern in _HEDGING_PATTERNS:
        if pattern.search(text):
            return "Assistant expressed uncertainty"
    return None


def _extract_topic(text: str) -> str | None:
    for pattern in _TOPIC_PATTERNS:
        match = pattern.search(text)
        if match:
            candidate = match.group("topic").strip()
            if candidate:
                return _truncate(candidate, 80)
    return None


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."
