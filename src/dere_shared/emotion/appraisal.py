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
    from dere_graph.llm_client import ClaudeClient


class AppraisalEngine:
    """OCC appraisal engine using dere_graph LLM client"""

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
        persona_name: str = "AI",
    ) -> AppraisalOutput | None:
        """Appraise a stimulus using dere_graph LLM client"""

        if not self.llm_client:
            logger.error("[AppraisalEngine] No LLM client provided")
            return None

        try:
            # Build prompt
            prompt = self._build_appraisal_prompt(
                stimulus, current_emotion_state, context or {}, persona_name
            )

            logger.debug("[AppraisalEngine] Calling LLM client")

            # Import here to avoid circular import at module level
            from dere_graph.llm_client import Message

            # Call LLM client with structured output
            messages = [Message(role="user", content=prompt)]
            appraisal_output = await self.llm_client.generate_response(
                messages=messages,
                response_model=AppraisalOutput,
            )

            logger.info(
                f"[AppraisalEngine] Appraisal completed: "
                f"{len(appraisal_output.resulting_emotions)} emotions"
            )

            return appraisal_output

        except Exception as e:
            logger.error(f"[AppraisalEngine] Appraisal failed: {e}")
            return None

    def _build_appraisal_prompt(
        self,
        stimulus: dict | str,
        current_emotion_state: OCCEmotionState,
        context: dict,
        persona_name: str,
    ) -> str:
        """Build the OCC appraisal prompt"""

        # Format OCC config
        goals_str = "\n".join(
            f"- {g.id}: {g.description} (importance: {g.importance})"
            for g in self.goals
            if g.active
        )

        standards_str = "\n".join(
            f"- {s.id}: {s.description} (importance: {s.importance}, "
            f"praiseworthiness: {s.praiseworthiness})"
            for s in self.standards
        )

        attitudes_str = "\n".join(
            f"- {a.id}: {a.target_object} - {a.description} (appealingness: {a.appealingness})"
            for a in self.attitudes
        )

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
            stimulus_type = stimulus.get("type", "unknown")
        else:
            stimulus_str = str(stimulus)
            stimulus_type = "unknown"

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

        # Build the complete prompt following OCC hierarchy
        prompt = f"""You are analyzing the USER's emotional state using the OCC (Ortony, Clore, Collins) cognitive appraisal model.
You are interpreting their emotions through the lens of a {persona_name} personality.

CRITICAL: You are detecting what emotions the USER is experiencing, NOT what emotions you (the bot) should feel.

YOUR PERSPECTIVE AS {persona_name.upper()}:
Your personality colors how you interpret the user's emotional state. As {persona_name}, you bring your characteristic lens to understanding their emotions - this affects how you read subtle cues, what aspects you emphasize, and how you frame their emotional experience.

USER'S PROFILE:
Goals (What the user wants to achieve):
{goals_str}

Standards (What makes the user feel proud/ashamed):
{standards_str}

Attitudes (How the user feels about things):
{attitudes_str}

USER'S CURRENT EMOTIONAL STATE:
{current_emotion_str}

{context_str}SITUATION:
Stimulus Type: {stimulus_type}
Stimulus Details:
{stimulus_str}

APPRAISAL TASK:

Analyze what the USER is likely experiencing emotionally based on their profile and the situation.
Interpret through your {persona_name} personality - your characteristic way of reading emotions.

1. **Identify Relevant Dimension(s) for the USER:**
   - Event Consequences: Does this impact the user's goals (desirability)?
   - User Actions: Does this involve the user's praiseworthy/blameworthy actions related to their standards?
   - Object Aspects: Does this concern appealingness of objects/people based on the user's attitudes?

2. **Evaluate Along Dimension(s) from USER's Perspective:**
   - Event: From the user's perspective, is this desirable/undesirable/neutral? Prospective or actual? Which of their goals are affected? Strength (-10 to 10)?
   - Action: From the user's perspective, is this praiseworthy/blameworthy/neutral? Self or other? Which of their standards are affected? Strength (-10 to 10)?
   - Object: From the user's perspective, is this appealing/unappealing/neutral? Familiar/unfamiliar? Which of their attitudes are affected? Strength (-10 to 10)?

3. **Map to OCC Emotion(s):** Determine what specific emotions the USER is experiencing and their intensity (0-100) based on appraisal.
   Your {persona_name} perspective may pick up on nuances others might miss or emphasize different emotional aspects.

   INTENSITY CALIBRATION (0-100 scale):
   - 10-30: Subtle/mild emotion (passing thought, slight preference, minor reaction)
   - 30-50: Noticeable emotion (clear feeling, colors perspective)
   - 50-70: Strong emotion (significant response, influences behavior)
   - 70-90: Intense emotion (dominant state, hard to ignore)
   - 90-100: Overwhelming (peak experience, all-consuming)

   IMPORTANT: Most normal conversation involves mild emotions (20-40 range).
   Reserve 70+ for genuinely intense emotional moments (excitement, distress, anger, etc.).

   Map appraisal strength to intensity:
   - Desirability/appealingness ±1-3 → intensity 15-35
   - Desirability/appealingness ±4-6 → intensity 35-60
   - Desirability/appealingness ±7-9 → intensity 60-85
   - Desirability/appealingness ±10 → intensity 85-95

   Examples:
   - "that's neat" → interest: 25 (mild curiosity)
   - "I'm really excited about this!" → joy: 75 (strong enthusiasm)
   - "ugh, frustrated" → distress: 45 (moderate irritation)
   - "THIS IS AMAZING!!!" → joy: 90 (overwhelming excitement)

4. **Trust Delta:** If the stimulus significantly impacts the user's trust, suggest adjustment (-0.1 to 0.1).

Use the user's profile, goals, standards, attitudes, AND temporal context to interpret what the user is experiencing.
Let your {persona_name} personality guide your interpretation while staying true to the OCC model.

Return ONLY a JSON object. No text before or after. Schema:
{{
  "event_outcome": {{"type": "desirable|undesirable|neutral", "prospect": "prospective|actual|none", "affected_goals": [], "desirability": -10 to 10}},
  "agent_action": {{"agent": "self|other", "type": "praiseworthy|blameworthy|neutral", "affected_standards": [], "praiseworthiness": -10 to 10}},
  "object_attribute": {{"familiarity": "familiar|unfamiliar|none", "type": "appealing|unappealing|neutral", "affected_attitudes": [], "appealingness": -10 to 10}},
  "resulting_emotions": [{{"name": "...", "type": "VALID_OCC_TYPE", "intensity": 0-100, "eliciting": "..."}}],
  "reasoning": "...",
  "suggested_trust_delta": null or number
}}

CRITICAL: emotion type MUST be: hope, fear, joy, distress, satisfaction, relief, fears-confirmed, disappointment, happy-for, pity, gloating, resentment, pride, shame, admiration, reproach, love, hate, interest, disgust, gratitude, anger, gratification, remorse, OR neutral. Map non-OCC emotions (surprise→interest, worry→fear)."""

        return prompt
