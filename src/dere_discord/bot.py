"""discord.py bot runtime for dere-discord."""

from __future__ import annotations

import discord
from discord import AllowedMentions, app_commands
from loguru import logger

from .agent import DiscordAgent
from .config import DiscordBotConfig
from .daemon import DaemonClient
from .persona import PersonaProfile, PersonaService
from .session import SessionManager


class DereDiscordClient(discord.Client):
    """Discord client that bridges messages to Claude."""

    def __init__(
        self,
        *,
        config: DiscordBotConfig,
        sessions: SessionManager,
        agent: DiscordAgent,
        persona_service: PersonaService,
        daemon_client: DaemonClient,
    ):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)

        self.config = config
        self.sessions = sessions
        self.agent = agent
        self.persona_service = persona_service
        self.daemon = daemon_client
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        """Register slash commands when the bot starts."""

        @self.tree.command(name="persona", description="Set persona(s) for this channel.")
        @app_commands.describe(names="Comma-separated persona names (e.g. tsun,kuu).")
        async def persona_command(interaction: discord.Interaction, names: str):
            await self._handle_persona_command(interaction, names)

        await self.tree.sync()

    async def _handle_persona_command(self, interaction: discord.Interaction, names: str) -> None:
        if interaction.guild and not await self._can_modify_persona(interaction):
            await interaction.response.send_message(
                "You need the Manage Channels permission to change personas.",
                ephemeral=True,
            )
            return

        persona_names = tuple(part.strip() for part in names.split(",") if part.strip())
        target_channel = interaction.channel
        if target_channel is None:
            await interaction.response.send_message(
                "Unable to resolve channel for this command.", ephemeral=True
            )
            return

        guild_id = interaction.guild_id
        channel_id = target_channel.id

        try:
            resolved = await self.sessions.set_personas(
                guild_id=guild_id,
                channel_id=channel_id,
                personas=persona_names,
            )
            profile = self.persona_service.resolve(resolved)
        except ValueError as exc:
            logger.warning("Persona resolution failed: {}", exc)
            await interaction.response.send_message(str(exc), ephemeral=True)
            return

        icon = profile.icon or "✨"
        persona_label = ", ".join(profile.names)
        await interaction.response.send_message(
            f"{icon} Persona for this channel set to **{persona_label}**.",
            ephemeral=True,
        )

    async def _can_modify_persona(self, interaction: discord.Interaction) -> bool:
        if interaction.guild is None:
            return True

        member = interaction.user
        if not isinstance(member, discord.Member):
            return False

        perms = member.guild_permissions
        return perms.manage_channels or perms.administrator

    async def on_ready(self) -> None:
        if self.user:
            logger.info("Logged in as {} (id={})", self.user, self.user.id)
            self.sessions.set_bot_identity(self.user.display_name or self.user.name)

    async def close(self) -> None:
        try:
            await self.sessions.close_all()
            await self.daemon.close()
        finally:
            await super().close()

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot:
            return

        if self.user and message.author.id == self.user.id:
            return

        if not self._is_allowed_target(message):
            return

        content = message.clean_content.strip()
        if not content:
            return

        guild_id = message.guild.id if message.guild else None
        channel_id = message.channel.id
        user_id = message.author.id

        typing_cm = message.channel.typing()
        typing_active = True
        await typing_cm.__aenter__()

        async def send_initial() -> None:
            # Typing indicator already active; no placeholder message needed.
            return None

        async def send_text_message(text: str, persona_profile: PersonaProfile) -> None:
            content = text.strip() if text else ""
            if not content:
                return
            await message.channel.send(
                content,
                allowed_mentions=AllowedMentions.none(),
            )

        async def send_tool_summary(
            tool_events: list[str], persona_profile: PersonaProfile
        ) -> None:
            if not tool_events:
                return
            embed = self._build_embed_response(tool_events, persona_profile)
            await message.channel.send(
                embed=embed,
                allowed_mentions=AllowedMentions.none(),
            )

        async def finalize() -> None:
            nonlocal typing_active
            if typing_active:
                await typing_cm.__aexit__(None, None, None)
                typing_active = False

        try:
            await self.agent.handle_message(
                guild_id=guild_id,
                channel_id=channel_id,
                user_id=user_id,
                content=content,
                send_initial=send_initial,
                send_text_message=send_text_message,
                send_tool_summary=send_tool_summary,
                finalize=finalize,
            )
        except Exception as exc:  # pragma: no cover - network errors
            logger.exception("Failed handling message in channel {}: {}", channel_id, exc)
            await message.channel.send("Sorry, something went wrong while contacting Claude.")
        finally:
            if typing_active:
                try:
                    await typing_cm.__aexit__(None, None, None)
                except Exception:  # pragma: no cover - logging would be noisy
                    pass

    def _build_embed_response(
        self,
        tool_events: list[str],
        persona_profile: PersonaProfile,
    ) -> discord.Embed:
        joined = "\n".join(tool_events)
        embed = discord.Embed(
            description="",
            color=self._parse_color(persona_profile.color),
        )

        embed.add_field(
            name="Tool Activity",
            value=f"```{self._truncate(joined, 1000)}```",
            inline=False,
        )

        return embed

    @staticmethod
    def _parse_color(color: str | None) -> int:
        if not color:
            return 0x5865F2

        color = color.strip()
        if color.startswith("#"):
            color = color[1:]

        try:
            return int(color, 16)
        except ValueError:
            return 0x5865F2

    @staticmethod
    def _truncate(text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        return text[: limit - 1] + "…"

    def _is_allowed_target(self, message: discord.Message) -> bool:
        if message.guild:
            if (
                self.config.allowed_guilds
                and str(message.guild.id) not in self.config.allowed_guilds
            ):
                return False

        if self.config.allowed_channels:
            if str(message.channel.id) not in self.config.allowed_channels:
                return False

        return True
