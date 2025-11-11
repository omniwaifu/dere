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
        self._resolved_user_id: str | None = None  # Cached resolved user ID

    async def setup_hook(self) -> None:
        """Register slash commands when the bot starts."""
        await self.tree.sync()

    async def on_ready(self) -> None:
        if self.user:
            logger.info("Logged in as {} (id={})", self.user, self.user.id)
            self.sessions.set_bot_identity(self.user.display_name or self.user.name)

            # Register presence with daemon
            await self._register_presence()

            # Start background tasks
            self.loop.create_task(self._heartbeat_loop())
            self.loop.create_task(self._notification_poll_loop())

    async def close(self) -> None:
        try:
            # Unregister presence
            if self._resolved_user_id:
                try:
                    await self.daemon.unregister_presence(self._resolved_user_id)
                except Exception as e:
                    logger.warning("Failed to unregister presence: {}", e)

            await self.sessions.close_all()
            await self.daemon.close()
        finally:
            await super().close()

    async def _register_presence(self) -> None:
        """Register bot presence with daemon on startup."""
        import asyncio

        if not self.user:
            return

        # Get user_id from config, bot owner, or use bot's own ID as fallback
        user_id = self.config.user_id
        if user_id is None:
            # Try to fetch bot owner from application info
            try:
                app_info = await self.application_info()
                if app_info.owner:
                    user_id = str(app_info.owner.id)
                    logger.info("Using bot owner ID {} for presence", user_id)
            except Exception as e:
                logger.warning("Could not fetch bot owner: {}", e)

        # Final fallback: use bot's own ID (suboptimal but functional)
        if user_id is None:
            user_id = str(self.user.id)
            logger.warning(
                "Using bot's own ID {} for presence (consider setting user_id in config)", user_id
            )

        # Cache the resolved user_id for use in other methods
        self._resolved_user_id = user_id

        # Get available channels
        channels = []
        for guild in self.guilds:
            for channel in guild.text_channels:
                if channel.permissions_for(guild.me).send_messages:
                    channels.append(
                        {
                            "id": str(channel.id),
                            "name": channel.name,
                            "type": "guild_text",
                            "guild_id": str(guild.id),
                            "guild_name": guild.name,
                        }
                    )

        # Add DM channels (can't enumerate easily, will be added dynamically)
        logger.info("Registering presence with {} channels", len(channels))

        # Retry with exponential backoff (daemon may not be ready yet)
        max_retries = 5
        for attempt in range(max_retries):
            try:
                await self.daemon.register_presence(user_id, channels)
                logger.info("Presence registered successfully")
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    delay = 2**attempt  # 1s, 2s, 4s, 8s, 16s
                    logger.warning(
                        "Failed to register presence (attempt {}/{}): {} - retrying in {}s",
                        attempt + 1,
                        max_retries,
                        e,
                        delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "Failed to register presence after {} attempts: {}", max_retries, e
                    )

    async def _heartbeat_loop(self) -> None:
        """Send heartbeat every 30s to keep presence alive."""
        if not self._resolved_user_id:
            return

        import asyncio

        while not self.is_closed():
            try:
                await asyncio.sleep(30)
                await self.daemon.heartbeat_presence(self._resolved_user_id)
            except Exception as e:
                logger.debug("Heartbeat failed: {}", e)

    async def _notification_poll_loop(self) -> None:
        """Poll for pending notifications every 10s."""
        if not self.user:
            return

        import asyncio

        while not self.is_closed():
            try:
                await asyncio.sleep(10)
                notifications = await self.daemon.get_pending_notifications()

                for notif in notifications:
                    asyncio.create_task(self._deliver_notification(notif))
            except Exception as e:
                logger.debug("Notification poll failed: {}", e)

    async def _deliver_notification(self, notif: dict) -> None:
        """Deliver a notification to Discord."""
        notification_id = notif["id"]
        target_location = notif["target_location"]
        message = notif["message"]

        try:
            # Parse target: could be channel ID or user ID for DM
            target_id = int(target_location)

            # Try as channel first
            channel = self.get_channel(target_id)

            if channel and isinstance(channel, discord.TextChannel):
                # Guild channel delivery
                await channel.send(message)
                await self.daemon.mark_notification_delivered(notification_id)
                logger.info(
                    "Notification {} delivered to channel {}", notification_id, channel.name
                )
            else:
                # Try as DM to user
                try:
                    user = await self.fetch_user(target_id)
                    await user.send(message)
                    await self.daemon.mark_notification_delivered(notification_id)
                    logger.info(
                        "Notification {} delivered to DM with user {}", notification_id, user.name
                    )
                except discord.Forbidden:
                    raise ValueError(
                        f"Cannot send DM to user {target_id} - DMs disabled or blocked"
                    )
                except discord.NotFound:
                    raise ValueError(f"User {target_id} not found")
        except Exception as e:
            logger.error("Failed to deliver notification {}: {}", notification_id, e)
            await self.daemon.mark_notification_failed(notification_id, str(e))

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
