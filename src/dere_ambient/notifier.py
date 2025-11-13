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
        """Send desktop notification via notify-send.

        Args:
            message: Notification message content
            priority: 'alert' for simple notifications, 'conversation' for chat requests
            title: Notification title (for desktop notifications)

        Returns:
            True if notification was sent successfully
        """
        return await self._send_desktop_notification(title, message)

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
                [
                    "notify-send",
                    title,
                    message,
                    "--urgency=normal",
                    "--icon=dialog-information",
                    "--expire-time=15000",
                ],
                capture_output=True,
                timeout=5,
            )
            if result.returncode == 0:
                logger.debug("Desktop notification sent: {}", message)
                return True
            logger.warning("notify-send failed with code {}", result.returncode)
            return False
        except FileNotFoundError:
            logger.debug("notify-send not available")
            return False
        except Exception as e:
            logger.error("Failed to send desktop notification: {}", e)
            return False
