"""Periodic monitoring loop for ambient awareness."""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any

from loguru import logger

from .analyzer import ContextAnalyzer
from .config import AmbientConfig
from .explorer import AmbientExplorer
from .fsm import AmbientFSM, AmbientState, SignalWeights, StateIntervals

if TYPE_CHECKING:
    from dere_graph.graph import DereGraph

    from dere_daemon.missions.executor import MissionExecutor
    from dere_daemon.work_queue import WorkQueueCoordinator
    from dere_shared.personalities import PersonalityLoader


class AmbientMonitor:
    """Handles periodic monitoring and engagement logic as a background task."""

    def __init__(
        self,
        config: AmbientConfig,
        personality_loader: PersonalityLoader | None = None,
        mission_executor: MissionExecutor | None = None,
        session_factory: Any | None = None,
        work_queue: WorkQueueCoordinator | None = None,
        dere_graph: DereGraph | None = None,
    ):
        self.config = config
        self.analyzer = ContextAnalyzer(config, personality_loader=personality_loader)
        self._running = False
        self._task: asyncio.Task[Any] | None = None
        self._mission_executor = mission_executor
        self._session_factory = session_factory
        self._work_queue = work_queue
        self._dere_graph = dere_graph
        self._last_check_at: datetime | None = None
        self._activity_streak_key: tuple[str, str] | None = None
        self._activity_streak_seconds: float = 0.0
        self._activity_streak_updated_at: datetime | None = None
        self._last_exploration_at: datetime | None = None
        self._exploration_day: date | None = None
        self._explorations_today: int = 0
        self.explorer: AmbientExplorer | None = None

        # Initialize FSM if enabled
        if config.fsm_enabled:
            intervals = StateIntervals(
                idle=config.fsm_idle_interval,
                monitoring=config.fsm_monitoring_interval,
                engaged=config.fsm_engaged_interval,
                cooldown=config.fsm_cooldown_interval,
                escalating=config.fsm_escalating_interval,
                suppressed=config.fsm_suppressed_interval,
                exploring=config.exploring.exploration_interval_minutes,
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

        if (
            config.exploring.enabled
            and self._mission_executor
            and self._session_factory
        ):
            self.explorer = AmbientExplorer(
                config=config,
                mission_executor=self._mission_executor,
                session_factory=self._session_factory,
                work_queue=self._work_queue,
                dere_graph=self._dere_graph,
            )
            logger.info("Ambient explorer initialized")
        elif config.exploring.enabled:
            logger.warning(
                "Ambient exploration disabled (missing mission executor or session factory)"
            )

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

        if self.config.startup_delay_seconds > 0:
            logger.info(
                "Ambient monitor will delay {}s before first check",
                self.config.startup_delay_seconds,
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

    async def _validate_dependencies(self) -> None:
        """Validate dependencies and log warnings for any missing components."""
        warnings = []

        # Check ActivityWatch connectivity
        try:
            snapshot = await self.analyzer._get_activity_snapshot(lookback_minutes=1, top_n=1)
            if snapshot and snapshot.get("status") != "empty":
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
        # Apply startup delay before first check
        if self.config.startup_delay_seconds > 0:
            logger.info(
                "Delaying first ambient check by {}s",
                self.config.startup_delay_seconds,
            )
            await asyncio.sleep(self.config.startup_delay_seconds)

        # Validate dependencies after delay
        await self._validate_dependencies()

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
                logger.info(f"Ambient FSM: {state.value} → sleeping {interval_seconds / 60:.1f}m")
            else:
                interval_seconds = self.config.check_interval_minutes * 60
                logger.info(
                    "Ambient monitor: Next check in {}m", self.config.check_interval_minutes
                )

            await asyncio.sleep(interval_seconds)

    async def _check_and_engage(self) -> None:
        """Check context and engage if appropriate."""
        try:
            now = datetime.now(UTC)
            lookback_minutes = self._compute_activity_lookback_minutes(now)
            current_activity = await self.analyzer.get_current_activity(lookback_minutes)
            current_activity = self._update_activity_streak(current_activity, now)
            self._last_check_at = now

            # Evaluate FSM state transitions before engagement decision
            if self.fsm:
                await self._evaluate_fsm_state()

            if await self._maybe_run_exploration(
                now=now,
                lookback_minutes=lookback_minutes,
                current_activity=current_activity,
            ):
                return

            # Hard minimum interval check (overrides FSM timing)
            if self.fsm and self.fsm.last_notification_time is not None:
                elapsed = asyncio.get_event_loop().time() - self.fsm.last_notification_time
                min_interval_seconds = self.config.min_notification_interval_minutes * 60
                if elapsed < min_interval_seconds:
                    remaining = (min_interval_seconds - elapsed) / 60
                    logger.info(
                        "Skipping check: minimum interval not elapsed ({:.0f}m remaining)",
                        remaining,
                    )
                    return

            should_engage, context_snapshot = await self.analyzer.should_engage(
                activity_lookback_minutes=lookback_minutes,
                current_activity=current_activity,
            )

            if should_engage and context_snapshot:
                if current_activity:
                    context_snapshot["activity"] = current_activity
                result = await self._run_ambient_mission(context_snapshot)
                if result:
                    message, priority, confidence = result
                    await self._deliver_notification(
                        message=message,
                        priority=priority,
                        context_snapshot=context_snapshot,
                    )
                    if self.fsm:
                        self.fsm.transition_to(AmbientState.ENGAGED, "notification sent")
                        self.fsm.last_notification_time = asyncio.get_event_loop().time()
                else:
                    logger.info("Ambient mission produced no actionable output")
            else:
                logger.info("Ambient check complete: No engagement needed at this time")

        except Exception as e:
            logger.error("Error during ambient check and engage: {}", e)

    async def _maybe_run_exploration(
        self,
        *,
        now: datetime,
        lookback_minutes: int,
        current_activity: dict[str, Any] | None,
    ) -> bool:
        if not self.explorer or not self.config.exploring.enabled:
            return False

        if self.fsm and self.fsm.state in (AmbientState.ENGAGED, AmbientState.ESCALATING):
            return False

        # Reset daily counter on new day
        if self._exploration_day != now.date():
            self._exploration_day = now.date()
            self._explorations_today = 0

        if (
            self._explorations_today
            >= self.config.exploring.max_explorations_per_day
        ):
            if self.fsm and self.fsm.state == AmbientState.EXPLORING:
                self.fsm.transition_to(AmbientState.IDLE, "daily exploration limit reached")
            return False

        if not await self.explorer.has_pending_curiosities():
            if self.fsm and self.fsm.state == AmbientState.EXPLORING:
                self.fsm.transition_to(AmbientState.IDLE, "no curiosity backlog")
            return False

        # Check if we should force exploration due to time elapsed
        max_hours = self.config.exploring.max_hours_between_explorations
        force_exploration = False
        if max_hours > 0:
            if self._last_exploration_at is None:
                # Cold start: no exploration history, force first one
                force_exploration = True
                logger.info("Forcing exploration: first run (no history)")
            else:
                hours_since = (now - self._last_exploration_at).total_seconds() / 3600
                if hours_since >= max_hours:
                    force_exploration = True
                    logger.info(
                        "Forcing exploration: {:.1f}h since last (threshold: {:.1f}h)",
                        hours_since,
                        max_hours,
                    )

        # If not forcing, check idle/AFK requirements
        if not force_exploration:
            last_interaction = await self.analyzer._get_last_interaction_time()
            if last_interaction:
                minutes_idle = (time.time() - last_interaction) / 60
                if minutes_idle < self.config.exploring.min_idle_minutes:
                    if self.fsm and self.fsm.state == AmbientState.EXPLORING:
                        self.fsm.transition_to(AmbientState.MONITORING, "user active")
                    return False

            is_away = current_activity is None
            if not is_away:
                is_away = await self.analyzer._is_user_afk(lookback_minutes)

            if not is_away:
                if self.fsm and self.fsm.state == AmbientState.EXPLORING:
                    self.fsm.transition_to(AmbientState.MONITORING, "user active")
                return False

        if self.fsm and self.fsm.state != AmbientState.EXPLORING:
            reason = "time threshold reached" if force_exploration else "idle and backlog available"
            self.fsm.transition_to(AmbientState.EXPLORING, reason)

        outcome = await self.explorer.explore_next()
        if outcome is None:
            if self.fsm and self.fsm.state == AmbientState.EXPLORING:
                self.fsm.transition_to(AmbientState.IDLE, "no claimable curiosity tasks")
            return False

        self._explorations_today += 1
        self._last_exploration_at = now

        if outcome.result and outcome.result.worth_sharing and outcome.result.confidence >= 0.8:
            logger.info("Exploration produced a high-confidence shareable finding")

        return True

    def _compute_activity_lookback_minutes(self, now: datetime) -> int:
        max_lookback = max(10, self.config.activity_lookback_hours * 60)
        min_lookback = 10
        if self._last_check_at:
            delta_minutes = int((now - self._last_check_at).total_seconds() / 60)
        else:
            delta_minutes = self.config.check_interval_minutes
        return max(min_lookback, min(max_lookback, delta_minutes))

    def _update_activity_streak(
        self,
        activity: dict[str, Any] | None,
        now: datetime,
    ) -> dict[str, Any] | None:
        if not activity:
            self._activity_streak_key = None
            self._activity_streak_seconds = 0.0
            self._activity_streak_updated_at = now
            return None

        app = (activity.get("app") or "").strip()
        title = (activity.get("title") or "").strip()
        if not app and not title:
            self._activity_streak_key = None
            self._activity_streak_seconds = 0.0
            self._activity_streak_updated_at = now
            return activity

        # NOTE: streak key includes title; title changes will reset streak. Consider app-only key if noisy.
        key = (app, title)
        if self._activity_streak_key == key:
            if self._activity_streak_updated_at:
                delta_seconds = (now - self._activity_streak_updated_at).total_seconds()
                if delta_seconds > 0:
                    self._activity_streak_seconds += delta_seconds
        else:
            self._activity_streak_key = key
            self._activity_streak_seconds = float(activity.get("duration") or 0)

        self._activity_streak_updated_at = now

        streak_seconds = int(self._activity_streak_seconds)
        activity["duration_window_seconds"] = activity.get("duration")
        activity["duration"] = streak_seconds
        activity["streak_seconds"] = streak_seconds
        activity["streak_minutes"] = int(streak_seconds / 60)
        return activity

    async def _deliver_notification(
        self,
        *,
        message: str,
        priority: str,
        context_snapshot: dict[str, Any],
        parent_notification_id: int | None = None,
    ) -> None:
        import httpx

        user_id = self.config.user_id

        routing = await self.analyzer._route_message(
            message=message,
            priority=priority,
            user_activity=context_snapshot.get("activity", {}),
        )
        if not routing:
            logger.info("Ambient routing skipped notification delivery")
            return

        target_medium, target_location, routing_reason = routing
        if parent_notification_id is None:
            previous_notifications = context_snapshot.get("previous_notifications") or []
            if previous_notifications:
                parent_notification_id = previous_notifications[0].get("id")

        try:
            async with httpx.AsyncClient() as client:
                payload = {
                    "user_id": user_id,
                    "target_medium": target_medium,
                    "target_location": target_location,
                    "message": message,
                    "priority": priority,
                    "routing_reasoning": routing_reason or "ambient mission",
                    "context_snapshot": context_snapshot,
                    "trigger_type": "ambient_mission",
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

    async def _run_ambient_mission(
        self, context_snapshot: dict[str, Any]
    ) -> tuple[str, str, float] | None:
        if not self._mission_executor or not self._session_factory:
            logger.warning("Ambient mission executor not configured")
            return None

        from datetime import UTC, datetime

        from dere_shared.models import (
            AmbientMissionDecision,
            Mission,
            MissionStatus,
            MissionTriggerType,
        )

        prompt = self._build_mission_prompt(context_snapshot)
        now = datetime.now(UTC)
        mission_name = f"ambient-{now.isoformat()}"

        async with self._session_factory() as db:
            mission = Mission(
                name=mission_name,
                description="Ambient micro-session",
                prompt=prompt,
                cron_expression="0 0 * * *",
                run_once=True,
                status=MissionStatus.PAUSED.value,
                next_execution_at=None,
                personality=self.config.personality,
                model="claude-haiku-4-5",
                sandbox_mode=True,
                sandbox_mount_type="none",
            )
            db.add(mission)
            await db.commit()
            await db.refresh(mission)

        execution = await self._mission_executor.execute(
            mission,
            trigger_type=MissionTriggerType.MANUAL.value,
            triggered_by="ambient",
            response_model=AmbientMissionDecision,
        )

        async with self._session_factory() as db:
            db_mission = await db.get(Mission, mission.id)
            if db_mission:
                db_mission.status = MissionStatus.ARCHIVED.value
                db_mission.updated_at = datetime.now(UTC)
                await db.commit()

        if not execution:
            return None

        structured_output = None
        if execution.execution_metadata:
            structured_output = execution.execution_metadata.get("structured_output")

        parsed = None
        if structured_output:
            try:
                parsed = AmbientMissionDecision.model_validate(structured_output).model_dump()
            except Exception:
                parsed = None

        if parsed is None and execution.output_text:
            parsed = self._parse_mission_output(execution.output_text)

        if not parsed or not parsed.get("send"):
            return None

        message = parsed.get("message")
        priority = parsed.get("priority") or "conversation"
        confidence = float(parsed.get("confidence") or 0)
        if not message or confidence < 0.5:
            return None

        return message, priority, confidence

    def _build_mission_prompt(self, context_snapshot: dict[str, Any]) -> str:
        payload = json.dumps(context_snapshot, ensure_ascii=True)
        return (
            "You are an ambient agent. Use the context to decide if there is a high-signal, "
            "actionable message to send. If there is nothing useful, respond with send=false.\n\n"
            "Return structured output that matches the configured JSON schema.\n\n"
            f"Context:\n{payload}\n"
        )

    def _parse_mission_output(self, text: str) -> dict[str, Any] | None:
        import json as _json
        import re as _re

        code_block = _re.search(r"```json\s*(\{.*?\})\s*```", text, _re.S)
        if code_block:
            try:
                return _json.loads(code_block.group(1))
            except Exception:
                return None

        decoder = _json.JSONDecoder()
        for match in _re.finditer(r"\{", text):
            try:
                obj, _ = decoder.raw_decode(text[match.start():])
                if isinstance(obj, dict):
                    return obj
            except Exception:
                continue
        return None

    async def _evaluate_fsm_state(self) -> None:
        """Evaluate FSM signals and transition state if appropriate."""
        if not self.fsm:
            return

        import httpx

        try:
            # Gather signals for FSM evaluation
            async with httpx.AsyncClient() as client:
                # Get current activity
                activity_data = {}
                snapshot = await self.analyzer._get_activity_snapshot(
                    lookback_minutes=10,
                    top_n=1,
                )
                if snapshot:
                    current = snapshot.get("current_window") or snapshot.get("current_media")
                    if current:
                        activity_data = {
                            "app_name": current.get("app") or current.get("player") or "",
                            "duration_seconds": current.get("duration_seconds", 0),
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

                # Get bond data
                bond_data = {"affection_level": 50.0, "trend": "stable", "streak_days": 0}
                try:
                    response = await client.get(
                        f"{self.config.daemon_url}/dashboard/state",
                        timeout=2.0,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("bond"):
                            bond_data = {
                                "affection_level": data["bond"].get("affection_level", 50.0),
                                "trend": data["bond"].get("trend", "stable"),
                                "streak_days": data["bond"].get("streak_days", 0),
                            }
                except Exception:
                    pass

                # Current hour for temporal signal (use local timezone, not UTC)
                current_hour = datetime.now().hour

                # Evaluate state transition
                new_state = self.fsm.should_transition(
                    activity_data=activity_data,
                    emotion_data=emotion_data,
                    notification_history=notification_history,
                    task_data=task_data,
                    current_hour=current_hour,
                    bond_data=bond_data,
                )

                if new_state:
                    self.fsm.transition_to(new_state, "signal evaluation")

        except Exception as e:
            logger.debug(f"Error evaluating FSM state: {e}")
