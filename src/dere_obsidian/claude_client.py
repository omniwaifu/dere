"""Claude SDK wrapper for Obsidian integration."""

from __future__ import annotations

import tempfile
from contextlib import AsyncExitStack
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from loguru import logger

from dere_shared.personalities import PersonalityLoader

from .vault_parser import VaultParser


class ObsidianClaudeClient:
    """Wrapper for ClaudeSDKClient with vault-aware prompt injection."""

    def __init__(
        self,
        vault_parser: VaultParser,
        personality_name: str | None = None,
        daemon_client=None,
        session_id: int | None = None,
    ):
        self.vault_parser = vault_parser
        self.daemon_client = daemon_client
        self.session_id = session_id

        # Load personality
        personality_loader = PersonalityLoader()

        if personality_name:
            self.personality_profile = personality_loader.load(personality_name)
            if not self.personality_profile:
                logger.warning(
                    f"Personality '{personality_name}' not found, loading first available"
                )
                available = personality_loader.list_available()
                self.personality_profile = (
                    personality_loader.load(available[0]) if available else None
                )
        else:
            # Load first available personality
            available = personality_loader.list_available()
            self.personality_profile = personality_loader.load(available[0]) if available else None

    async def create_client(
        self,
        note_path: Path | str | None = None,
        note_content: str | None = None,
        resume_session_id: str | None = None,
        include_vault_context: bool = False,
    ) -> tuple[ClaudeSDKClient, AsyncExitStack]:
        """Create and configure Claude SDK client with vault context.

        Returns:
            Tuple of (client, exit_stack) - caller must close exit_stack
        """
        # Get personality prompt
        personality_prompt = (
            self.personality_profile.prompt_content if self.personality_profile else ""
        )

        # Get emotion context if session enabled
        emotion_context = ""
        if self.daemon_client and self.session_id:
            try:
                emotion_summary = await self.daemon_client.get_emotion_summary(self.session_id)
                if emotion_summary and emotion_summary != "Currently in a neutral emotional state.":
                    emotion_context = f"\\n\\n## Current Emotional State\\n{emotion_summary}"
            except Exception as e:
                logger.debug(f"Failed to get emotion context: {e}")

        # Build vault context if requested
        vault_context = ""
        if include_vault_context:
            vault_context = self.vault_parser.build_full_context(
                note_path=note_path,
                note_content=note_content,
            )

        combined_prompt = f"{personality_prompt}{emotion_context}"
        if vault_context:
            combined_prompt = f"{combined_prompt}\\n\\n{vault_context}"

        temp_dir = Path(tempfile.gettempdir()) / "dere_obsidian"
        temp_dir.mkdir(exist_ok=True)

        options = ClaudeAgentOptions(
            cwd=str(temp_dir),
            system_prompt={"type": "preset", "preset": "default", "append": combined_prompt},  # type: ignore[typeddict-item]
            allowed_tools=["Read", "Write", "Bash", "WebFetch", "WebSearch"],
            permission_mode="acceptEdits",
            resume=resume_session_id,
        )

        exit_stack = AsyncExitStack()
        client = ClaudeSDKClient(options=options)
        await exit_stack.enter_async_context(client)

        return client, exit_stack

    async def query_and_receive(
        self,
        prompt: str,
        note_path: Path | str | None = None,
        note_content: str | None = None,
        include_vault_context: bool = False,
    ) -> str:
        """Query Claude and receive full response.

        Simplified interface for request/response pattern.
        """
        client, exit_stack = await self.create_client(
            note_path=note_path,
            note_content=note_content,
            include_vault_context=include_vault_context,
        )

        try:
            await client.query(prompt)

            from claude_agent_sdk import (
                AssistantMessage,
                TextBlock,
                ThinkingBlock,
                ToolResultBlock,
                ToolUseBlock,
            )

            pre_tool_chunks: list[str] = []
            post_tool_chunks: list[str] = []
            tool_seen = False

            async for message in client.receive_response():
                if isinstance(message, AssistantMessage):
                    for block in getattr(message, "content", []) or []:
                        if isinstance(block, TextBlock | ThinkingBlock):
                            text = getattr(block, "text", "")
                            if text:
                                if tool_seen:
                                    post_tool_chunks.append(text)
                                else:
                                    pre_tool_chunks.append(text)
                        elif isinstance(block, ToolUseBlock | ToolResultBlock):
                            tool_seen = True

            if tool_seen:
                return "".join(post_tool_chunks).strip()
            return "".join(pre_tool_chunks).strip()

        finally:
            await exit_stack.aclose()

    def _extract_text(self, message) -> str:
        """Extract text content from Claude SDK message."""
        from claude_agent_sdk import (
            AssistantMessage,
            TextBlock,
            ThinkingBlock,
            UserMessage,
        )

        if isinstance(message, AssistantMessage | UserMessage):
            texts = []
            for block in getattr(message, "content", []) or []:
                if isinstance(block, TextBlock | ThinkingBlock):
                    text = getattr(block, "text", "")
                    if text:
                        texts.append(text)
            return "".join(texts)

        # Handle other message types
        if hasattr(message, "text"):
            return str(message.text)

        return ""
