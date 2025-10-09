from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from loguru import logger

from dere_shared.emotion.models import (
    EMOTION_CHARACTERISTICS,
    EmotionCharacteristics,
    EmotionInstance,
    OCCEmotionType,
)


@dataclass
class EmotionDecayProfile:
    """Decay characteristics for an emotion type"""

    base_decay_rate: float  # Base decay rate per minute
    half_life: float  # Minutes for intensity to halve
    minimum_persistence: float  # Minimum time before any decay starts (minutes)
    resilience: float  # How much emotion resists decay (0-1)
    context_sensitivity: float  # How much external context affects decay (0-1)


# Decay profiles based on psychological research
EMOTION_DECAY_PROFILES: dict[OCCEmotionType, EmotionDecayProfile] = {
    # Positive emotions - generally decay faster but some are sticky
    OCCEmotionType.JOY: EmotionDecayProfile(0.08, 12, 2, 0.3, 0.6),
    OCCEmotionType.HOPE: EmotionDecayProfile(0.04, 25, 5, 0.6, 0.4),
    OCCEmotionType.SATISFACTION: EmotionDecayProfile(0.06, 18, 3, 0.4, 0.5),
    OCCEmotionType.RELIEF: EmotionDecayProfile(0.12, 8, 1, 0.2, 0.7),
    OCCEmotionType.HAPPY_FOR: EmotionDecayProfile(0.07, 15, 2, 0.3, 0.8),
    OCCEmotionType.PRIDE: EmotionDecayProfile(0.03, 30, 10, 0.7, 0.3),
    OCCEmotionType.ADMIRATION: EmotionDecayProfile(0.05, 20, 3, 0.4, 0.6),
    OCCEmotionType.LOVE: EmotionDecayProfile(0.01, 60, 15, 0.9, 0.2),
    OCCEmotionType.GRATITUDE: EmotionDecayProfile(0.04, 25, 5, 0.6, 0.5),
    OCCEmotionType.GRATIFICATION: EmotionDecayProfile(0.06, 18, 4, 0.4, 0.4),
    OCCEmotionType.INTEREST: EmotionDecayProfile(0.09, 10, 1, 0.3, 0.8),
    # Negative emotions - tend to be stickier
    OCCEmotionType.DISTRESS: EmotionDecayProfile(0.03, 30, 8, 0.7, 0.5),
    OCCEmotionType.FEAR: EmotionDecayProfile(0.02, 40, 10, 0.8, 0.3),
    OCCEmotionType.DISAPPOINTMENT: EmotionDecayProfile(0.05, 22, 5, 0.5, 0.6),
    OCCEmotionType.FEARS_CONFIRMED: EmotionDecayProfile(0.02, 45, 12, 0.8, 0.3),
    OCCEmotionType.PITY: EmotionDecayProfile(0.06, 18, 3, 0.4, 0.7),
    OCCEmotionType.GLOATING: EmotionDecayProfile(0.1, 7, 1, 0.2, 0.8),
    OCCEmotionType.RESENTMENT: EmotionDecayProfile(0.02, 50, 15, 0.8, 0.4),
    OCCEmotionType.SHAME: EmotionDecayProfile(0.02, 45, 12, 0.8, 0.3),
    OCCEmotionType.REPROACH: EmotionDecayProfile(0.04, 25, 6, 0.6, 0.5),
    OCCEmotionType.HATE: EmotionDecayProfile(0.01, 80, 20, 0.9, 0.2),
    OCCEmotionType.ANGER: EmotionDecayProfile(0.06, 18, 4, 0.5, 0.6),
    OCCEmotionType.REMORSE: EmotionDecayProfile(0.03, 35, 10, 0.7, 0.4),
    OCCEmotionType.DISGUST: EmotionDecayProfile(0.05, 20, 4, 0.5, 0.6),
    # Neutral
    OCCEmotionType.NEUTRAL: EmotionDecayProfile(0.15, 5, 0, 0.1, 0.9),
}


@dataclass
class DecayContext:
    """Context factors affecting decay rates"""

    is_user_present: bool
    is_user_engaged: bool
    recent_emotional_activity: float  # 0-1
    environmental_stress: float  # 0-1
    social_support: float  # 0-1
    time_of_day: Literal["morning", "afternoon", "evening", "night"]
    personality_stability: float  # 0-1


DEFAULT_DECAY_CONTEXT = DecayContext(
    is_user_present=False,
    is_user_engaged=False,
    recent_emotional_activity=0.5,
    environmental_stress=0.3,
    social_support=0.5,
    time_of_day="afternoon",
    personality_stability=0.6,
)


@dataclass
class DecayResult:
    """Result of decay calculation"""

    new_intensity: float
    decay_amount: float
    reasoning: str
    should_remove: bool


class SmartDecay:
    """Smart decay system with context-aware emotion persistence"""

    def __init__(
        self,
        emotion_decay_profiles: dict[OCCEmotionType, EmotionDecayProfile] = EMOTION_DECAY_PROFILES,
    ):
        self.emotion_decay_profiles = emotion_decay_profiles

    def calculate_decay(
        self,
        emotion: EmotionInstance,
        time_delta_minutes: float,
        context: DecayContext = DEFAULT_DECAY_CONTEXT,
    ) -> DecayResult:
        """Calculate decay for a single emotion"""
        if emotion.type == "neutral":
            return DecayResult(
                new_intensity=0,
                decay_amount=emotion.intensity,
                reasoning="Neutral emotion removed",
                should_remove=True,
            )

        profile = self.emotion_decay_profiles[emotion.type]  # type: ignore
        characteristics = EMOTION_CHARACTERISTICS[emotion.type]  # type: ignore

        emotion_age = time_delta_minutes

        # Check minimum persistence
        if emotion_age < profile.minimum_persistence:
            return DecayResult(
                new_intensity=emotion.intensity,
                decay_amount=0,
                reasoning=f"Too recent ({emotion_age:.1f}m < {profile.minimum_persistence}m minimum)",
                should_remove=False,
            )

        # Calculate adjusted decay rate
        adjusted_decay_rate = self._calculate_adjusted_decay_rate(profile, characteristics, context)

        # Exponential decay
        base_decay_factor = math.exp(-adjusted_decay_rate * time_delta_minutes)
        new_intensity = emotion.intensity * base_decay_factor

        # Apply resilience
        resilience_protection = (emotion.intensity / 100) ** 0.5 * profile.resilience
        new_intensity = emotion.intensity - (emotion.intensity - new_intensity) * (
            1 - resilience_protection
        )

        # Apply contextual modifiers
        new_intensity = self._apply_contextual_modifiers(
            new_intensity, emotion.intensity, characteristics, context
        )

        new_intensity = max(0, min(100, new_intensity))
        decay_amount = emotion.intensity - new_intensity

        # Calculate removal threshold
        removal_threshold = self._calculate_removal_threshold(characteristics, context)
        should_remove = new_intensity < removal_threshold

        reasoning = self._generate_decay_reasoning(
            emotion.type,  # type: ignore
            emotion.intensity,
            new_intensity,
            adjusted_decay_rate,
            resilience_protection,
            context,
            emotion_age,
        )

        logger.debug(
            f"[SmartDecay] {emotion.type} decay: "
            f"{emotion.intensity:.1f} → {new_intensity:.1f}, "
            f"age={emotion_age:.1f}m, remove={should_remove}"
        )

        return DecayResult(
            new_intensity=0 if should_remove else new_intensity,
            decay_amount=decay_amount,
            reasoning=reasoning,
            should_remove=should_remove,
        )

    def apply_decay_to_emotions(
        self,
        emotions: dict[OCCEmotionType | str, EmotionInstance],
        time_delta_minutes: float,
        context: DecayContext = DEFAULT_DECAY_CONTEXT,
    ) -> dict:
        """Apply decay to multiple emotions"""
        updated_emotions: dict[OCCEmotionType | str, EmotionInstance] = {}
        decay_results: list[dict] = []
        total_decay_activity = 0.0

        for emotion_type, emotion in emotions.items():
            decay_result = self.calculate_decay(emotion, time_delta_minutes, context)
            decay_results.append({"type": emotion_type, "result": decay_result})

            total_decay_activity += decay_result.decay_amount

            if not decay_result.should_remove and decay_result.new_intensity > 0:
                import time

                updated_emotions[emotion_type] = EmotionInstance(
                    type=emotion.type,
                    intensity=decay_result.new_intensity,
                    last_updated=int(time.time() * 1000),
                )

        return {
            "updated_emotions": updated_emotions,
            "decay_results": decay_results,
            "total_decay_activity": total_decay_activity,
        }

    def _calculate_adjusted_decay_rate(
        self,
        profile: EmotionDecayProfile,
        characteristics: EmotionCharacteristics,
        context: DecayContext,
    ) -> float:
        """Calculate context-adjusted decay rate"""
        adjusted_rate = profile.base_decay_rate

        # User presence affects decay
        if not context.is_user_present:
            if characteristics.social_relevance == "high":
                adjusted_rate *= 1.3
            elif characteristics.social_relevance == "medium":
                adjusted_rate *= 1.1

        if context.is_user_engaged:
            adjusted_rate *= 0.8

        # Emotional activity affects decay
        if context.recent_emotional_activity > 0.7:
            adjusted_rate *= 0.7
        elif context.recent_emotional_activity < 0.3:
            adjusted_rate *= 1.2

        # Environmental stress
        if context.environmental_stress > 0.6:
            if characteristics.valence == "positive":
                adjusted_rate *= 1.4
            else:
                adjusted_rate *= 0.8

        # Social support
        if context.social_support > 0.6:
            if characteristics.valence == "positive":
                adjusted_rate *= 0.9
            elif characteristics.valence == "negative":
                adjusted_rate *= 1.2

        # Time of day
        match context.time_of_day:
            case "morning":
                adjusted_rate *= 1.1
            case "evening":
                adjusted_rate *= 0.9
            case "night":
                if characteristics.valence == "negative":
                    adjusted_rate *= 0.7

        # Personality stability
        stability_factor = 0.5 + context.personality_stability * 0.5
        adjusted_rate *= stability_factor

        return max(0.001, adjusted_rate)

    def _apply_contextual_modifiers(
        self,
        new_intensity: float,
        original_intensity: float,
        characteristics: EmotionCharacteristics,
        context: DecayContext,
    ) -> float:
        """Apply contextual modifications to decay"""
        modified_intensity = new_intensity

        # High arousal rebound
        if characteristics.arousal == "high" and context.recent_emotional_activity > 0.8:
            rebound_factor = 1.05
            modified_intensity = new_intensity + (original_intensity - new_intensity) * (
                rebound_factor - 1
            )

        # Sticky emotions resist decay more
        if characteristics.persistence == "sticky":
            if characteristics.valence == "positive" and context.social_support > 0.7:
                modified_intensity = new_intensity + (original_intensity - new_intensity) * 0.1
            elif characteristics.valence == "negative" and context.environmental_stress > 0.6:
                modified_intensity = new_intensity + (original_intensity - new_intensity) * 0.15

        return max(0, min(100, modified_intensity))

    def _calculate_removal_threshold(
        self, characteristics: EmotionCharacteristics, context: DecayContext
    ) -> float:
        """Calculate threshold for emotion removal"""
        threshold = 1.0

        if characteristics.persistence == "sticky":
            threshold = 0.5
        elif characteristics.persistence == "fleeting":
            threshold = 2.0

        threshold *= 0.5 + context.personality_stability * 0.5

        return threshold

    def _generate_decay_reasoning(
        self,
        emotion_type: OCCEmotionType,
        original_intensity: float,
        new_intensity: float,
        decay_rate: float,
        resilience_protection: float,
        context: DecayContext,
        age_minutes: float,
    ) -> str:
        """Generate human-readable decay reasoning"""
        parts: list[str] = []

        parts.append(f"{emotion_type}: {original_intensity:.1f} → {new_intensity:.1f}")
        parts.append(f"age: {age_minutes:.1f}m")
        parts.append(f"rate: {decay_rate:.3f}")

        if resilience_protection > 0.1:
            parts.append(f"resilience: {resilience_protection * 100:.0f}%")

        if not context.is_user_present:
            parts.append("user away")

        if context.recent_emotional_activity > 0.7:
            parts.append("high activity")
        elif context.recent_emotional_activity < 0.3:
            parts.append("low activity")

        return ", ".join(parts)
