from __future__ import annotations

from dataclasses import dataclass

from loguru import logger

from dere_shared.emotion.models import (
    EMOTION_CHARACTERISTICS,
    EmotionCharacteristics,
    EmotionInstance,
    OCCEmotionType,
)

# Emotional physics constants based on psychological research
EMOTION_PHYSICS_CONSTANTS = {
    "MOMENTUM_FACTOR": 0.8,  # How much current intensity resists change
    "POSITIVE_NEGATIVE_INTERFERENCE": 0.7,  # How much pos/neg emotions reduce each other
    "PERSONALITY_DRIFT_RATE": 0.02,  # Per time unit
    "REPETITION_DECAY_FACTOR": 0.3,  # Per similar recent stimulus
    "MOOD_BIAS_FACTOR": 0.4,  # How much current mood biases interpretation
    "BUFFERING_THRESHOLD": 60,  # Intensity above which emotions become sticky
    "BUFFERING_STRENGTH": 0.5,  # How much buffering protects high-intensity emotions
}


@dataclass
class EmotionPhysicsContext:
    """Context for emotion physics calculations"""

    current_emotions: dict[OCCEmotionType | str, EmotionInstance]
    recent_stimuli_history: list[dict]
    time_since_last_major_change: int  # milliseconds
    social_context: dict | None = None


@dataclass
class EmotionPhysicsResult:
    """Result of physics calculation"""

    final_intensity: float
    momentum_resistance: float
    valence_damping: float
    personality_pull: float
    diminishing_factor: float
    contextual_bias: float
    reasoning: str


class EmotionPhysics:
    """Core emotion physics engine applying realistic psychological dynamics"""

    def calculate_intensity_change(
        self,
        emotion_type: OCCEmotionType,
        raw_intensity_delta: float,
        context: EmotionPhysicsContext,
    ) -> EmotionPhysicsResult:
        """Calculate realistic intensity change for an emotion"""
        characteristics = EMOTION_CHARACTERISTICS[emotion_type]
        current_emotion = context.current_emotions.get(emotion_type)
        current_intensity = current_emotion.intensity if current_emotion else 0.0

        calculation = {
            "momentum_resistance": 0.0,
            "valence_damping": 0.0,
            "personality_pull": 0.0,
            "diminishing_factor": 1.0,
            "contextual_bias": 0.0,
            "reasoning": "",
        }

        # 1. EMOTIONAL MOMENTUM
        momentum_factor = self._calculate_momentum(current_intensity, characteristics)
        calculation["momentum_resistance"] = momentum_factor

        # 2. VALENCE COMPETITION
        valence_damping = self._calculate_valence_competition(
            emotion_type, characteristics, context.current_emotions
        )
        calculation["valence_damping"] = valence_damping

        # 3. DIMINISHING RETURNS
        diminishing_factor = self._calculate_diminishing_returns(
            characteristics, context.recent_stimuli_history
        )
        calculation["diminishing_factor"] = diminishing_factor

        # 4. CONTEXTUAL BIAS
        contextual_bias = self._calculate_contextual_bias(
            raw_intensity_delta, context.current_emotions, characteristics
        )
        calculation["contextual_bias"] = contextual_bias

        # Apply all physics factors
        adjusted_delta = raw_intensity_delta
        adjusted_delta *= 1 - momentum_factor
        adjusted_delta *= 1 - valence_damping
        adjusted_delta *= diminishing_factor
        adjusted_delta += contextual_bias

        # Calculate final intensity
        final_intensity = max(0.0, min(100.0, current_intensity + adjusted_delta))

        # Generate reasoning
        calculation["reasoning"] = self._generate_reasoning_explanation(
            emotion_type,
            raw_intensity_delta,
            adjusted_delta,
            current_intensity,
            final_intensity,
            calculation,
        )

        logger.debug(
            f"[EmotionPhysics] {emotion_type} physics calculation: "
            f"raw={raw_intensity_delta:.1f}, adjusted={adjusted_delta:.1f}, "
            f"current={current_intensity:.1f}, final={final_intensity:.1f}"
        )

        return EmotionPhysicsResult(
            final_intensity=final_intensity,
            momentum_resistance=calculation["momentum_resistance"],
            valence_damping=calculation["valence_damping"],
            personality_pull=0.0,
            diminishing_factor=calculation["diminishing_factor"],
            contextual_bias=calculation["contextual_bias"],
            reasoning=calculation["reasoning"],
        )

    def _calculate_momentum(
        self, current_intensity: float, characteristics: EmotionCharacteristics
    ) -> float:
        """Calculate emotional momentum resistance"""
        base_momentum = (current_intensity / 100) ** 2 * EMOTION_PHYSICS_CONSTANTS[
            "MOMENTUM_FACTOR"
        ]

        persistence_multiplier = (
            1.3
            if characteristics.persistence == "sticky"
            else 0.7
            if characteristics.persistence == "fleeting"
            else 1.0
        )

        return base_momentum * persistence_multiplier

    def _calculate_valence_competition(
        self,
        emotion_type: OCCEmotionType,
        characteristics: EmotionCharacteristics,
        current_emotions: dict[OCCEmotionType | str, EmotionInstance],
    ) -> float:
        """Calculate competition from opposite valence emotions"""
        if characteristics.valence == "neutral":
            return 0.0

        opposite_valence_strength = 0.0

        for emotion_key, emotion in current_emotions.items():
            if emotion_key == "neutral" or emotion_key == emotion_type:
                continue

            other_char = EMOTION_CHARACTERISTICS.get(emotion_key)  # type: ignore
            if not other_char:
                continue

            is_opposite = (
                characteristics.valence == "positive" and other_char.valence == "negative"
            ) or (characteristics.valence == "negative" and other_char.valence == "positive")

            if is_opposite:
                opposite_valence_strength += emotion.intensity

        return min(
            EMOTION_PHYSICS_CONSTANTS["POSITIVE_NEGATIVE_INTERFERENCE"],
            (opposite_valence_strength / 200)
            * EMOTION_PHYSICS_CONSTANTS["POSITIVE_NEGATIVE_INTERFERENCE"],
        )

    def _calculate_diminishing_returns(
        self, characteristics: EmotionCharacteristics, recent_stimuli_history: list[dict]
    ) -> float:
        """Calculate diminishing returns from repeated stimuli"""
        import time

        now = int(time.time() * 1000)
        recent_window = 10 * 60 * 1000  # 10 minutes

        similar_stimuli_count = 0
        for stimulus in recent_stimuli_history:
            if now - stimulus.get("timestamp", 0) < recent_window:
                is_positive_stimulus = stimulus.get("valence", 0) > 0
                is_positive_emotion = characteristics.valence == "positive"

                if is_positive_stimulus == is_positive_emotion:
                    similar_stimuli_count += 1

        return max(
            0.1, 1 - similar_stimuli_count * EMOTION_PHYSICS_CONSTANTS["REPETITION_DECAY_FACTOR"]
        )

    def _calculate_contextual_bias(
        self,
        raw_intensity_delta: float,
        current_emotions: dict[OCCEmotionType | str, EmotionInstance],
        characteristics: EmotionCharacteristics,
    ) -> float:
        """Calculate bias from current mood"""
        dominant_emotion: tuple[OCCEmotionType, float] | None = None

        for emotion_key, emotion in current_emotions.items():
            if emotion_key != "neutral" and (
                not dominant_emotion or emotion.intensity > dominant_emotion[1]
            ):
                dominant_emotion = (emotion_key, emotion.intensity)  # type: ignore

        if not dominant_emotion or dominant_emotion[1] < 30:
            return 0.0

        dominant_char = EMOTION_CHARACTERISTICS.get(dominant_emotion[0])
        if not dominant_char:
            return 0.0

        bias = 0.0

        # Negative emotions make you interpret things more negatively
        if dominant_char.valence == "negative":
            if characteristics.valence == "negative":
                bias = dominant_emotion[1] * 0.01 * EMOTION_PHYSICS_CONSTANTS["MOOD_BIAS_FACTOR"]
            elif characteristics.valence == "positive":
                bias = -dominant_emotion[1] * 0.005 * EMOTION_PHYSICS_CONSTANTS["MOOD_BIAS_FACTOR"]

        # Positive emotions make you interpret things more positively
        elif dominant_char.valence == "positive":
            if characteristics.valence == "positive":
                bias = dominant_emotion[1] * 0.005 * EMOTION_PHYSICS_CONSTANTS["MOOD_BIAS_FACTOR"]
            elif characteristics.valence == "negative":
                bias = -dominant_emotion[1] * 0.01 * EMOTION_PHYSICS_CONSTANTS["MOOD_BIAS_FACTOR"]

        return bias

    def _generate_reasoning_explanation(
        self,
        emotion_type: OCCEmotionType,
        raw_delta: float,
        adjusted_delta: float,
        current_intensity: float,
        final_intensity: float,
        factors: dict,
    ) -> str:
        """Generate human-readable explanation"""
        parts: list[str] = []

        parts.append(f"{emotion_type} change: {raw_delta:.1f} → {adjusted_delta:.1f}")

        if factors["momentum_resistance"] > 0.1:
            parts.append(f"momentum resistance: {factors['momentum_resistance'] * 100:.0f}%")

        if factors["valence_damping"] > 0.1:
            parts.append(f"valence competition: {factors['valence_damping'] * 100:.0f}%")

        if abs(factors["personality_pull"]) > 1:
            sign = "+" if factors["personality_pull"] > 0 else ""
            parts.append(f"personality drift: {sign}{factors['personality_pull']:.1f}")

        if factors["diminishing_factor"] < 0.9:
            parts.append(f"diminishing returns: {factors['diminishing_factor'] * 100:.0f}%")

        if abs(factors["contextual_bias"]) > 1:
            sign = "+" if factors["contextual_bias"] > 0 else ""
            parts.append(f"mood bias: {sign}{factors['contextual_bias']:.1f}")

        parts.append(f"final: {current_intensity:.1f} → {final_intensity:.1f}")

        return ", ".join(parts)
