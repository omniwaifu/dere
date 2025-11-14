"""Periodic monitoring loop for ambient awareness."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from loguru import logger

from .analyzer import ContextAnalyzer
from .config import AmbientConfig

if TYPE_CHECKING:
    from dere_graph.llm_client import ClaudeClient
    from dere_shared.personalities import PersonalityLoader


class AmbientMonitor:
    """Handles periodic monitoring and engagement logic as a background task."""

    def __init__(
        self,
        config: AmbientConfig,
        llm_client: ClaudeClient | None = None,
        personality_loader: PersonalityLoader | None = None,
    ):
        self.config = config
        self.analyzer = ContextAnalyzer(
            config, llm_client=llm_client, personality_loader=personality_loader
        )
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

        # Validate dependencies before starting
        await self._validate_dependencies()

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

    async def _validate_dependencies(self) -> None:
        """Validate dependencies and log warnings for any missing components."""
        warnings = []

        # Check LLM client
        if not self.analyzer.llm_client:
            warnings.append("LLM client not configured - engagement evaluation will be disabled")
        else:
            logger.info("LLM client configured")

        # Check ActivityWatch connectivity
        try:
            import socket

            hostname = socket.gethostname()
            window_events = self.analyzer.aw_client.get_window_events(hostname, lookback_minutes=1)
            if window_events:
                logger.info("ActivityWatch connected")
            else:
                warnings.append(
                    "ActivityWatch not returning events - ensure ActivityWatch is running"
                )
        except Exception as e:
            warnings.append(f"ActivityWatch check failed: {e}")

        # Skip daemon API check - ambient monitor runs inside the daemon

        # Log all warnings
        if warnings:
            logger.warning("Ambient monitor dependency issues detected:")
            for warning in warnings:
                logger.warning("  {}", warning)
            logger.warning(
                "Monitor will continue but functionality may be limited. "
                "Fix the issues above for full functionality."
            )
        else:
            logger.info("All dependencies validated successfully")

    async def _monitor_loop(self) -> None:
        """Main monitoring loop that runs periodically."""
        while self._running:
            try:
                logger.info("Ambient monitor: Running periodic check...")
                await self._check_and_engage()
            except Exception as e:
                logger.error("Error in ambient monitor loop: {}", e)

            logger.info(
                "Ambient monitor: Next check in {}m", self.config.check_interval_minutes
            )
            await asyncio.sleep(self.config.check_interval_minutes * 60)

    async def _check_and_engage(self) -> None:
        """Check context and engage if appropriate."""
        try:
            (
                should_engage,
                message,
                priority,
                target_medium,
                target_location,
                parent_notification_id,
            ) = await self.analyzer.should_engage()

            if should_engage and message and target_medium and target_location:
                # Create notification in queue for delivery by bots (Discord, Telegram, etc)
                import httpx

                user_id = self.config.user_id
                try:
                    async with httpx.AsyncClient() as client:
                        # Create notification via daemon API
                        payload = {
                            "user_id": user_id,
                            "target_medium": target_medium,
                            "target_location": target_location,
                            "message": message,
                            "priority": priority,
                            "routing_reasoning": "LLM-based ambient engagement",
                        }
                        if parent_notification_id:
                            payload["parent_notification_id"] = parent_notification_id

                        response = await client.post(
                            f"{self.config.daemon_url}/notifications/create",
                            json=payload,
                            timeout=10,
                        )
                        if response.status_code != 200:
                            logger.warning("Failed to queue notification: {}", response.status_code)
                except Exception as e:
                    logger.error("Failed to queue notification: {}", e)
            else:
                logger.info("Ambient check complete: No engagement needed at this time")

        except Exception as e:
            logger.error("Error during ambient check and engage: {}", e)
