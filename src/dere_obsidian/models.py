"""OpenAI-compatible API models for dere-obsidian."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A message in the chat completion request."""

    role: Literal["system", "user", "assistant"]
    content: str
    name: str | None = None


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible chat completion request."""

    model: str = "claude-3-5-sonnet-20241022"
    messages: list[ChatMessage]
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    n: int | None = Field(default=1, ge=1)
    stream: bool = False
    stop: str | list[str] | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    logit_bias: dict[str, float] | None = None
    user: str | None = None

    # Custom dere extensions
    personality: str | None = None  # dere personality name
    vault_path: str | None = None  # specific vault path override
    enable_session: bool = False  # create daemon session for continuity
    note_path: str | None = None  # path to the note being edited (for context)
    note_content: str | None = None  # full content of the note (for context)


class ChatCompletionChoice(BaseModel):
    """A choice in the chat completion response."""

    index: int
    message: ChatMessage
    finish_reason: Literal["stop", "length", "content_filter", "null"] | None = None


class ChatCompletionUsage(BaseModel):
    """Token usage statistics."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    """OpenAI-compatible chat completion response."""

    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    choices: list[ChatCompletionChoice]
    usage: ChatCompletionUsage | None = None
    system_fingerprint: str | None = None


class ChatCompletionChunkDelta(BaseModel):
    """Delta content in streaming response."""

    role: Literal["assistant"] | None = None
    content: str | None = None


class ChatCompletionChunkChoice(BaseModel):
    """A choice in the streaming chunk."""

    index: int
    delta: ChatCompletionChunkDelta
    finish_reason: Literal["stop", "length", "content_filter", "null"] | None = None


class ChatCompletionChunk(BaseModel):
    """OpenAI-compatible streaming chunk."""

    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int
    model: str
    choices: list[ChatCompletionChunkChoice]
    system_fingerprint: str | None = None


class ErrorResponse(BaseModel):
    """Error response."""

    error: dict[str, Any]


class VaultInfo(BaseModel):
    """Vault information response."""

    vault_path: str
    has_root_claude_md: bool
    note_types: list[str]
    personalities_available: list[str]
