"""Detect when a user pivots away from an open assistant question."""

from __future__ import annotations

import re

from .types import CuriositySignal

_CODE_BLOCK_RE = re.compile(r"```.*?```", re.S)
_QUESTION_RE = re.compile(r"[^\n?]{1,240}\?")

# Affirmative/negative responses that answer yes/no questions
_AFFIRMATIVE_STARTS = frozenset({
    "yeah", "yes", "yep", "yup", "sure", "ok", "okay", "k",
    "do it", "go ahead", "go for it", "sounds good", "let's do it",
    "please", "please do", "that works", "perfect", "great",
    "no", "nope", "nah", "don't", "skip", "never mind", "nevermind",
    "not now", "maybe later", "hold off", "wait",
})


def detect_unfinished_thread(
    *,
    prompt: str,
    previous_assistant: str | None,
) -> CuriositySignal | None:
    if not previous_assistant:
        return None

    question = _extract_last_question(previous_assistant)
    if not question:
        return None

    user_text = prompt.strip()
    if len(user_text) < 4:
        return None

    # Check if user gave an affirmative/negative response to the question
    if _is_direct_response(user_text):
        return None

    overlap = _token_overlap(question, user_text)
    if overlap < 0.15:
        return _build_signal(question, user_text, "User changed topic after a question")

    return None


def _is_direct_response(text: str) -> bool:
    """Check if text looks like a direct answer to a yes/no question."""
    normalized = text.casefold().strip()
    # Check if starts with common affirmative/negative phrases
    for phrase in _AFFIRMATIVE_STARTS:
        if normalized.startswith(phrase):
            # Make sure it's a word boundary (not "yeast" matching "yea")
            rest = normalized[len(phrase):]
            if not rest or not rest[0].isalnum():
                return True
    return False


def _extract_last_question(text: str) -> str | None:
    cleaned = _CODE_BLOCK_RE.sub("", text)
    matches = _QUESTION_RE.findall(cleaned)
    if not matches:
        return None
    question = _strip_markdown(matches[-1].strip())
    if not re.search(r"\w", question, re.UNICODE):
        return None
    return _truncate(question, 120)


def _token_overlap(a: str, b: str) -> float:
    tokens_a = _tokens(a)
    tokens_b = _tokens(b)
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def _tokens(text: str) -> set[str]:
    normalized = _normalize_for_overlap(text)
    words = re.findall(r"\w+", normalized, re.UNICODE)
    if len(words) >= 2:
        return set(words)

    compact = re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE)
    if len(compact) < 4:
        return {compact} if compact else set()
    return {compact[i : i + 4] for i in range(len(compact) - 3)}


def _normalize_for_overlap(text: str) -> str:
    return re.sub(r"\s+", " ", text.casefold()).strip()


def _strip_markdown(text: str) -> str:
    cleaned = re.sub(r"^[\s>*`_\-\d\.)]+", "", text)
    cleaned = re.sub(r"[`*_]+", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _build_signal(question: str, user_text: str, reason: str) -> CuriositySignal:
    source_context = f"Assistant question: {_truncate(question, 200)}\nUser: {_truncate(user_text, 200)}"
    return CuriositySignal(
        curiosity_type="unfinished_thread",
        topic=_truncate(question, 80),
        source_context=source_context,
        trigger_reason=reason,
        user_interest=0.5,
    )


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."
