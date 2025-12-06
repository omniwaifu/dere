"""Rare event generator for spontaneous personality events.

This background task periodically checks triggers and generates
rare events based on bond level, emotion state, activity patterns,
and time-based factors.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlmodel import select

from dere_shared.models import RareEvent, RareEventType


@dataclass
class EventConfig:
    """Configuration for the event generator."""

    check_interval_seconds: int = 300  # Check every 5 minutes
    cooldown_minutes: int = 60  # Minimum time between events
    daily_event_limit: int = 5  # Max events per day

    # Probability weights (0-1) for each event type at high bond
    note_probability: float = 0.15
    observation_probability: float = 0.20
    mood_shift_probability: float = 0.10
    memory_probability: float = 0.05
    greeting_probability: float = 0.30  # Higher for greetings at appropriate times

    # Bond thresholds
    min_bond_for_notes: float = 40.0
    min_bond_for_memory: float = 60.0


@dataclass
class TriggerContext:
    """Current state context for trigger evaluation."""

    # Bond state
    affection_level: float
    bond_trend: str
    streak_days: int

    # Emotion state
    emotion_type: str
    emotion_intensity: float

    # Activity state
    is_idle: bool
    idle_minutes: int
    activity_category: str

    # Temporal
    hour: int
    is_morning: bool
    is_evening: bool
    day_of_week: str


class RareEventGenerator:
    """Generates rare/spontaneous events based on triggers.

    The generator runs as a background task, periodically checking
    if conditions are right for generating an event.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        config: EventConfig | None = None,
        user_id: str = "default",
    ):
        self.session_factory = session_factory
        self.config = config or EventConfig()
        self.user_id = user_id
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        """Start the background event generation task."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("[RareEventGenerator] Started event generation loop")

    async def stop(self) -> None:
        """Stop the background task."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("[RareEventGenerator] Stopped event generation loop")

    async def _run_loop(self) -> None:
        """Main loop that periodically checks for event triggers."""
        while self._running:
            try:
                await self._check_and_generate()
            except Exception as e:
                logger.error(f"[RareEventGenerator] Error in loop: {e}")

            await asyncio.sleep(self.config.check_interval_seconds)

    async def _check_and_generate(self) -> None:
        """Check triggers and potentially generate an event."""
        # Check cooldown
        if not await self._cooldown_passed():
            return

        # Check daily limit
        if await self._daily_limit_reached():
            return

        # Get current context
        context = await self._get_trigger_context()
        if context is None:
            return

        # Evaluate triggers and pick event type
        event_type = self._evaluate_triggers(context)
        if event_type is None:
            return

        # Generate the event
        await self._create_event(event_type, context)

    async def _cooldown_passed(self) -> bool:
        """Check if enough time has passed since the last event."""
        async with self.session_factory() as session:
            cutoff = datetime.now(UTC) - timedelta(minutes=self.config.cooldown_minutes)
            stmt = (
                select(RareEvent)
                .where(RareEvent.user_id == self.user_id)
                .where(RareEvent.created_at >= cutoff)
                .limit(1)
            )
            result = await session.execute(stmt)
            recent = result.scalar_one_or_none()
            return recent is None

    async def _daily_limit_reached(self) -> bool:
        """Check if daily event limit has been reached."""
        async with self.session_factory() as session:
            today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
            stmt = (
                select(RareEvent)
                .where(RareEvent.user_id == self.user_id)
                .where(RareEvent.created_at >= today_start)
            )
            result = await session.execute(stmt)
            count = len(result.scalars().all())
            return count >= self.config.daily_event_limit

    async def _get_trigger_context(self) -> TriggerContext | None:
        """Fetch current state from dashboard API."""
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                resp = await client.get("http://127.0.0.1:8787/dashboard/state")
                if resp.status_code != 200:
                    return None
                data = resp.json()

            now = datetime.now()
            hour = now.hour

            return TriggerContext(
                affection_level=data.get("bond", {}).get("affection_level", 50.0),
                bond_trend=data.get("bond", {}).get("trend", "stable"),
                streak_days=data.get("bond", {}).get("streak_days", 0),
                emotion_type=data.get("emotion", {}).get("type", "neutral"),
                emotion_intensity=data.get("emotion", {}).get("intensity", 0.0),
                is_idle=data.get("activity", {}).get("is_idle", True),
                idle_minutes=data.get("activity", {}).get("idle_duration_seconds", 0) // 60,
                activity_category=data.get("activity", {}).get("activity_category", "absent"),
                hour=hour,
                is_morning=5 <= hour < 12,
                is_evening=17 <= hour < 22,
                day_of_week=now.strftime("%A"),
            )
        except Exception as e:
            logger.warning(f"[RareEventGenerator] Failed to get context: {e}")
            return None

    def _evaluate_triggers(self, ctx: TriggerContext) -> RareEventType | None:
        """Evaluate which event type (if any) should be triggered.

        Returns None if no event should be generated.
        """
        # Calculate base probability modifier from bond level
        # Higher bond = more likely to generate events
        bond_modifier = ctx.affection_level / 100.0

        candidates: list[tuple[RareEventType, float]] = []

        # Greeting: morning or evening, not idle, decent bond
        if ctx.is_morning or ctx.is_evening:
            if not ctx.is_idle and ctx.affection_level >= 30:
                prob = self.config.greeting_probability * bond_modifier
                # Boost for morning greetings
                if ctx.is_morning:
                    prob *= 1.3
                candidates.append((RareEventType.GREETING, prob))

        # Note: requires minimum bond, more likely when user is productive
        if ctx.affection_level >= self.config.min_bond_for_notes:
            prob = self.config.note_probability * bond_modifier
            if ctx.activity_category == "productive":
                prob *= 1.2
            candidates.append((RareEventType.NOTE, prob))

        # Observation: noticing user activity patterns
        if ctx.affection_level >= 35:
            prob = self.config.observation_probability * bond_modifier
            # Boost when user has been idle for a while
            if ctx.idle_minutes > 30:
                prob *= 1.3
            candidates.append((RareEventType.OBSERVATION, prob))

        # Mood shift: triggered by strong emotions
        if ctx.emotion_intensity > 0.6:
            prob = self.config.mood_shift_probability * bond_modifier * ctx.emotion_intensity
            candidates.append((RareEventType.MOOD_SHIFT, prob))

        # Memory: recalls something from the past (requires high bond)
        if ctx.affection_level >= self.config.min_bond_for_memory:
            prob = self.config.memory_probability * bond_modifier
            # Boost on weekends or evenings (reflective times)
            if ctx.day_of_week in ("Saturday", "Sunday") or ctx.is_evening:
                prob *= 1.5
            candidates.append((RareEventType.MEMORY, prob))

        if not candidates:
            return None

        # Apply randomness and pick
        # Each candidate has a probability; roll for each
        for event_type, probability in candidates:
            if random.random() < probability:
                return event_type

        return None

    async def _create_event(self, event_type: RareEventType, ctx: TriggerContext) -> None:
        """Create and store a rare event."""
        # Build trigger context for storage
        trigger_context = {
            "affection_level": ctx.affection_level,
            "bond_trend": ctx.bond_trend,
            "streak_days": ctx.streak_days,
            "emotion_type": ctx.emotion_type,
            "emotion_intensity": ctx.emotion_intensity,
            "activity_category": ctx.activity_category,
            "hour": ctx.hour,
        }

        # Build trigger reason
        reason = self._build_trigger_reason(event_type, ctx)

        # Content will be generated by LLM when displayed
        # For now, store minimal content hint
        content = self._build_content_hint(event_type, ctx)

        async with self.session_factory() as session:
            event = RareEvent(
                user_id=self.user_id,
                event_type=event_type.value,
                content=content,
                trigger_reason=reason,
                trigger_context=trigger_context,
            )
            session.add(event)
            await session.commit()

        logger.info(
            f"[RareEventGenerator] Created {event_type.value} event: {reason}"
        )

    def _build_trigger_reason(self, event_type: RareEventType, ctx: TriggerContext) -> str:
        """Build human-readable trigger reason."""
        match event_type:
            case RareEventType.GREETING:
                time_of_day = "morning" if ctx.is_morning else "evening"
                return f"{time_of_day} greeting, bond={ctx.affection_level:.0f}"
            case RareEventType.NOTE:
                return f"spontaneous note, activity={ctx.activity_category}"
            case RareEventType.OBSERVATION:
                if ctx.idle_minutes > 30:
                    return f"noticed user idle for {ctx.idle_minutes} minutes"
                return f"activity observation: {ctx.activity_category}"
            case RareEventType.MOOD_SHIFT:
                return f"emotion spike: {ctx.emotion_type} at {ctx.emotion_intensity:.1f}"
            case RareEventType.MEMORY:
                return f"memory surfaced, streak={ctx.streak_days}, bond={ctx.affection_level:.0f}"
            case _:
                return "unknown trigger"

    def _build_content_hint(self, event_type: RareEventType, ctx: TriggerContext) -> dict:
        """Build content hints for LLM generation.

        The actual message will be generated by personality system
        when the event is displayed.
        """
        match event_type:
            case RareEventType.GREETING:
                return {
                    "type": "greeting",
                    "time_of_day": "morning" if ctx.is_morning else "evening",
                    "warmth": "high" if ctx.affection_level >= 70 else "medium",
                }
            case RareEventType.NOTE:
                return {
                    "type": "note",
                    "activity_context": ctx.activity_category,
                    "tone": "encouraging" if ctx.bond_trend == "rising" else "neutral",
                }
            case RareEventType.OBSERVATION:
                return {
                    "type": "observation",
                    "idle_minutes": ctx.idle_minutes,
                    "activity": ctx.activity_category,
                }
            case RareEventType.MOOD_SHIFT:
                return {
                    "type": "mood_shift",
                    "emotion": ctx.emotion_type,
                    "intensity": ctx.emotion_intensity,
                }
            case RareEventType.MEMORY:
                return {
                    "type": "memory",
                    "streak_days": ctx.streak_days,
                    "warmth": "high" if ctx.affection_level >= 70 else "medium",
                }
            case _:
                return {"type": "unknown"}
