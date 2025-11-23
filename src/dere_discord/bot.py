"""discord.py bot runtime for dere-discord."""

from __future__ import annotations

import discord
from discord import app_commands
from loguru import logger

from .agent import DiscordAgent
from .config import DiscordBotConfig
from .daemon import DaemonClient
from .message_handler import handle_discord_message
from .persona import PersonaProfile, PersonaService
from .retry import exponential_backoff_retry
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
        self._recent_notifications: dict[int, list[int]] = {}  # channel_id -> [notification_ids]

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
        if not self.user:
            return

        # Get system user_id (platform-agnostic identifier)
        # This should come from global config and defaults to system username
        import getpass

        system_user_id = self.config.user_id or getpass.getuser()

        # Get Discord owner ID for DM delivery (platform-specific)
        discord_owner_id = None
        try:
            app_info = await self.application_info()
            if app_info.owner:
                discord_owner_id = str(app_info.owner.id)
                logger.info("Discord bot owner ID: {}", discord_owner_id)
        except Exception as e:
            logger.warning("Could not fetch bot owner: {}", e)

        # Cache the resolved user_id for use in other methods
        self._resolved_user_id = system_user_id

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

        # Add DM channel for ambient notifications (use Discord owner ID as target)
        if discord_owner_id:
            channels.append(
                {
                    "id": discord_owner_id,
                    "name": "Direct Message",
                    "type": "dm",
                }
            )
        else:
            logger.warning("No Discord owner ID available - DM notifications will not work")

        logger.info(
            "Registering presence for system user {} with {} channels",
            system_user_id,
            len(channels),
        )

        # Register with daemon using retry decorator
        await self._do_register_presence(system_user_id, channels)
        logger.info("Presence registered successfully")

    @exponential_backoff_retry(max_retries=5, base_delay=1.0, operation_name="presence registration")
    async def _do_register_presence(self, user_id: str, channels: list[dict]) -> None:
        """Perform presence registration with retry logic.

        This method is decorated with exponential_backoff_retry to handle
        transient failures when the daemon may not be ready yet.
        """
        await self.daemon.register_presence(user_id, channels)

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

                # Track notification for acknowledgment
                if target_id not in self._recent_notifications:
                    self._recent_notifications[target_id] = []
                self._recent_notifications[target_id].append(notification_id)

                logger.info(
                    "Notification {} delivered to channel {}", notification_id, channel.name
                )
            else:
                # Try as DM to user
                try:
                    user = await self.fetch_user(target_id)
                    await user.send(message)
                    await self.daemon.mark_notification_delivered(notification_id)

                    # Track notification for acknowledgment (use user ID for DMs)
                    if target_id not in self._recent_notifications:
                        self._recent_notifications[target_id] = []
                    self._recent_notifications[target_id].append(notification_id)

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
        """Handle incoming Discord messages with automatic typing indicator management."""
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

        # Acknowledge any recent notifications in this channel/DM
        notification_key = channel_id if message.guild else user_id
        if notification_key in self._recent_notifications:
            for notif_id in self._recent_notifications[notification_key]:
                try:
                    await self.daemon.mark_notification_acknowledged(notif_id)
                    logger.debug("Notification {} acknowledged", notif_id)
                except Exception as e:
                    logger.warning("Failed to acknowledge notification {}: {}", notif_id, e)
            # Clear acknowledged notifications
            del self._recent_notifications[notification_key]

        # Handle message with automatic typing indicator management
        await handle_discord_message(
            message=message,
            agent=self.agent,
            guild_id=guild_id,
            channel_id=channel_id,
            user_id=user_id,
            content=content,
            build_embed_fn=self._build_embed_response,
        )

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
