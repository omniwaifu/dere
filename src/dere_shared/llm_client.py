"""Shared LLM client for structured output generation."""

from __future__ import annotations

from typing import TypeVar

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, query
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

    def __init__(self, model: str = "claude-opus-4-5"):
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

        # Consume ALL messages - don't break early or async cleanup fails
        result = None
        async for msg in query(prompt=prompt, options=options):
            # Check ResultMessage.structured_output
            if hasattr(msg, "structured_output") and msg.structured_output:
                result = msg.structured_output
            # Fallback: extract from StructuredOutput tool call
            if not result and hasattr(msg, "content"):
                for block in msg.content if hasattr(msg.content, "__iter__") else []:
                    if (
                        hasattr(block, "name")
                        and block.name == "StructuredOutput"
                        and hasattr(block, "input")
                        and block.input
                    ):
                        candidate = block.input
                        # Model sometimes wraps in 'parameter' or 'argument' key
                        if "parameter" in candidate and len(candidate) == 1:
                            candidate = candidate["parameter"]
                        elif "argument" in candidate and len(candidate) == 1:
                            candidate = candidate["argument"]
                        result = candidate

        if result:
            return response_model.model_validate(result)

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
