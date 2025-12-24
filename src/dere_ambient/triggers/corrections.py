"""Detect corrections in user messages."""

from __future__ import annotations

import re

from .types import CuriositySignal

_CORRECTION_PATTERNS = [
    re.compile(r"^(no|nah|not quite|actually|correction)\b", re.IGNORECASE),
    re.compile(r"\b(it's|it is|that's|that is)\s+(actually|not)\b", re.IGNORECASE),
    re.compile(r"\b(i meant|i said|what i meant)\b", re.IGNORECASE),
    re.compile(r"\b(correct(ing)?|to clarify|let me clarify)\b", re.IGNORECASE),
]

_TOPIC_PATTERNS = [
    re.compile(r"\b(it's|it is|that's|that is)\s+(actually\s+)?(?P<topic>.+)", re.IGNORECASE),
    re.compile(r"\b(correct(ing)?|correction):?\s+(?P<topic>.+)", re.IGNORECASE),
]


def detect_correction(
    *,
    prompt: str,
    previous_assistant: str | None,
) -> CuriositySignal | None:
    if not previous_assistant:
        return None

    if not _looks_like_correction(prompt):
        return None

    topic = _extract_topic(prompt)
    source_context = "Assistant: {assistant}\nUser: {user}".format(
        assistant=_truncate(previous_assistant, 200),
        user=_truncate(prompt, 200),
    )

    return CuriositySignal(
        curiosity_type="correction",
        topic=topic,
        source_context=source_context,
        trigger_reason="User corrected the assistant",
        user_interest=0.7,
    )


def _looks_like_correction(prompt: str) -> bool:
    text = prompt.strip()
    if len(text) < 6:
        return False

    for pattern in _CORRECTION_PATTERNS:
        if pattern.search(text):
            return True

    return False


def _extract_topic(prompt: str) -> str:
    for pattern in _TOPIC_PATTERNS:
        match = pattern.search(prompt)
        if match:
            candidate = match.group("topic").strip()
            if candidate:
                return _truncate(candidate, 80)
    return _truncate(prompt.strip(), 80)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."
