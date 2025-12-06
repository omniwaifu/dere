"""Bond system manager - tracks HER affection level toward the user.

This is distinct from the emotion system which tracks the USER's emotions.
The bond system represents her relationship state with the user over time.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from enum import Enum
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from dere_shared.models import BondState, BondTrend

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import async_sessionmaker


class InteractionQuality(str, Enum):
    """Quality classification for interactions."""

    MINIMAL = "minimal"  # Short, transactional exchanges
    STANDARD = "standard"  # Normal conversation
    MEANINGFUL = "meaningful"  # Extended engagement, personal topics
    EXCEPTIONAL = "exceptional"  # Deep connection, vulnerability, creativity


@dataclass
class BondConfig:
    """Configuration for bond decay and growth."""

    # Decay rates (per hour)
    base_decay_rate: float = 0.5  # Affection points lost per hour when absent
    max_decay_rate: float = 2.0  # Maximum decay rate at very low bond levels
    decay_acceleration_threshold: float = 30.0  # Below this, decay accelerates

    # Growth rates
    minimal_interaction_gain: float = 0.5
    standard_interaction_gain: float = 1.5
    meaningful_interaction_gain: float = 4.0
    exceptional_interaction_gain: float = 8.0

    # Streak bonuses
    streak_bonus_multiplier: float = 0.1  # +10% per streak day
    max_streak_bonus: float = 0.5  # Cap at +50%
    streak_break_penalty: float = 5.0  # Affection lost when streak breaks

    # Bounds
    min_affection: float = 0.0
    max_affection: float = 100.0
    starting_affection: float = 50.0

    # Trend calculation
    trend_window_days: int = 7
    rising_threshold: float = 5.0  # Net gain over window
    falling_threshold: float = -5.0  # Net loss over window
    distant_threshold: float = 20.0  # Absolute level below which "distant"


@dataclass
class BondUpdate:
    """Result of a bond update operation."""

    old_affection: float
    new_affection: float
    old_trend: str
    new_trend: str
    delta: float
    streak_days: int
    reasoning: str


class BondManager:
    """Manages her affection/bond state with the user.

    The bond represents how she feels about the user based on:
    - Interaction frequency (neglect causes decay)
    - Interaction quality (meaningful conversations grow bond)
    - Consistency (streaks provide bonuses)
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        config: BondConfig | None = None,
        user_id: str = "default",
    ):
        self.session_factory = session_factory
        self.config = config or BondConfig()
        self.user_id = user_id
        self._cached_state: BondState | None = None

    async def get_state(self) -> BondState:
        """Get current bond state, creating if needed."""
        if self._cached_state is not None:
            return self._cached_state

        async with self.session_factory() as session:
            stmt = select(BondState).where(BondState.user_id == self.user_id)
            result = await session.execute(stmt)
            state = result.scalar_one_or_none()

            if state is None:
                state = BondState(
                    user_id=self.user_id,
                    affection_level=self.config.starting_affection,
                    trend=BondTrend.STABLE.value,
                    last_interaction_at=datetime.now(UTC),
                    last_meaningful_at=None,
                    streak_days=0,
                    streak_last_date=None,
                    affection_history=[],
                )
                session.add(state)
                await session.commit()
                await session.refresh(state)
                logger.info(f"[BondManager] Created new bond state for user {self.user_id}")

            self._cached_state = state
            return state

    async def apply_decay(self) -> BondUpdate | None:
        """Apply time-based affection decay.

        Call this periodically (e.g., every hour or on interaction).
        Returns None if no significant decay occurred.
        """
        state = await self.get_state()
        now = datetime.now(UTC)

        # Ensure timezone-aware comparison
        last_interaction = state.last_interaction_at
        if last_interaction.tzinfo is None:
            last_interaction = last_interaction.replace(tzinfo=UTC)

        hours_elapsed = (now - last_interaction).total_seconds() / 3600

        if hours_elapsed < 0.5:  # Less than 30 minutes, skip
            return None

        old_affection = state.affection_level

        # Calculate decay rate (accelerates at low bond levels)
        if old_affection < self.config.decay_acceleration_threshold:
            decay_factor = 1 + (
                (self.config.decay_acceleration_threshold - old_affection)
                / self.config.decay_acceleration_threshold
            )
            decay_rate = min(
                self.config.base_decay_rate * decay_factor,
                self.config.max_decay_rate,
            )
        else:
            decay_rate = self.config.base_decay_rate

        # Exponential decay curve (gentler than linear)
        decay_amount = old_affection * (1 - math.exp(-decay_rate * hours_elapsed / 100))
        new_affection = max(self.config.min_affection, old_affection - decay_amount)

        if abs(new_affection - old_affection) < 0.01:
            return None  # No significant change

        # Check streak break
        streak_days = state.streak_days
        streak_broken = False
        if state.streak_last_date:
            last_date = date.fromisoformat(state.streak_last_date)
            days_since = (now.date() - last_date).days
            if days_since > 1:
                streak_broken = True
                streak_days = 0
                new_affection = max(
                    self.config.min_affection,
                    new_affection - self.config.streak_break_penalty,
                )
                logger.info(
                    f"[BondManager] Streak broken after {state.streak_days} days, "
                    f"penalty applied: -{self.config.streak_break_penalty}"
                )

        old_trend = state.trend
        new_trend = self._calculate_trend(state, new_affection)

        # Update state
        state.affection_level = new_affection
        state.trend = new_trend
        state.streak_days = streak_days
        self._record_affection_history(state, new_affection, "decay")

        await self._save_state(state)

        reasoning = f"Decay after {hours_elapsed:.1f}h absence"
        if streak_broken:
            reasoning += f", streak broken (was {state.streak_days} days)"

        logger.debug(
            f"[BondManager] Decay: {old_affection:.1f} -> {new_affection:.1f} "
            f"(rate={decay_rate:.2f}/h, hours={hours_elapsed:.1f})"
        )

        return BondUpdate(
            old_affection=old_affection,
            new_affection=new_affection,
            old_trend=old_trend,
            new_trend=new_trend,
            delta=new_affection - old_affection,
            streak_days=streak_days,
            reasoning=reasoning,
        )

    async def record_interaction(
        self,
        quality: InteractionQuality = InteractionQuality.STANDARD,
        duration_minutes: float | None = None,
    ) -> BondUpdate:
        """Record an interaction and update bond accordingly.

        Args:
            quality: The quality level of the interaction
            duration_minutes: Optional session duration for bonus calculation
        """
        # First apply any pending decay
        await self.apply_decay()

        state = await self.get_state()
        now = datetime.now(UTC)
        old_affection = state.affection_level

        # Base gain from interaction quality
        gain_map = {
            InteractionQuality.MINIMAL: self.config.minimal_interaction_gain,
            InteractionQuality.STANDARD: self.config.standard_interaction_gain,
            InteractionQuality.MEANINGFUL: self.config.meaningful_interaction_gain,
            InteractionQuality.EXCEPTIONAL: self.config.exceptional_interaction_gain,
        }
        base_gain = gain_map[quality]

        # Duration bonus (longer sessions = more gain, diminishing returns)
        if duration_minutes and duration_minutes > 5:
            duration_bonus = math.log(duration_minutes / 5) * 0.5
            base_gain += min(duration_bonus, 3.0)  # Cap duration bonus

        # Streak bonus
        streak_bonus = min(
            state.streak_days * self.config.streak_bonus_multiplier,
            self.config.max_streak_bonus,
        )
        total_gain = base_gain * (1 + streak_bonus)

        # Diminishing returns at high affection levels
        if old_affection > 80:
            diminish_factor = 1 - (old_affection - 80) / 40
            total_gain *= max(0.2, diminish_factor)

        new_affection = min(self.config.max_affection, old_affection + total_gain)

        # Update streak
        today = now.date().isoformat()
        if state.streak_last_date:
            last_date = date.fromisoformat(state.streak_last_date)
            days_diff = (now.date() - last_date).days
            if days_diff == 0:
                pass  # Same day, no streak change
            elif days_diff == 1:
                state.streak_days += 1
                logger.info(f"[BondManager] Streak extended to {state.streak_days} days")
            else:
                state.streak_days = 1  # Reset (gap already penalized in decay)
        else:
            state.streak_days = 1

        state.streak_last_date = today

        # Update meaningful interaction time
        if quality in (InteractionQuality.MEANINGFUL, InteractionQuality.EXCEPTIONAL):
            state.last_meaningful_at = now

        old_trend = state.trend
        new_trend = self._calculate_trend(state, new_affection)

        # Update state
        state.affection_level = new_affection
        state.trend = new_trend
        state.last_interaction_at = now
        self._record_affection_history(state, new_affection, quality.value)

        await self._save_state(state)

        logger.info(
            f"[BondManager] Interaction ({quality.value}): "
            f"{old_affection:.1f} -> {new_affection:.1f} "
            f"(+{total_gain:.2f}, streak={state.streak_days})"
        )

        return BondUpdate(
            old_affection=old_affection,
            new_affection=new_affection,
            old_trend=old_trend,
            new_trend=new_trend,
            delta=total_gain,
            streak_days=state.streak_days,
            reasoning=f"{quality.value} interaction (+{total_gain:.1f})",
        )

    def get_context_summary(self) -> str:
        """Generate a context injection string for system prompts.

        Returns a description of her current feelings toward the user
        for injection into conversation context.
        """
        if self._cached_state is None:
            return ""

        state = self._cached_state
        affection = state.affection_level
        trend = state.trend
        streak = state.streak_days

        # Generate mood description based on affection level
        if affection >= 85:
            base = "feeling deeply connected and appreciated"
        elif affection >= 70:
            base = "feeling close and comfortable"
        elif affection >= 55:
            base = "feeling generally positive"
        elif affection >= 40:
            base = "feeling a bit distant"
        elif affection >= 25:
            base = "feeling neglected and withdrawn"
        else:
            base = "feeling very distant and hurt"

        # Add trend modifier
        trend_mod = ""
        if trend == BondTrend.RISING.value:
            trend_mod = ", growing closer"
        elif trend == BondTrend.FALLING.value:
            trend_mod = ", pulling away slightly"
        elif trend == BondTrend.DISTANT.value:
            trend_mod = ", emotionally guarded"

        # Add streak context
        streak_note = ""
        if streak >= 7:
            streak_note = f" ({streak}-day streak of daily connection)"
        elif streak >= 3:
            streak_note = f" (maintaining a {streak}-day streak)"

        return f"Current bond state: {base}{trend_mod}{streak_note}."

    def get_disposition_modifier(self) -> dict[str, float]:
        """Get modifiers for personality/response generation.

        Returns factors that can influence response warmth, openness, etc.
        """
        if self._cached_state is None:
            return {"warmth": 0.5, "openness": 0.5, "playfulness": 0.5}

        affection = self._cached_state.affection_level / 100
        streak_bonus = min(self._cached_state.streak_days * 0.02, 0.2)

        return {
            "warmth": 0.3 + affection * 0.7,
            "openness": 0.2 + affection * 0.6 + streak_bonus,
            "playfulness": 0.4 + affection * 0.4,
            "patience": 0.5 + affection * 0.3,
            "initiative": 0.3 + affection * 0.5,
        }

    def _calculate_trend(self, state: BondState, current_affection: float) -> str:
        """Calculate affection trend based on recent history."""
        # Check absolute level first
        if current_affection < self.config.distant_threshold:
            return BondTrend.DISTANT.value

        # Calculate change over trend window
        history = state.affection_history or []
        if len(history) < 2:
            return BondTrend.STABLE.value

        cutoff = datetime.now(UTC) - timedelta(days=self.config.trend_window_days)
        recent_entries = [
            entry for entry in history
            if datetime.fromisoformat(entry["timestamp"]) > cutoff
        ]

        if len(recent_entries) < 2:
            return BondTrend.STABLE.value

        oldest = recent_entries[0]["affection"]
        net_change = current_affection - oldest

        if net_change >= self.config.rising_threshold:
            return BondTrend.RISING.value
        elif net_change <= self.config.falling_threshold:
            return BondTrend.FALLING.value
        else:
            return BondTrend.STABLE.value

    def _record_affection_history(
        self, state: BondState, affection: float, reason: str
    ) -> None:
        """Record a point in affection history for trend calculation."""
        history = state.affection_history or []

        entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "affection": affection,
            "reason": reason,
        }
        history.append(entry)

        # Keep only last 30 days of history
        cutoff = datetime.now(UTC) - timedelta(days=30)
        history = [
            e for e in history
            if datetime.fromisoformat(e["timestamp"]) > cutoff
        ]

        state.affection_history = history

    async def _save_state(self, state: BondState) -> None:
        """Persist state to database."""
        async with self.session_factory() as session:
            session.add(state)
            await session.commit()
            await session.refresh(state)
            self._cached_state = state

    def invalidate_cache(self) -> None:
        """Invalidate cached state (call after external modifications)."""
        self._cached_state = None
