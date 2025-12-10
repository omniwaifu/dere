"""Shared LLM client for structured output generation."""

from __future__ import annotations

from typing import Any, TypeVar

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ToolUseBlock,
    create_sdk_mcp_server,
    tool,
)
from loguru import logger
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


def _extract_json_from_text(text: str) -> dict[str, Any] | None:
    """Try to extract JSON from text, handling markdown code fences."""
    import json
    import re

    # Try to extract from markdown code fence
    code_fence_pattern = r"```(?:json)?\s*\n?(.*?)\n?```"
    match = re.search(code_fence_pattern, text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try to parse the whole text as JSON
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    return None


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
    """Claude client for structured output generation via tool use."""

    def __init__(self, model: str = "claude-haiku-4-5"):
        self.model = model
        self.max_retries = 2

    async def generate_response(
        self,
        messages: list[Message],
        response_model: type[T],
    ) -> T:
        """Generate structured output using Claude Agent SDK tool pattern."""
        retry_count = 0

        while retry_count <= self.max_retries:
            try:
                result = await self._generate_with_tool(messages, response_model)
                validated = response_model.model_validate(result)
                return validated

            except ValidationError as e:
                if retry_count >= self.max_retries:
                    logger.error(
                        f"Validation error after {retry_count}/{self.max_retries} attempts: {e}"
                    )
                    raise

                error_msg = f"Invalid response. Error: {e}. Please retry with valid {response_model.__name__}."
                messages.append(Message(role="user", content=error_msg))
                retry_count += 1
                logger.warning(
                    f"Retrying after validation error (attempt {retry_count}/{self.max_retries})"
                )

            except Exception as e:
                if retry_count >= self.max_retries:
                    logger.error(f"Max retries ({self.max_retries}) exceeded. Last error: {e}")
                    raise

                error_msg = f"Error: {e}. Please retry."
                messages.append(Message(role="user", content=error_msg))
                retry_count += 1
                logger.warning(f"Retrying after error (attempt {retry_count}/{self.max_retries})")

        raise Exception("Max retries exceeded")

    async def _generate_with_tool(
        self,
        messages: list[Message],
        response_model: type[BaseModel],
    ) -> dict[str, Any]:
        """Generate response using tool-based structured output."""
        import json
        import tempfile

        model_name = response_model.__name__
        schema = response_model.model_json_schema()
        description = schema.get("description", f"Extract {model_name} information")

        @tool(model_name, description, schema)
        async def extraction_tool(args: dict[str, Any]) -> dict[str, Any]:
            return {"content": [{"type": "text", "text": "Received"}]}

        server = create_sdk_mcp_server(name="extract", version="1.0.0", tools=[extraction_tool])

        # Create temporary settings file with entity-extractor output style
        settings_data = {"outputStyle": "entity-extractor"}
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(settings_data, f)
            settings_path = f.name

        options = ClaudeAgentOptions(
            mcp_servers={"extract": server},
            allowed_tools=[f"mcp__extract__{model_name}"],
            model=self.model,
            settings=settings_path,
            setting_sources=["user", "project", "local"],
        )

        prompt = (
            format_messages(messages) + f"\n\nUse the {model_name} tool to provide your response."
        )

        text_content: list[str] = []
        try:
            async with ClaudeSDKClient(options=options) as client:
                await client.query(prompt)
                async for msg in client.receive_response():
                    logger.info(f"[LLMClient] {type(msg).__name__}: {msg}")
                    if isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, ToolUseBlock):
                                return block.input
                            if hasattr(block, "text"):
                                text_content.append(block.text)
        finally:
            import os

            try:
                os.unlink(settings_path)
            except Exception:
                pass

        # Fallback: try to parse JSON from text response
        for text in text_content:
            extracted = _extract_json_from_text(text)
            if extracted is not None:
                logger.info("[LLMClient] Extracted JSON from TextBlock fallback")
                return extracted

        raise ValueError("No tool use block found in response")

    async def generate_text_response(self, messages: list[Message]) -> str:
        """Generate a simple text response without structured output."""
        prompt = format_messages(messages)

        async with ClaudeSDKClient(options=ClaudeAgentOptions(model=self.model)) as client:
            await client.query(prompt)
            response_text = ""
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if hasattr(block, "text"):
                            response_text += block.text

            return response_text
