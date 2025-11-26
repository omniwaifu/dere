"""Message handler for Discord bot with clean typing indicator management."""

from __future__ import annotations

from typing import TYPE_CHECKING

import discord
from discord import AllowedMentions
from loguru import logger

if TYPE_CHECKING:
    from .agent import DiscordAgent
    from .persona import PersonaProfile


class TypingIndicatorContext:
    """Async context manager for Discord typing indicator with automatic cleanup."""

    def __init__(self, channel: discord.abc.Messageable):
        self.channel = channel
        self._typing_cm = None
        self._active = False

    async def __aenter__(self):
        self._typing_cm = self.channel.typing()
        await self._typing_cm.__aenter__()
        self._active = True
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._active and self._typing_cm:
            try:
                await self._typing_cm.__aexit__(exc_type, exc_val, exc_tb)
            except Exception:
                # Suppress typing indicator errors to avoid noisy logging
                pass
            finally:
                self._active = False
        return False

    @property
    def is_active(self) -> bool:
        return self._active


class MessageHandlerCallbacks:
    """Encapsulates message handling callbacks to reduce nesting."""

    def __init__(
        self,
        message: discord.Message,
        build_embed_fn: callable,
    ):
        self.message = message
        self.build_embed_fn = build_embed_fn

    async def send_initial(self) -> None:
        """Send initial response (typing indicator already active)."""
        # Typing indicator already active; no placeholder message needed
        pass

    async def send_text_message(self, text: str, persona_profile: PersonaProfile) -> None:
        """Send text message to Discord channel."""
        content = text.strip() if text else ""
        if not content:
            return
        await self.message.channel.send(
            content,
            allowed_mentions=AllowedMentions.none(),
        )

    async def send_tool_summary(
        self, tool_events: list[str], persona_profile: PersonaProfile
    ) -> None:
        """Send tool summary embed to Discord channel."""
        if not tool_events:
            return
        embed = self.build_embed_fn(tool_events, persona_profile)
        await self.message.channel.send(
            embed=embed,
            allowed_mentions=AllowedMentions.none(),
        )


async def handle_discord_message(
    message: discord.Message,
    agent: DiscordAgent,
    guild_id: int | None,
    channel_id: int,
    user_id: int,
    content: str,
    build_embed_fn: callable,
) -> None:
    """Handle a Discord message with automatic typing indicator management.

    Args:
        message: Discord message object
        agent: Discord agent for handling the message
        guild_id: Guild ID if in a guild, None for DMs
        channel_id: Channel ID
        user_id: User ID
        content: Message content
        build_embed_fn: Function to build embed responses
    """
    callbacks = MessageHandlerCallbacks(message, build_embed_fn)

    async with TypingIndicatorContext(message.channel) as _:
        try:
            # Finalize callback that checks typing state
            async def finalize() -> None:
                # Typing indicator will be automatically cleaned up by context manager
                pass

            await agent.handle_message(
                guild_id=guild_id,
                channel_id=channel_id,
                user_id=user_id,
                content=content,
                send_initial=callbacks.send_initial,
                send_text_message=callbacks.send_text_message,
                send_tool_summary=callbacks.send_tool_summary,
                finalize=finalize,
            )
        except Exception as exc:
            logger.exception("Failed handling message in channel {}: {}", channel_id, exc)
            await message.channel.send("Sorry, something went wrong while contacting Claude.")
