"""Shared LLM client for structured output generation."""

from __future__ import annotations

import json
import time
from typing import Any, TypeVar

import sentry_sdk
from loguru import logger
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class Message(BaseModel):
    role: str
    content: str


def format_messages(messages: list[Message]) -> str:
    """Convert message list to string format for Agent SDK."""
    parts = []
    for msg in messages:
        if msg.role == "user":
            parts.append(f"User: {msg.content}")
        elif msg.role == "assistant":
            parts.append(f"Assistant: {msg.content}")
        elif msg.role == "system":
            parts.append(msg.content)
    return "\n\n".join(parts)


def _unwrap_tool_payload(candidate: Any) -> Any:
    """
    Claude SDK tool calls sometimes wrap the actual JSON payload.

    Common wrappers observed: {"parameters": {...}}, {"parameter": {...}},
    {"argument": {...}}, {"input": {...}}, {"object": {...}}.
    """
    from loguru import logger

    iteration = 0
    while isinstance(candidate, dict):
        iteration += 1
        if iteration > 10:
            logger.warning("[_unwrap_tool_payload] Too many unwrap iterations, stopping")
            break

        # Single-key wrappers
        found = False
        for key in ("parameters", "parameter", "arguments", "argument", "input", "output", "data", "object", "content", "result"):
            if key in candidate and len(candidate) == 1:
                candidate = candidate[key]
                found = True
                break

        if found:
            continue

        # Two-key common wrapper variants: {"name": "...", "parameters": {...}}
        if "parameters" in candidate and isinstance(candidate["parameters"], dict):
            candidate = candidate["parameters"]
            continue
        if "input" in candidate and isinstance(candidate["input"], dict):
            candidate = candidate["input"]
            continue

        # No known wrapper found - check if it's an unknown single-key wrapper
        if len(candidate) == 1 and isinstance(list(candidate.values())[0], dict):
            unknown_key = list(candidate.keys())[0]
            logger.warning(f"[_unwrap_tool_payload] Unknown single-key wrapper: {unknown_key!r}")

        return candidate
    return candidate


def _try_parse_json_from_text(text: str) -> Any | None:
    stripped = text.strip()
    if not stripped:
        return None

    # First try: whole string is JSON
    try:
        return json.loads(stripped)
    except Exception:
        pass

    # Fallback: find an embedded JSON object
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(stripped[start : end + 1])
    except Exception:
        return None


class ClaudeClient:
    """Claude client for structured output generation."""

    def __init__(self, model: str = "claude-opus-4-5"):
        self.model = model

    async def generate_response(
        self,
        messages: list[Message],
        response_model: type[T],
    ) -> T:
        """Generate structured output using Claude Agent SDK."""
        from pathlib import Path

        from claude_agent_sdk import ClaudeAgentOptions, query

        # Isolate sessions from user projects to prevent dere -c contamination
        isolated_cwd = Path("/tmp/dere-emotion-appraisal")
        isolated_cwd.mkdir(exist_ok=True)

        prompt = format_messages(messages)
        schema = response_model.model_json_schema()

        options = ClaudeAgentOptions(
            model=self.model,
            cwd=str(isolated_cwd),
            output_format={
                "type": "json_schema",
                "schema": schema,
            },
        )

        # Consume ALL messages - don't break early or async cleanup fails
        start_time = time.monotonic()
        result = None
        last_text = ""
        async for msg in query(prompt=prompt, options=options):
            # Check ResultMessage.structured_output
            if hasattr(msg, "structured_output") and msg.structured_output:
                result = _unwrap_tool_payload(msg.structured_output)
            # Fallback: extract from StructuredOutput tool call
            if not result and hasattr(msg, "content"):
                content = msg.content
                if isinstance(content, str):
                    last_text = content
                    parsed = _try_parse_json_from_text(content)
                    if parsed is not None:
                        result = _unwrap_tool_payload(parsed)
                    continue

                # content is usually a list of blocks; support dict-like blocks too
                for block in content if hasattr(content, "__iter__") else []:
                    if isinstance(block, dict):
                        if "input" in block and block["input"]:
                            result = _unwrap_tool_payload(block["input"])
                            break
                        continue

                    if hasattr(block, "input") and getattr(block, "input"):
                        result = _unwrap_tool_payload(getattr(block, "input"))
                        break

        latency_ms = int((time.monotonic() - start_time) * 1000)

        if result:
            logger.info(
                "LLM generate_response: model={} schema={} latency_ms={} success=True",
                self.model,
                response_model.__name__,
                latency_ms,
            )
            sentry_sdk.add_breadcrumb(
                category="llm",
                message=f"LLM: {response_model.__name__}",
                level="info",
                data={"model": self.model, "latency_ms": latency_ms, "success": True},
            )
            return response_model.model_validate(result)

        logger.warning(
            "LLM generate_response: model={} schema={} latency_ms={} success=False",
            self.model,
            response_model.__name__,
            latency_ms,
        )
        sentry_sdk.add_breadcrumb(
            category="llm",
            message=f"LLM failed: {response_model.__name__}",
            level="warning",
            data={"model": self.model, "latency_ms": latency_ms, "success": False},
        )

        if last_text:
            raise ValueError(f"No structured output in response (last text: {last_text[:200]!r})")
        raise ValueError("No structured output in response")

    async def generate_text_response(self, messages: list[Message]) -> str:
        """Generate a simple text response without structured output."""
        from pathlib import Path

        from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, query

        # Isolate sessions from user projects to prevent dere -c contamination
        isolated_cwd = Path("/tmp/dere-llm-sessions")
        isolated_cwd.mkdir(exist_ok=True)

        prompt = format_messages(messages)

        start_time = time.monotonic()
        response_text = ""
        async for msg in query(
            prompt=prompt,
            options=ClaudeAgentOptions(model=self.model, cwd=str(isolated_cwd)),
        ):
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if hasattr(block, "text"):
                        response_text += block.text

        latency_ms = int((time.monotonic() - start_time) * 1000)
        response_len = len(response_text)

        logger.info(
            "LLM generate_text_response: model={} latency_ms={} response_len={}",
            self.model,
            latency_ms,
            response_len,
        )
        sentry_sdk.add_breadcrumb(
            category="llm",
            message="LLM text response",
            level="info",
            data={"model": self.model, "latency_ms": latency_ms, "response_len": response_len},
        )

        return response_text
