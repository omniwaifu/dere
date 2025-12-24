"""Detect emotionally intense messages that merit follow-up exploration."""

from __future__ import annotations

import re

from .types import CuriositySignal

_POSITIVE_WORDS = {
    "love": 0.9,
    "amazing": 0.8,
    "excited": 0.8,
    "thrilled": 0.9,
    "obsessed": 0.7,
    "fantastic": 0.8,
    "incredible": 0.8,
    "awesome": 0.7,
    "best": 0.6,
}

_NEGATIVE_WORDS = {
    "hate": 0.9,
    "furious": 0.9,
    "angry": 0.7,
    "frustrated": 0.7,
    "annoyed": 0.6,
    "disappointed": 0.6,
    "upset": 0.7,
    "terrible": 0.7,
    "awful": 0.8,
}

_EXCITED_PUNCT = re.compile(r"!{2,}")
_STRETCH = re.compile(r"([a-zA-Z])\1{2,}")


def detect_emotional_peak(*, prompt: str) -> CuriositySignal | None:
    text = prompt.strip()
    if len(text) < 6:
        return None

    intensity, reason = _score_intensity(text)
    if intensity < 0.7:
        return None

    return CuriositySignal(
        curiosity_type="emotional_peak",
        topic=_truncate(text, 80),
        source_context=_truncate(text, 400),
        trigger_reason=reason,
        user_interest=min(1.0, intensity + 0.1),
        metadata={"intensity": intensity},
    )


def _score_intensity(text: str) -> tuple[float, str]:
    lowered = text.lower()
    score = 0.0
    reasons: list[str] = []

    for word, weight in _POSITIVE_WORDS.items():
        if word in lowered:
            score += weight
            reasons.append(f"positive:{word}")

    for word, weight in _NEGATIVE_WORDS.items():
        if word in lowered:
            score += weight
            reasons.append(f"negative:{word}")

    if _EXCITED_PUNCT.search(text):
        score += 0.4
        reasons.append("exclamation")

    if _STRETCH.search(text):
        score += 0.2
        reasons.append("stretched_words")

    uppercase_ratio = _uppercase_ratio(text)
    if uppercase_ratio > 0.4 and len(text) > 8:
        score += 0.3
        reasons.append("uppercase")

    intensity = min(score / 2.0, 1.0)
    reason = "high emotional intensity"
    if reasons:
        reason = "high emotional intensity (" + ", ".join(reasons[:3]) + ")"

    return intensity, reason


def _uppercase_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    upper = sum(1 for c in letters if c.isupper())
    return upper / len(letters)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."
