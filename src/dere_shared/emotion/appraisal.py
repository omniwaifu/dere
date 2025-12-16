from __future__ import annotations

import json
from typing import TYPE_CHECKING

from loguru import logger

from dere_shared.emotion.models import (
    AppraisalOutput,
    OCCAttitude,
    OCCEmotionState,
    OCCGoal,
    OCCStandard,
)

if TYPE_CHECKING:
    from dere_shared.llm_client import ClaudeClient


class AppraisalEngine:
    """OCC appraisal engine using LLM for semantic understanding."""

    def __init__(
        self,
        goals: list[OCCGoal],
        standards: list[OCCStandard],
        attitudes: list[OCCAttitude],
        llm_client: ClaudeClient | None = None,
    ):
        self.goals = goals
        self.standards = standards
        self.attitudes = attitudes
        self.llm_client = llm_client

    async def appraise_stimulus(
        self,
        stimulus: dict | str,
        current_emotion_state: OCCEmotionState,
        context: dict | None = None,
        persona_prompt: str = "",
    ) -> AppraisalOutput | None:
        """Appraise a stimulus using LLM for semantic understanding."""

        if not self.llm_client:
            logger.error("[AppraisalEngine] No LLM client provided")
            return None

        try:
            # Build prompt
            prompt = self._build_appraisal_prompt(
                stimulus, current_emotion_state, context or {}, persona_prompt
            )

            logger.debug("[AppraisalEngine] Calling LLM client")

            from dere_shared.llm_client import Message

            # Call LLM client with structured output
            messages = [Message(role="user", content=prompt)]
            appraisal_output = await self.llm_client.generate_response(
                messages=messages,
                response_model=AppraisalOutput,
            )

            # Log full appraisal dimensions
            logger.debug("[AppraisalEngine] === APPRAISAL DIMENSIONS ===")
            if appraisal_output.event_outcome:
                logger.debug(
                    f"[AppraisalEngine] Event Outcome: {appraisal_output.event_outcome.type} "
                    f"(desirability: {appraisal_output.event_outcome.desirability}, "
                    f"prospect: {appraisal_output.event_outcome.prospect}, "
                    f"affected goals: {appraisal_output.event_outcome.affected_goals})"
                )
            if appraisal_output.agent_action:
                logger.debug(
                    f"[AppraisalEngine] Agent Action: {appraisal_output.agent_action.type} "
                    f"(praiseworthiness: {appraisal_output.agent_action.praiseworthiness}, "
                    f"agent: {appraisal_output.agent_action.agent}, "
                    f"affected standards: {appraisal_output.agent_action.affected_standards})"
                )
            if appraisal_output.object_attribute:
                logger.debug(
                    f"[AppraisalEngine] Object Attribute: {appraisal_output.object_attribute.type} "
                    f"(appealingness: {appraisal_output.object_attribute.appealingness}, "
                    f"familiarity: {appraisal_output.object_attribute.familiarity}, "
                    f"affected attitudes: {appraisal_output.object_attribute.affected_attitudes})"
                )

            # Log appraisal results
            emotions_summary = ", ".join(
                f"{e.type.value}:{e.intensity:.0f}" for e in appraisal_output.resulting_emotions
            )
            logger.info(f"[AppraisalEngine] Emotions: [{emotions_summary}]")
            if appraisal_output.reasoning:
                logger.info(f"[AppraisalEngine] Reasoning: {appraisal_output.reasoning[:200]}")

            return appraisal_output

        except Exception as e:
            logger.error(f"[AppraisalEngine] Appraisal failed: {e}")
            return None

    def _format_user_profile(self) -> str:
        """Format the user's OCC profile (goals, standards, attitudes)."""
        goals_str = ", ".join(f"{g.id}({g.importance})" for g in self.goals if g.active)
        standards_str = ", ".join(f"{s.id}({s.importance})" for s in self.standards)
        attitudes_str = ", ".join(f"{a.target_object}({a.appealingness})" for a in self.attitudes)

        return f"""Goals: {goals_str}
Standards: {standards_str}
Attitudes: {attitudes_str}"""

    def _format_appraisal_task(self, persona_prompt: str) -> str:
        """Format the appraisal task instructions."""
        persona_instruction = ""
        if persona_prompt:
            persona_instruction = f"\n\nPersona (write reasoning in this voice):\n{persona_prompt}"

        return f"""Detect USER emotions (OCC model).{persona_instruction}

Event/Action/Object dimensions, strength -10 to 10. Intensity 0-100 (normal=20-40, intense=70+)."""

    def _format_response_schema(self) -> str:
        """Format the expected response schema."""
        # SDK enforces schema via StructuredOutput tool - just list valid emotion types
        return """IMPORTANT: Use ONLY these exact emotion type values (no descriptions, no combinations):
hope, fear, joy, distress, satisfaction, relief, fears-confirmed, disappointment, happy-for, pity, gloating, resentment, pride, shame, admiration, reproach, love, hate, interest, disgust, gratitude, anger, gratification, remorse, neutral."""

    def _build_appraisal_prompt(
        self,
        stimulus: dict | str,
        current_emotion_state: OCCEmotionState,
        context: dict,
        persona_prompt: str,
    ) -> str:
        """Build the OCC appraisal prompt using template methods."""

        # Format current emotion
        current_emotion_str = (
            f"User's current primary emotion: {current_emotion_state.primary.name} "
            f"({current_emotion_state.primary.type}) at intensity "
            f"{current_emotion_state.intensity}."
        )
        if current_emotion_state.secondary:
            current_emotion_str += (
                f" Secondary: {current_emotion_state.secondary.name} "
                f"({current_emotion_state.secondary.type})."
            )

        # Format stimulus
        if isinstance(stimulus, dict):
            stimulus_str = json.dumps(stimulus, indent=2)
        else:
            stimulus_str = str(stimulus)

        # Format context with emphasis on temporal and session info
        context_str = ""
        if context:
            temporal_info = context.get("temporal", {})
            session_info = context.get("session", {})

            if temporal_info or session_info:
                context_lines = ["CONTEXTUAL INFORMATION:"]

                if temporal_info:
                    time_of_day = temporal_info.get("time_of_day", "unknown")
                    day = temporal_info.get("day_of_week", "unknown")
                    hour = temporal_info.get("hour", "unknown")
                    context_lines.append(f"Time: {time_of_day} ({hour}:00) on {day}")

                if session_info:
                    duration = session_info.get("duration_minutes", 0)
                    context_lines.append(f"Session duration: {duration} minutes")
                    if session_info.get("working_dir"):
                        context_lines.append(f"Working on: {session_info['working_dir']}")

                context_str = "\n".join(context_lines) + "\n\n"

        # Compose prompt using template methods
        user_profile = self._format_user_profile()
        appraisal_task = self._format_appraisal_task(persona_prompt)
        response_schema = self._format_response_schema()

        # Build the complete prompt
        prompt = f"""{appraisal_task}

{user_profile}
Current: {current_emotion_str}
{context_str}Stimulus: {stimulus_str}

{response_schema}"""

        return prompt
