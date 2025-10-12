"""Multi-channel notification system for ambient monitoring."""

from __future__ import annotations

import subprocess
from typing import Literal

import httpx
from loguru import logger

from .config import AmbientConfig


class Notifier:
    """Handles notifications across multiple channels."""

    def __init__(self, config: AmbientConfig):
        self.config = config

    async def send_notification(
        self,
        message: str,
        priority: Literal["alert", "conversation"] = "alert",
        title: str = "Dere Ambient",
    ) -> bool:
        """Send notification via configured channels.

        Args:
            message: Notification message content
            priority: 'alert' for simple notifications, 'conversation' for chat requests
            title: Notification title (for desktop notifications)

        Returns:
            True if notification was sent successfully via at least one channel
        """
        success = False

        if self.config.notification_method in ("notify-send", "both"):
            if await self._send_desktop_notification(title, message):
                success = True

        if self.config.notification_method in ("daemon", "both"):
            if await self._send_daemon_notification(message, priority):
                success = True

        return success

    async def _send_desktop_notification(self, title: str, message: str) -> bool:
        """Send desktop notification using notify-send.

        Args:
            title: Notification title
            message: Notification message

        Returns:
            True if notification sent successfully
        """
        try:
            result = subprocess.run(
                ["notify-send", title, message, "--urgency=normal", "--icon=dialog-information"],
                capture_output=True,
                timeout=5,
            )
            if result.returncode == 0:
                logger.info("Desktop notification sent: {}", message)
                return True
            logger.warning("notify-send failed with code {}", result.returncode)
            return False
        except FileNotFoundError:
            logger.debug("notify-send not available")
            return False
        except Exception as e:
            logger.error("Failed to send desktop notification: {}", e)
            return False

    async def _send_daemon_notification(
        self, message: str, priority: Literal["alert", "conversation"]
    ) -> bool:
        """Send notification to daemon for routing to Discord bot or other channels.

        Args:
            message: Notification message
            priority: Priority level for routing

        Returns:
            True if notification sent successfully
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.config.daemon_url}/ambient/notify",
                    json={"message": message, "priority": priority},
                    timeout=10,
                )
                if response.status_code == 200:
                    logger.info("Daemon notification sent: {}", message)
                    return True
                logger.warning("Daemon notification failed with status {}", response.status_code)
                return False
        except Exception as e:
            logger.error("Failed to send daemon notification: {}", e)
            return False
