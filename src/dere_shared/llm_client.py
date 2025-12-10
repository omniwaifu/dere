"""Shared LLM client for structured output generation."""

from __future__ import annotations

from typing import TypeVar

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, query
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


class ClaudeClient:
    """Claude client for structured output generation."""

    def __init__(self, model: str = "claude-haiku-4-5"):
        self.model = model

    async def generate_response(
        self,
        messages: list[Message],
        response_model: type[T],
    ) -> T:
        """Generate structured output using Claude Agent SDK."""
        prompt = format_messages(messages)
        schema = response_model.model_json_schema()

        options = ClaudeAgentOptions(
            model=self.model,
            output_format={
                "type": "json_schema",
                "schema": schema,
            },
        )

        async for msg in query(prompt=prompt, options=options):
            if isinstance(msg, ResultMessage) and msg.structured_output:
                return response_model.model_validate(msg.structured_output)

        raise ValueError("No structured output in response")

    async def generate_text_response(self, messages: list[Message]) -> str:
        """Generate a simple text response without structured output."""
        prompt = format_messages(messages)

        response_text = ""
        async for msg in query(prompt=prompt, options=ClaudeAgentOptions(model=self.model)):
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if hasattr(block, "text"):
                        response_text += block.text

        return response_text
