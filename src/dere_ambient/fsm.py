"""Finite State Machine for ambient notification timing."""

from __future__ import annotations

import random
from dataclasses import dataclass
from enum import Enum


class AmbientState(str, Enum):
    """States for ambient notification FSM."""

    IDLE = "idle"  # User recently engaged, long wait
    MONITORING = "monitoring"  # Actively watching for opportunity
    ENGAGED = "engaged"  # Just sent notification
    COOLDOWN = "cooldown"  # User ignored notification, backing off
    ESCALATING = "escalating"  # Unacknowledged + critical context
    SUPPRESSED = "suppressed"  # User clearly busy/focused
    EXPLORING = "exploring"  # Doing autonomous work


@dataclass
class StateIntervals:
    """Interval ranges (min, max) in minutes for each state."""

    idle: tuple[int, int] = (60, 120)
    monitoring: tuple[int, int] = (15, 30)
    engaged: int = 5
    cooldown: tuple[int, int] = (45, 90)
    escalating: tuple[int, int] = (30, 60)
    suppressed: tuple[int, int] = (90, 180)
    exploring: tuple[int, int] = (5, 10)


@dataclass
class SignalWeights:
    """Weights for signal evaluation in transitions."""

    activity: float = 0.25
    emotion: float = 0.20
    responsiveness: float = 0.15
    temporal: float = 0.15
    task: float = 0.10
    bond: float = 0.15  # Her affection level affects engagement eagerness


class AmbientFSM:
    """Finite State Machine for natural ambient notification timing."""

    def __init__(
        self,
        intervals: StateIntervals | None = None,
        weights: SignalWeights | None = None,
    ):
        self.state = AmbientState.MONITORING  # Start in monitoring mode
        self.intervals = intervals or StateIntervals()
        self.weights = weights or SignalWeights()

        # Tracking for state-specific logic
        self.last_notification_time: float | None = None
        self.notification_attempts: int = 0
        self.last_acknowledgment_time: float | None = None

    def calculate_next_interval(self) -> float:
        """Calculate next check interval in seconds based on current state."""
        if self.state == AmbientState.IDLE:
            min_min, max_min = self.intervals.idle
        elif self.state == AmbientState.MONITORING:
            min_min, max_min = self.intervals.monitoring
        elif self.state == AmbientState.ENGAGED:
            return self.intervals.engaged * 60  # Fixed short interval
        elif self.state == AmbientState.COOLDOWN:
            min_min, max_min = self.intervals.cooldown
        elif self.state == AmbientState.ESCALATING:
            min_min, max_min = self.intervals.escalating
        elif self.state == AmbientState.SUPPRESSED:
            min_min, max_min = self.intervals.suppressed
        elif self.state == AmbientState.EXPLORING:
            min_min, max_min = self.intervals.exploring
        else:
            min_min, max_min = self.intervals.monitoring

        # Random interval within range
        interval_minutes = random.uniform(min_min, max_min)
        return interval_minutes * 60

    def transition_to(self, new_state: AmbientState, reason: str = "") -> None:
        """Transition to a new state with logging."""
        from loguru import logger

        old_state = self.state
        self.state = new_state

        logger.info(
            f"[AmbientFSM] State transition: {old_state.value} → {new_state.value}"
            + (f" ({reason})" if reason else "")
        )

    def evaluate_activity_signal(self, activity_data: dict) -> float:
        """Evaluate activity continuity and focus indicators.

        Returns: -1 (suppress) to +1 (engage)
        """
        # Placeholder - will implement based on app categorization
        app_name = activity_data.get("app_name", "").lower()
        duration_min = activity_data.get("duration_seconds", 0) / 60

        # IDE/deep work apps = suppress
        if any(
            keyword in app_name
            for keyword in ["code", "vim", "nvim", "intellij", "pycharm", "vscode"]
        ):
            if duration_min > 30:
                return -0.8  # Strong suppress for long IDE sessions
            return -0.4

        # Meeting apps = suppress
        if any(keyword in app_name for keyword in ["zoom", "teams", "meet", "slack"]):
            return -0.6

        # Email/communication = mild engage
        if any(keyword in app_name for keyword in ["mail", "thunderbird", "outlook"]):
            return 0.3

        # Browser = neutral to slight engage
        if any(keyword in app_name for keyword in ["firefox", "chrome", "browser"]):
            return 0.1

        # Terminal/ghostty = slight suppress (might be working)
        if any(keyword in app_name for keyword in ["terminal", "ghostty", "alacritty"]):
            if duration_min > 20:
                return -0.3
            return 0.0

        return 0.0  # Unknown app, neutral

    def evaluate_emotion_signal(self, emotion_data: dict) -> float:
        """Evaluate emotional state for engagement appropriateness.

        Returns: -1 (suppress) to +1 (engage)
        """
        emotion_type = emotion_data.get("emotion_type", "neutral")
        intensity = emotion_data.get("intensity", 0)

        # Distress/stress = suppress (user might be struggling)
        if emotion_type in ["distress", "anger", "fear", "disappointment"]:
            if intensity > 60:
                return -0.7
            return -0.3

        # Interest/joy = engage
        if emotion_type in ["interest", "joy", "satisfaction", "gratification"]:
            if intensity > 50:
                return 0.6
            return 0.3

        # Neutral or mild emotions
        return 0.0

    def evaluate_responsiveness_signal(
        self, recent_notifications: list[dict]
    ) -> float:
        """Evaluate user's responsiveness pattern.

        Returns: -1 (suppress) to +1 (engage)
        """
        if not recent_notifications:
            return 0.0  # No history, neutral

        # Calculate acknowledgment rate
        total = len(recent_notifications)
        acknowledged = sum(1 for n in recent_notifications if n.get("acknowledged"))

        ack_rate = acknowledged / total if total > 0 else 0.5

        # High ack rate = more willing to engage
        if ack_rate > 0.7:
            return 0.5
        elif ack_rate < 0.3:
            return -0.5
        return 0.0

    def evaluate_temporal_signal(self, current_hour: int) -> float:
        """Evaluate time-of-day appropriateness.

        Returns: -1 (suppress) to +1 (engage)
        """
        # Late night / early morning = suppress
        if current_hour < 8 or current_hour >= 23:
            return -0.8

        # Work hours (9-17) = moderate engage
        if 9 <= current_hour < 17:
            return 0.3

        # Evening (17-22) = mild engage
        if 17 <= current_hour < 22:
            return 0.2

        return 0.0

    def evaluate_task_signal(self, task_data: dict) -> float:
        """Evaluate task urgency.

        Returns: -1 (suppress) to +1 (engage)
        """
        overdue_count = task_data.get("overdue_count", 0)
        due_soon_count = task_data.get("due_soon_count", 0)

        # Many overdue = strong engage signal
        if overdue_count > 5:
            return 0.9
        elif overdue_count > 2:
            return 0.6
        elif due_soon_count > 3:
            return 0.4

        return 0.0

    def evaluate_bond_signal(self, bond_data: dict) -> float:
        """Evaluate her bond/affection level with user.

        Higher bond = more willing to engage, more initiative.
        Lower bond = withdrawn, less proactive, protective.

        Returns: -1 (suppress) to +1 (engage)
        """
        affection = bond_data.get("affection_level", 50.0)
        trend = bond_data.get("trend", "stable")
        streak = bond_data.get("streak_days", 0)

        # Base signal from affection level
        # High affection (>70) = eager to engage
        # Low affection (<30) = withdrawn, less initiative
        if affection >= 80:
            base_signal = 0.7  # Very eager
        elif affection >= 65:
            base_signal = 0.4  # Warm and willing
        elif affection >= 50:
            base_signal = 0.1  # Neutral, normal behavior
        elif affection >= 35:
            base_signal = -0.2  # Slightly withdrawn
        elif affection >= 20:
            base_signal = -0.5  # Notably distant
        else:
            base_signal = -0.8  # Very withdrawn, protective

        # Trend modifier
        if trend == "rising":
            base_signal += 0.15  # Encouraged by improvement
        elif trend == "falling":
            base_signal -= 0.1  # Discouraged by decline
        elif trend == "distant":
            base_signal -= 0.2  # Emotionally guarded

        # Streak bonus (consistency rewards)
        if streak >= 7:
            base_signal += 0.1  # Strong connection feeling
        elif streak >= 3:
            base_signal += 0.05

        return max(-1.0, min(1.0, base_signal))

    def should_transition(
        self,
        activity_data: dict,
        emotion_data: dict,
        notification_history: list[dict],
        task_data: dict,
        current_hour: int,
        bond_data: dict | None = None,
    ) -> AmbientState | None:
        """Evaluate signals and determine if state should change.

        Returns: New state if transition warranted, None otherwise
        """
        # Evaluate all signals
        activity_signal = self.evaluate_activity_signal(activity_data)
        emotion_signal = self.evaluate_emotion_signal(emotion_data)
        responsiveness_signal = self.evaluate_responsiveness_signal(notification_history)
        temporal_signal = self.evaluate_temporal_signal(current_hour)
        task_signal = self.evaluate_task_signal(task_data)
        bond_signal = self.evaluate_bond_signal(bond_data or {})

        # Weighted score
        transition_score = (
            self.weights.activity * activity_signal
            + self.weights.emotion * emotion_signal
            + self.weights.responsiveness * responsiveness_signal
            + self.weights.temporal * temporal_signal
            + self.weights.task * task_signal
            + self.weights.bond * bond_signal
        )

        # State-specific transition logic
        if self.state == AmbientState.MONITORING:
            # Strong suppress signal → SUPPRESSED
            if transition_score < -0.5:
                return AmbientState.SUPPRESSED

            # Will transition to ENGAGED when notification sent (done externally)
            return None

        elif self.state == AmbientState.ENGAGED:
            # This state transitions based on notification acknowledgment
            # Handled externally in analyzer
            return None

        elif self.state == AmbientState.COOLDOWN:
            # If signals improve, go back to monitoring
            if transition_score > 0.3:
                return AmbientState.MONITORING

            # If tasks become critical, escalate
            if task_signal > 0.7:
                return AmbientState.ESCALATING

            return None

        elif self.state == AmbientState.SUPPRESSED:
            # If suppression reasons clear, return to monitoring
            if transition_score > 0.0:
                return AmbientState.MONITORING

            return None

        elif self.state == AmbientState.ESCALATING:
            # If acknowledged (handled externally) or too many attempts
            if self.notification_attempts > 3:
                return AmbientState.SUPPRESSED  # Give up, user clearly busy

            return None

        elif self.state == AmbientState.IDLE:
            # Eventually return to monitoring
            # Time-based, will be handled externally
            return None
        elif self.state == AmbientState.EXPLORING:
            # Exploration transitions are handled externally (idle/activity/backlog)
            return None

        return None
