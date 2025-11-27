"""Streaming event helpers for agent responses."""

from __future__ import annotations

from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from .models import SessionConfig, StreamEvent, StreamEventType


def session_ready_event(session_id: int, config: SessionConfig) -> StreamEvent:
    """Create a session_ready event."""
    return StreamEvent(
        type=StreamEventType.SESSION_READY,
        data={
            "session_id": session_id,
            "config": config.model_dump(),
        },
    )


def text_event(text: str) -> StreamEvent:
    """Create a text event."""
    return StreamEvent(
        type=StreamEventType.TEXT,
        data={"text": text},
    )


def tool_use_event(name: str, tool_input: dict[str, Any]) -> StreamEvent:
    """Create a tool_use event."""
    return StreamEvent(
        type=StreamEventType.TOOL_USE,
        data={"name": name, "input": tool_input},
    )


def tool_result_event(name: str, output: str, is_error: bool = False) -> StreamEvent:
    """Create a tool_result event."""
    return StreamEvent(
        type=StreamEventType.TOOL_RESULT,
        data={"name": name, "output": output, "is_error": is_error},
    )


def thinking_event(text: str) -> StreamEvent:
    """Create a thinking event."""
    return StreamEvent(
        type=StreamEventType.THINKING,
        data={"text": text},
    )


def error_event(message: str, recoverable: bool = True) -> StreamEvent:
    """Create an error event."""
    return StreamEvent(
        type=StreamEventType.ERROR,
        data={"message": message, "recoverable": recoverable},
    )


def done_event(response_text: str, tool_count: int = 0) -> StreamEvent:
    """Create a done event."""
    return StreamEvent(
        type=StreamEventType.DONE,
        data={"response_text": response_text, "tool_count": tool_count},
    )


def cancelled_event() -> StreamEvent:
    """Create a cancelled event."""
    return StreamEvent(
        type=StreamEventType.CANCELLED,
        data={"message": "Query cancelled by user"},
    )


def extract_text_from_block(block: object) -> str | None:
    """Extract text from a message block if it contains text."""
    if isinstance(block, TextBlock | ThinkingBlock):
        return getattr(block, "text", None)
    return None


def extract_tool_use(block: object) -> tuple[str, str, dict[str, Any]] | None:
    """Extract tool use info from a block.

    Returns: (tool_use_id, name, input) or None
    """
    if isinstance(block, ToolUseBlock):
        tool_use_id = getattr(block, "id", "")
        name = getattr(block, "name", "unknown")
        tool_input = getattr(block, "input", {})
        return tool_use_id, name, tool_input
    return None


def extract_tool_result(block: object) -> tuple[str, str, bool] | None:
    """Extract tool result info from a block.

    Returns: (tool_use_id, content, is_error) or None
    """
    if isinstance(block, ToolResultBlock):
        tool_use_id = getattr(block, "tool_use_id", "")
        content = getattr(block, "content", "")
        is_error = getattr(block, "is_error", False)
        content_str = content if isinstance(content, str) else str(content)
        return tool_use_id, content_str, is_error
    return None


def is_init_message(message: object) -> tuple[bool, str | None]:
    """Check if message is a system init message and extract session ID."""
    if isinstance(message, SystemMessage):
        subtype = getattr(message, "subtype", None)
        if subtype == "init":
            claude_session_id = message.data.get("session_id")
            return True, claude_session_id
    return False, None


def extract_events_from_message(
    message: object, tool_id_to_name: dict[str, str] | None = None
) -> list[StreamEvent]:
    """Extract streaming events from a Claude SDK message.

    Args:
        message: The message to extract events from
        tool_id_to_name: Optional mapping of tool_use_id to tool name for result correlation.
            If provided, tool names will be included in tool_result events.
            The mapping is updated in-place when tool_use blocks are encountered.
    """
    events: list[StreamEvent] = []
    if tool_id_to_name is None:
        tool_id_to_name = {}

    if isinstance(message, AssistantMessage | UserMessage):
        content = getattr(message, "content", []) or []
        for block in content:
            text = extract_text_from_block(block)
            if text:
                if isinstance(block, ThinkingBlock):
                    events.append(thinking_event(text))
                else:
                    events.append(text_event(text))
                continue

            tool_use = extract_tool_use(block)
            if tool_use:
                tool_use_id, name, tool_input = tool_use
                tool_id_to_name[tool_use_id] = name
                events.append(tool_use_event(name, tool_input))
                continue

            tool_result = extract_tool_result(block)
            if tool_result:
                result_tool_use_id, output, is_error = tool_result
                tool_name = tool_id_to_name.get(result_tool_use_id, "")
                events.append(tool_result_event(tool_name, output, is_error))

    elif isinstance(message, TextBlock | ThinkingBlock):
        text = getattr(message, "text", "")
        if text:
            if isinstance(message, ThinkingBlock):
                events.append(thinking_event(text))
            else:
                events.append(text_event(text))

    elif isinstance(message, ToolUseBlock):
        tool_use_id = getattr(message, "id", "")
        name = getattr(message, "name", "unknown")
        tool_input = getattr(message, "input", {})
        tool_id_to_name[tool_use_id] = name
        events.append(tool_use_event(name, tool_input))

    elif isinstance(message, ToolResultBlock):
        result_tool_use_id = getattr(message, "tool_use_id", "")
        content = getattr(message, "content", "")
        is_error = getattr(message, "is_error", False)
        tool_name = tool_id_to_name.get(result_tool_use_id, "")
        events.append(tool_result_event(tool_name, str(content), is_error))

    return events
