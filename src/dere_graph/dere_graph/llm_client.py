"""Re-export from dere_shared for backwards compatibility."""

from dere_shared.llm_client import ClaudeClient, Message, format_messages

__all__ = ["ClaudeClient", "Message", "format_messages"]
