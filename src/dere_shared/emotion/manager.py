from __future__ import annotations

import time
from typing import TYPE_CHECKING

from loguru import logger

from dere_shared.emotion.appraisal import AppraisalEngine
from dere_shared.emotion.decay import DecayContext, SmartDecay
from dere_shared.emotion.history import StimulusBuffer, StimulusRecord
from dere_shared.emotion.models import (
    EMOTION_CHARACTERISTICS,
    AppraisalOutput,
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

# Batch appraisal limits to avoid OS argument length limits (E2BIG)
MAX_BATCH_SIZE = 8  # Max stimuli per batch
MAX_CONTENT_CHARS = 500  # Max chars per message content


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

        # Batch appraisal state
        self._pending_stimuli: list[dict] = []
        self._last_stimulus_time: float = 0.0  # monotonic time

    async def initialize(self) -> None:
        """Load emotion state and stimulus history from database"""
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

        # Load stimulus history (last hour)
        try:
            since_ms = int(time.time() * 1000) - (60 * 60 * 1000)
            history = await self.db.load_stimulus_history(self.session_id, since_ms)
            for record in history:
                self.stimulus_buffer.add_stimulus(
                    StimulusRecord(
                        type=record["type"],
                        valence=record["valence"],
                        intensity=record["intensity"],
                        timestamp=record["timestamp"],
                        context=record["context"],
                    )
                )
            if history:
                logger.info(f"[OCCEmotionManager] Loaded {len(history)} stimuli from DB")
        except Exception as e:
            logger.error(f"[OCCEmotionManager] Error loading stimulus history: {e}")

    async def _apply_decay_stage(self, start_time: int) -> None:
        """Pipeline Stage 1: Apply emotion decay based on time elapsed."""
        await self._apply_smart_decay(start_time)

    async def _appraisal_stage(
        self, stimulus: dict | str, context: dict, persona_prompt: str
    ) -> AppraisalOutput | None:
        """Pipeline Stage 2: Run OCC appraisal on stimulus."""
        current_emotion_state = self._build_current_emotion_state(stimulus)
        appraisal_output = await self.appraisal_engine.appraise_stimulus(
            stimulus, current_emotion_state, context, persona_prompt
        )

        if not appraisal_output or not appraisal_output.resulting_emotions:
            logger.debug("[OCCEmotionManager] No emotions from appraisal")
            return None

        return appraisal_output

    async def _physics_stage(
        self, appraisal_output: AppraisalOutput, context: dict, start_time: int
    ) -> list[tuple[OCCEmotionType, any]]:
        """Pipeline Stage 3: Apply emotion physics to resulting emotions."""
        logger.debug("[OCCEmotionManager] === APPLYING EMOTION PHYSICS ===")
        physics_results = []

        for emotion in appraisal_output.resulting_emotions:
            if emotion.type == "neutral" or emotion.type not in OCCEmotionType.__members__.values():
                continue

            emotion_type = OCCEmotionType(emotion.type)
            raw_intensity = emotion.intensity
            prior_intensity = self.active_emotions.get(emotion_type)

            # Build physics context
            physics_context = self._build_physics_context(context)

            # Calculate physics-adjusted intensity
            physics_result = self.emotion_physics.calculate_intensity_change(
                emotion_type, raw_intensity, physics_context
            )

            # Log detailed physics calculations
            logger.debug(
                f"[OCCEmotionManager] {emotion_type.value}: "
                f"raw={raw_intensity:.1f}, "
                f"prior={(prior_intensity.intensity if prior_intensity else 0):.1f}, "
                f"momentum_resistance={physics_result.momentum_resistance:.2f}, "
                f"final={physics_result.final_intensity:.1f}"
            )

            # Update active emotions if intensity is significant
            if physics_result.final_intensity > 1.0:
                old_intensity = (
                    self.active_emotions[emotion_type].intensity
                    if emotion_type in self.active_emotions
                    else 0
                )
                self.active_emotions[emotion_type] = EmotionInstance(
                    type=emotion_type,
                    intensity=physics_result.final_intensity,
                    last_updated=start_time,
                )
                physics_results.append((emotion_type, physics_result))

                if old_intensity > 0:
                    delta = physics_result.final_intensity - old_intensity
                    logger.debug(
                        f"[OCCEmotionManager] Updated {emotion_type.value}: "
                        f"{old_intensity:.1f} → {physics_result.final_intensity:.1f} "
                        f"(Δ{delta:+.1f})"
                    )
                else:
                    logger.debug(
                        f"[OCCEmotionManager] New emotion {emotion_type.value}: "
                        f"{physics_result.final_intensity:.1f}"
                    )
            elif emotion_type in self.active_emotions:
                # Remove if physics brought it below threshold
                old_intensity = self.active_emotions[emotion_type].intensity
                del self.active_emotions[emotion_type]
                logger.debug(
                    f"[OCCEmotionManager] Removed {emotion_type.value}: "
                    f"{old_intensity:.1f} → 0 (below threshold)"
                )

        return physics_results

    async def _persistence_stage(
        self, appraisal_output: AppraisalOutput, stimulus: dict | str, context: dict, start_time: int
    ) -> None:
        """Pipeline Stage 4: Record stimulus history and persist emotional state."""
        # Record stimulus in history
        await self._record_stimulus_in_history(stimulus, appraisal_output, context)

        # Persist state
        await self._persist_state()
        self.last_major_emotional_change = start_time

    def buffer_stimulus(
        self, stimulus: dict | str, context: dict | None = None, persona_prompt: str = ""
    ) -> None:
        """
        Buffer a stimulus for later batch appraisal.
        Call flush_batch_appraisal() to process all buffered stimuli.
        """
        import time as time_module

        self._pending_stimuli.append({
            "stimulus": stimulus,
            "context": context or {},
            "persona_prompt": persona_prompt,
            "timestamp": int(time.time() * 1000),
        })
        self._last_stimulus_time = time_module.monotonic()
        logger.debug(
            f"[OCCEmotionManager] Buffered stimulus, {len(self._pending_stimuli)} pending"
        )

    def has_pending_stimuli(self) -> bool:
        """Check if there are pending stimuli to process."""
        return len(self._pending_stimuli) > 0

    def get_last_stimulus_time(self) -> float:
        """Get monotonic time of last buffered stimulus."""
        return self._last_stimulus_time

    async def flush_batch_appraisal(self) -> dict[OCCEmotionType | str, EmotionInstance]:
        """
        Process all buffered stimuli in a single batch appraisal.
        Returns current active emotions after processing.
        """
        if not self._pending_stimuli:
            return self.active_emotions

        pending_count = len(self._pending_stimuli)
        start_time = int(time.time() * 1000)

        # Stage 1: Apply decay
        await self._apply_decay_stage(start_time)

        # Combine stimuli into batch (may drop excess/truncate content)
        combined_stimulus = self._combine_stimuli_for_batch()
        context = self._pending_stimuli[-1]["context"]  # Use most recent context

        dropped = combined_stimulus.get("dropped_count", 0)
        if dropped > 0:
            logger.info(
                f"[OCCEmotionManager] Flushing batch: {pending_count} stimuli "
                f"({dropped} dropped, {combined_stimulus['message_count']} processed)"
            )
        else:
            logger.info(
                f"[OCCEmotionManager] Flushing batch: {pending_count} stimuli"
            )
        persona_prompt = self._pending_stimuli[-1]["persona_prompt"]

        # Stage 2: Run batch appraisal
        appraisal_output = await self._appraisal_stage(combined_stimulus, context, persona_prompt)

        # Clear buffer regardless of appraisal result
        self._pending_stimuli = []

        if not appraisal_output:
            return self.active_emotions

        # Stage 3: Apply physics
        physics_results = await self._physics_stage(appraisal_output, context, start_time)

        # Stage 4: Persist if changed
        if physics_results:
            await self._persistence_stage(appraisal_output, combined_stimulus, context, start_time)
            logger.info(
                f"[OCCEmotionManager] Batch appraisal complete: "
                f"{len(physics_results)} emotions changed, "
                f"{len(self.active_emotions)} total active"
            )

        return self.active_emotions

    def _combine_stimuli_for_batch(self) -> dict:
        """Combine buffered stimuli into a single batch stimulus.

        Limits batch size and content length to avoid OS argument length limits.
        """
        # Take only most recent stimuli if we have too many
        stimuli_to_process = self._pending_stimuli[-MAX_BATCH_SIZE:]
        dropped = len(self._pending_stimuli) - len(stimuli_to_process)

        messages = []
        for item in stimuli_to_process:
            stimulus = item["stimulus"]
            if isinstance(stimulus, dict):
                content = stimulus.get("content") or stimulus.get("message") or str(stimulus)
                msg_type = stimulus.get("type") or stimulus.get("message_type") or "message"
            else:
                content = str(stimulus)
                msg_type = "message"

            # Truncate long content
            if len(content) > MAX_CONTENT_CHARS:
                content = content[:MAX_CONTENT_CHARS] + "..."

            messages.append({"type": msg_type, "content": content})

        result = {
            "type": "batch_conversation",
            "message_count": len(messages),
            "messages": messages,
            "time_span_ms": (
                stimuli_to_process[-1]["timestamp"] - stimuli_to_process[0]["timestamp"]
                if len(stimuli_to_process) > 1
                else 0
            ),
        }

        if dropped > 0:
            result["dropped_count"] = dropped

        return result

    async def process_stimulus(
        self, stimulus: dict | str, context: dict | None = None, persona_prompt: str = ""
    ) -> dict[OCCEmotionType | str, EmotionInstance]:
        """
        Process a stimulus through the complete pipeline:
        decay → appraise → physics → persist

        NOTE: Consider using buffer_stimulus() + flush_batch_appraisal() for
        more efficient batch processing on idle timeout.
        """
        start_time = int(time.time() * 1000)
        context = context or {}

        logger.debug(
            f"[OCCEmotionManager] Processing stimulus, "
            f"current emotions: {len(self.active_emotions)}"
        )

        # Stage 1: Apply decay
        await self._apply_decay_stage(start_time)

        # Stage 2: Run appraisal
        appraisal_output = await self._appraisal_stage(stimulus, context, persona_prompt)
        if not appraisal_output:
            return self.active_emotions

        # Stage 3: Apply physics
        physics_results = await self._physics_stage(appraisal_output, context, start_time)

        # Stage 4: Persist if changed
        if physics_results:
            await self._persistence_stage(appraisal_output, stimulus, context, start_time)
            logger.info(
                f"[OCCEmotionManager] Emotional state updated: "
                f"{len(physics_results)} emotions changed, "
                f"{len(self.active_emotions)} total active"
            )

        return self.active_emotions

    async def _check_user_presence(self) -> tuple[bool, bool]:
        """Check if user is present and engaged via presence service.

        Returns:
            (is_present, is_engaged): Tuple indicating presence and engagement status
        """
        # For now, we check the database for recent presence heartbeats
        # In the future, this could be enhanced with more sophisticated presence detection
        try:
            # Check if there's a recent session activity (within last 5 minutes)
            from datetime import UTC, datetime, timedelta

            if self.db and hasattr(self.db, 'session_factory'):
                from sqlmodel import select

                from dere_shared.models import Session

                async with self.db.session_factory() as db_session:
                    stmt = select(Session).where(Session.id == self.session_id)
                    result = await db_session.execute(stmt)
                    session = result.scalar_one_or_none()

                    if session and session.last_activity:
                        time_since_activity = datetime.now(UTC) - session.last_activity
                        is_present = time_since_activity < timedelta(minutes=5)
                        is_engaged = time_since_activity < timedelta(minutes=1)

                        return (is_present, is_engaged)
        except Exception as e:
            logger.debug(f"[OCCEmotionManager] Failed to check presence: {e}")

        # Default: assume not present
        return (False, False)

    async def _apply_smart_decay(self, current_time: int) -> None:
        """Apply context-aware decay to active emotions"""
        time_delta_ms = current_time - self.last_decay_time
        time_delta_minutes = time_delta_ms / (1000 * 60)

        if time_delta_minutes < 0.1:  # Less than 6 seconds
            return

        logger.debug(f"[OCCEmotionManager] === APPLYING DECAY ({time_delta_minutes:.1f}min elapsed) ===")

        # Get user presence status
        is_user_present, is_user_engaged = await self._check_user_presence()

        # Build decay context
        recent_activity = self._calculate_recent_emotional_activity()
        time_of_day = self._get_time_of_day()

        decay_context = DecayContext(
            is_user_present=is_user_present,
            is_user_engaged=is_user_engaged,
            recent_emotional_activity=recent_activity,
            environmental_stress=0.3,
            social_support=0.5,
            time_of_day=time_of_day,
            personality_stability=0.6,
        )

        logger.debug(
            f"[OCCEmotionManager] Decay context: "
            f"activity={recent_activity:.2f}, time={time_of_day}"
        )

        # Store pre-decay state for comparison
        pre_decay_emotions = {k: v.intensity for k, v in self.active_emotions.items()}

        # Apply decay
        decay_result = self.smart_decay.apply_decay_to_emotions(
            self.active_emotions, time_delta_minutes, decay_context
        )

        self.active_emotions = decay_result["updated_emotions"]
        self.last_decay_time = current_time

        # Log detailed decay results
        for emotion_type, pre_intensity in pre_decay_emotions.items():
            if emotion_type in self.active_emotions:
                post_intensity = self.active_emotions[emotion_type].intensity
                if abs(post_intensity - pre_intensity) > 0.1:
                    logger.debug(
                        f"[OCCEmotionManager] Decayed {emotion_type}: "
                        f"{pre_intensity:.1f} → {post_intensity:.1f} "
                        f"(Δ{post_intensity - pre_intensity:+.1f})"
                    )
            else:
                logger.debug(
                    f"[OCCEmotionManager] Decayed away {emotion_type}: "
                    f"{pre_intensity:.1f} → 0"
                )

        if decay_result["total_decay_activity"] > 0:
            logger.debug(
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
        stimulus_type = "text_input"
        if isinstance(stimulus, dict):
            # Try common type field names
            stimulus_type = (
                stimulus.get("type")
                or stimulus.get("stimulus_type")
                or stimulus.get("message_type")
                or stimulus.get("role", "interaction")
            )

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

        # Enrich context with resulting emotions for history display
        enriched_context = {
            **context,
            "resulting_emotions": [
                {"type": e.type, "intensity": e.intensity}
                for e in appraisal_output.resulting_emotions
            ],
            "reasoning": appraisal_output.reasoning[:200] if appraisal_output.reasoning else None,
        }

        stimulus_record = StimulusRecord(
            type=stimulus_type,
            valence=valence,
            intensity=intensity,
            timestamp=int(time.time() * 1000),
            context=enriched_context,
        )

        self.stimulus_buffer.add_stimulus(stimulus_record)

        # Persist to database (DB adapter handles 0 -> NULL conversion)
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
        """Persist current emotional state to database (DB adapter handles 0 -> NULL)"""
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
