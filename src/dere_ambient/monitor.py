"""Periodic monitoring loop for ambient awareness."""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

from .analyzer import ContextAnalyzer
from .config import AmbientConfig
from .notifier import Notifier


class AmbientMonitor:
    """Handles periodic monitoring and engagement logic as a background task."""

    def __init__(self, config: AmbientConfig):
        self.config = config
        self.analyzer = ContextAnalyzer(config)
        self.notifier = Notifier(config)
        self._running = False
        self._task: asyncio.Task[Any] | None = None

    async def start(self) -> None:
        """Start the monitoring loop."""
        if not self.config.enabled:
            logger.info("Ambient monitoring disabled in config")
            return

        if self._running:
            logger.warning("Ambient monitor already running")
            return

        self._running = True
        logger.info(
            "Starting ambient monitor (check interval: {}m, idle threshold: {}m)",
            self.config.check_interval_minutes,
            self.config.idle_threshold_minutes,
        )

        self._task = asyncio.create_task(self._monitor_loop())

    async def shutdown(self) -> None:
        """Stop the monitoring loop."""
        logger.info("Stopping ambient monitor...")
        self._running = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        logger.info("Ambient monitor stopped")

    async def _monitor_loop(self) -> None:
        """Main monitoring loop that runs periodically."""
        while self._running:
            try:
                await self._check_and_engage()
            except Exception as e:
                logger.error("Error in ambient monitor loop: {}", e)

            await asyncio.sleep(self.config.check_interval_minutes * 60)

    async def _check_and_engage(self) -> None:
        """Check context and engage if appropriate."""
        try:
            should_engage, message, priority, target_medium, target_location = (
                await self.analyzer.should_engage()
            )

            if should_engage and message and target_medium and target_location:
                logger.info(
                    "Ambient engaging with user: {} (priority: {}, routing: {} -> {})",
                    message,
                    priority,
                    target_medium,
                    target_location,
                )

                # Create notification in queue for delivery
                import httpx

                user_id = "default_user"  # TODO: Get from config
                try:
                    async with httpx.AsyncClient() as client:
                        # Create notification via daemon API
                        response = await client.post(
                            f"{self.config.daemon_url}/notifications/create",
                            json={
                                "user_id": user_id,
                                "target_medium": target_medium,
                                "target_location": target_location,
                                "message": message,
                                "priority": priority,
                                "routing_reasoning": "LLM-based ambient engagement",
                            },
                            timeout=10,
                        )
                        if response.status_code == 200:
                            logger.info("Ambient notification queued for delivery")
                        else:
                            logger.warning("Failed to queue notification: {}", response.status_code)

                            # Fallback to desktop notification if medium is desktop or queue failed
                            if target_medium == "desktop":
                                success = await self.notifier.send_notification(
                                    message=message,
                                    priority=priority,
                                    title="Dere Check-in",
                                )
                                if success:
                                    logger.info("Desktop notification sent successfully")
                except Exception as e:
                    logger.error("Failed to queue notification: {}", e)
                    # Fallback to desktop notification
                    success = await self.notifier.send_notification(
                        message=message,
                        priority=priority,
                        title="Dere Check-in",
                    )
            else:
                logger.debug("No ambient engagement needed at this time")

        except Exception as e:
            logger.error("Error during ambient check and engage: {}", e)
