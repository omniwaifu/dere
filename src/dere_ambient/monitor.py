"""Periodic monitoring loop for ambient awareness."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import TYPE_CHECKING, Any

from loguru import logger

from .analyzer import ContextAnalyzer
from .config import AmbientConfig
from .fsm import AmbientFSM, SignalWeights, StateIntervals

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

        # Initialize FSM if enabled
        if config.fsm_enabled:
            intervals = StateIntervals(
                idle=config.fsm_idle_interval,
                monitoring=config.fsm_monitoring_interval,
                engaged=config.fsm_engaged_interval,
                cooldown=config.fsm_cooldown_interval,
                escalating=config.fsm_escalating_interval,
                suppressed=config.fsm_suppressed_interval,
            )
            weights = SignalWeights(
                activity=config.fsm_weight_activity,
                emotion=config.fsm_weight_emotion,
                responsiveness=config.fsm_weight_responsiveness,
                temporal=config.fsm_weight_temporal,
                task=config.fsm_weight_task,
            )
            self.fsm = AmbientFSM(intervals=intervals, weights=weights)
            logger.info("Ambient FSM initialized")
        else:
            self.fsm = None
            logger.info("Ambient FSM disabled, using fixed intervals")

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

            # Calculate next interval (FSM-driven or fixed)
            if self.fsm:
                interval_seconds = self.fsm.calculate_next_interval()
                state = self.fsm.state
                logger.info(
                    f"Ambient FSM: {state.value} → sleeping {interval_seconds/60:.1f}m"
                )
            else:
                interval_seconds = self.config.check_interval_minutes * 60
                logger.info(
                    "Ambient monitor: Next check in {}m", self.config.check_interval_minutes
                )

            await asyncio.sleep(interval_seconds)

    async def _check_and_engage(self) -> None:
        """Check context and engage if appropriate."""
        try:
            # Evaluate FSM state transitions before engagement decision
            if self.fsm:
                await self._evaluate_fsm_state()

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
                        else:
                            # Transition to ENGAGED state after successful notification
                            if self.fsm:
                                from .fsm import AmbientState

                                self.fsm.transition_to(
                                    AmbientState.ENGAGED, "notification sent"
                                )
                                self.fsm.last_notification_time = asyncio.get_event_loop().time()
                except Exception as e:
                    logger.error("Failed to queue notification: {}", e)
            else:
                logger.info("Ambient check complete: No engagement needed at this time")

        except Exception as e:
            logger.error("Error during ambient check and engage: {}", e)

    async def _evaluate_fsm_state(self) -> None:
        """Evaluate FSM signals and transition state if appropriate."""
        if not self.fsm:
            return

        import httpx

        try:
            # Gather signals for FSM evaluation
            async with httpx.AsyncClient() as client:
                # Get current activity
                import socket

                hostname = socket.gethostname()
                window_events = self.analyzer.aw_client.get_window_events(
                    hostname, lookback_minutes=10
                )
                activity_data = {}
                if window_events:
                    latest = window_events[0]
                    activity_data = {
                        "app_name": latest.get("app", ""),
                        "duration_seconds": latest.get("duration", 0),
                    }

                # Get emotion state
                emotion_data = {"emotion_type": "neutral", "intensity": 0}
                try:
                    # Get most recent session for user (simplified - in practice need better session tracking)
                    response = await client.get(
                        f"{self.config.daemon_url}/emotion/summary/0",  # Placeholder
                        timeout=2.0,
                    )
                    if response.status_code == 200:
                        # Parse emotion from summary text
                        # This is simplified - actual implementation would need proper session tracking
                        pass
                except Exception:
                    pass

                # Get recent notifications for responsiveness signal
                notification_history = []
                try:
                    response = await client.get(
                        f"{self.config.daemon_url}/notifications/recent?user_id={self.config.user_id}&limit=5",
                        timeout=2.0,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        notification_history = data.get("notifications", [])
                except Exception:
                    pass

                # Get task data (simplified)
                task_data = {"overdue_count": 0, "due_soon_count": 0}

                # Current hour for temporal signal (use local timezone, not UTC)
                current_hour = datetime.now().hour

                # Evaluate state transition
                new_state = self.fsm.should_transition(
                    activity_data=activity_data,
                    emotion_data=emotion_data,
                    notification_history=notification_history,
                    task_data=task_data,
                    current_hour=current_hour,
                )

                if new_state:
                    self.fsm.transition_to(new_state, "signal evaluation")

        except Exception as e:
            logger.debug(f"Error evaluating FSM state: {e}")
