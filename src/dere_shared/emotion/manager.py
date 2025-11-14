from __future__ import annotations

import time
from typing import TYPE_CHECKING

from loguru import logger

from dere_shared.emotion.appraisal import AppraisalEngine
from dere_shared.emotion.decay import DecayContext, SmartDecay
from dere_shared.emotion.history import StimulusBuffer, StimulusRecord
from dere_shared.emotion.models import (
    EMOTION_CHARACTERISTICS,
    CurrentMoodState,
    EmotionInstance,
    OCCAppraisal,
    OCCAttitude,
    OCCEmotion,
    OCCEmotionState,
    OCCEmotionType,
    OCCGoal,
    OCCStandard,
)
from dere_shared.emotion.physics import EmotionPhysics, EmotionPhysicsContext

if TYPE_CHECKING:
    from dere_graph.llm_client import ClaudeClient


class OCCEmotionManager:
    """
    Main orchestrator for OCC emotion system
    Integrates appraisal, physics, decay, and persistence
    """

    def __init__(
        self,
        goals: list[OCCGoal],
        standards: list[OCCStandard],
        attitudes: list[OCCAttitude],
        session_id: int,
        db,  # Database instance
        llm_client: ClaudeClient | None = None,
    ):
        self.session_id = session_id
        self.db = db

        # Initialize components
        self.appraisal_engine = AppraisalEngine(goals, standards, attitudes, llm_client)
        self.emotion_physics = EmotionPhysics()
        self.smart_decay = SmartDecay()
        self.stimulus_buffer = StimulusBuffer()

        # Internal state
        self.active_emotions: dict[OCCEmotionType | str, EmotionInstance] = {}
        self.last_decay_time: int = int(time.time() * 1000)
        self.last_major_emotional_change: int = int(time.time() * 1000)

    async def initialize(self) -> None:
        """Load emotion state from database"""
        logger.info(f"[OCCEmotionManager] Initializing for session {self.session_id}")

        try:
            state = await self.db.load_emotion_state(self.session_id)
            if state:
                self.active_emotions = state["active_emotions"]
                self.last_decay_time = state["last_decay_time"]
                logger.info(
                    f"[OCCEmotionManager] Loaded {len(self.active_emotions)} active emotions from DB"
                )
            else:
                logger.info("[OCCEmotionManager] No existing state, starting fresh")
        except Exception as e:
            logger.error(f"[OCCEmotionManager] Error loading state: {e}")
            self.active_emotions = {}
            self.last_decay_time = int(time.time() * 1000)

    async def process_stimulus(
        self, stimulus: dict | str, context: dict | None = None, persona_name: str = "AI"
    ) -> dict[OCCEmotionType | str, EmotionInstance]:
        """
        Process a stimulus through the complete pipeline:
        decay → appraise → physics → persist
        """
        start_time = int(time.time() * 1000)

        logger.debug(
            f"[OCCEmotionManager] Processing stimulus, "
            f"current emotions: {len(self.active_emotions)}"
        )

        # 1. APPLY DECAY FIRST
        await self._apply_smart_decay(start_time)

        # 2. RUN APPRAISAL
        current_emotion_state = self._build_current_emotion_state(stimulus)
        appraisal_output = await self.appraisal_engine.appraise_stimulus(
            stimulus, current_emotion_state, context or {}, persona_name
        )

        if not appraisal_output or not appraisal_output.resulting_emotions:
            logger.debug("[OCCEmotionManager] No emotions from appraisal")
            return self.active_emotions

        # 3. APPLY PHYSICS TO RESULTING EMOTIONS
        physics_results = []
        for emotion in appraisal_output.resulting_emotions:
            if emotion.type == "neutral" or emotion.type not in OCCEmotionType.__members__.values():
                continue

            emotion_type = OCCEmotionType(emotion.type)
            raw_intensity = emotion.intensity

            # Build physics context
            physics_context = self._build_physics_context(context or {})

            # Calculate physics-adjusted intensity
            physics_result = self.emotion_physics.calculate_intensity_change(
                emotion_type, raw_intensity, physics_context
            )

            # Update active emotions if intensity is significant
            if physics_result.final_intensity > 1.0:
                self.active_emotions[emotion_type] = EmotionInstance(
                    type=emotion_type,
                    intensity=physics_result.final_intensity,
                    last_updated=start_time,
                )
                physics_results.append((emotion_type, physics_result))
                logger.debug(
                    f"[OCCEmotionManager] {emotion_type}: "
                    f"{raw_intensity:.1f} → {physics_result.final_intensity:.1f}"
                )
            elif emotion_type in self.active_emotions:
                # Remove if physics brought it below threshold
                del self.active_emotions[emotion_type]
                logger.debug(f"[OCCEmotionManager] Removed {emotion_type} (below threshold)")

        # 4. RECORD STIMULUS IN HISTORY
        await self._record_stimulus_in_history(stimulus, appraisal_output, context or {})

        # 5. PERSIST STATE IF CHANGED
        if physics_results:
            await self._persist_state()
            self.last_major_emotional_change = start_time
            logger.info(
                f"[OCCEmotionManager] Emotional state updated: "
                f"{len(physics_results)} emotions changed, "
                f"{len(self.active_emotions)} total active"
            )

        return self.active_emotions

    async def _apply_smart_decay(self, current_time: int) -> None:
        """Apply context-aware decay to active emotions"""
        time_delta_ms = current_time - self.last_decay_time
        time_delta_minutes = time_delta_ms / (1000 * 60)

        if time_delta_minutes < 0.1:  # Less than 6 seconds
            return

        # Build decay context (simplified for now, can be enhanced)
        decay_context = DecayContext(
            is_user_present=False,  # TODO: Get from presence service
            is_user_engaged=False,
            recent_emotional_activity=self._calculate_recent_emotional_activity(),
            environmental_stress=0.3,
            social_support=0.5,
            time_of_day=self._get_time_of_day(),
            personality_stability=0.6,
        )

        # Apply decay
        decay_result = self.smart_decay.apply_decay_to_emotions(
            self.active_emotions, time_delta_minutes, decay_context
        )

        self.active_emotions = decay_result["updated_emotions"]
        self.last_decay_time = current_time

        if decay_result["total_decay_activity"] > 0:
            logger.info(
                f"[OCCEmotionManager] Decay applied: "
                f"{decay_result['total_decay_activity']:.1f} total activity, "
                f"{len(self.active_emotions)} emotions remaining"
            )
            await self._persist_state()

    def _build_physics_context(self, context: dict) -> EmotionPhysicsContext:
        """Build context for physics calculations"""
        recent_stimuli = self.stimulus_buffer.get_recent_stimuli(10 * 60 * 1000)  # Last 10 minutes

        return EmotionPhysicsContext(
            current_emotions=self.active_emotions,
            recent_stimuli_history=[
                {
                    "type": s.type,
                    "valence": s.valence,
                    "timestamp": s.timestamp,
                }
                for s in recent_stimuli
            ],
            time_since_last_major_change=int(time.time() * 1000) - self.last_major_emotional_change,
            social_context=context.get("social_context"),
        )

    def _build_current_emotion_state(self, stimulus: dict | str) -> OCCEmotionState:
        """Build current emotion state for appraisal engine"""
        dominant = self.get_current_dominant_emotion()

        if dominant:
            primary = OCCEmotion(
                type=dominant.type,  # type: ignore
                intensity=dominant.intensity,
                name=str(dominant.type),
                eliciting="Current dominant state",
            )
        else:
            primary = OCCEmotion(
                type=OCCEmotionType.NEUTRAL,
                intensity=0,
                name="Neutral",
                eliciting="No significant emotion",
            )

        return OCCEmotionState(
            primary=primary,
            intensity=primary.intensity,
            last_update=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            appraisal=OCCAppraisal(),
            trigger=stimulus if isinstance(stimulus, dict) else str(stimulus),
        )

    async def _record_stimulus_in_history(
        self, stimulus: dict | str, appraisal_output, context: dict
    ) -> None:
        """Record stimulus in history buffer"""
        if not appraisal_output or not appraisal_output.resulting_emotions:
            return

        # Determine stimulus characteristics
        stimulus_type = "unknown"
        if isinstance(stimulus, dict):
            stimulus_type = stimulus.get("type", "unknown")

        # Calculate valence and intensity from resulting emotions
        valence = 0.0
        intensity = 0.0

        for emotion in appraisal_output.resulting_emotions:
            if emotion.type in OCCEmotionType.__members__.values():
                char = EMOTION_CHARACTERISTICS.get(OCCEmotionType(emotion.type))
                if char:
                    if char.valence == "positive":
                        valence += emotion.intensity / 10
                    elif char.valence == "negative":
                        valence -= emotion.intensity / 10
                    intensity = max(intensity, emotion.intensity)

        valence = max(-10.0, min(10.0, valence))

        stimulus_record = StimulusRecord(
            type=stimulus_type,
            valence=valence,
            intensity=intensity,
            timestamp=int(time.time() * 1000),
            context=context,
        )

        self.stimulus_buffer.add_stimulus(stimulus_record)

        # Also persist to database
        try:
            await self.db.store_stimulus(self.session_id, stimulus_record)
        except Exception as e:
            logger.error(f"[OCCEmotionManager] Failed to persist stimulus: {e}")

    def _calculate_recent_emotional_activity(self) -> float:
        """Calculate recent emotional activity level (0-1)"""
        recent_window = 15 * 60 * 1000  # 15 minutes
        recent_stimuli = self.stimulus_buffer.get_recent_stimuli(recent_window)

        if not recent_stimuli:
            return 0.0

        frequency = min(1.0, len(recent_stimuli) / 10)
        avg_intensity = sum(abs(s.valence) for s in recent_stimuli) / len(recent_stimuli) / 10

        return (frequency + avg_intensity) / 2

    def _get_time_of_day(self) -> str:
        """Get current time of day"""
        hour = time.localtime().tm_hour
        if 6 <= hour < 12:
            return "morning"
        elif 12 <= hour < 18:
            return "afternoon"
        elif 18 <= hour < 22:
            return "evening"
        else:
            return "night"

    async def _persist_state(self) -> None:
        """Persist current emotional state to database"""
        try:
            await self.db.store_emotion_state(
                self.session_id, self.active_emotions, self.last_decay_time
            )
            logger.debug(
                f"[OCCEmotionManager] Persisted state: {len(self.active_emotions)} emotions"
            )
        except Exception as e:
            logger.error(f"[OCCEmotionManager] Failed to persist state: {e}")

    # Public query methods

    def get_current_dominant_emotion(self) -> EmotionInstance | None:
        """Get the currently dominant emotion"""
        if not self.active_emotions:
            return None

        dominant = None
        for emotion in self.active_emotions.values():
            if emotion.type != "neutral" and (
                not dominant or emotion.intensity > dominant.intensity
            ):
                dominant = emotion

        return dominant

    def get_active_emotions(self) -> dict[OCCEmotionType | str, EmotionInstance]:
        """Get all active emotions"""
        return dict(self.active_emotions)

    def get_current_mood(self) -> CurrentMoodState | None:
        """Get simplified current mood"""
        dominant = self.get_current_dominant_emotion()
        if not dominant or dominant.type == "neutral":
            return None

        return CurrentMoodState(
            dominant_emotion_type=dominant.type,  # type: ignore
            intensity=dominant.intensity,
            last_updated=dominant.last_updated,
        )

    def get_emotional_state_summary(self) -> str:
        """Get human-readable emotional state summary for prompts"""
        dominant = self.get_current_dominant_emotion()

        if not dominant or dominant.type == "neutral":
            return "Note: No particular emotional signals detected."

        # Format emotion name: OCCEmotionType.INTEREST -> "interest"
        emotion_name = dominant.type.name.replace("_", " ").lower()

        # Get intensity-specific guidance
        def get_tone_guidance(intensity: float) -> str:
            if intensity > 70:
                return "Respond with care and attention to this."
            elif intensity > 40:
                return "Keep this in mind when responding."
            else:
                return "Minor signal, don't overreact."

        guidance = get_tone_guidance(dominant.intensity)
        return f"Context: User showing signs of {emotion_name}. {guidance}"
