from __future__ import annotations

import asyncio
import json
import subprocess

from loguru import logger

from dere_shared.emotion.models import (
    AppraisalOutput,
    OCCAttitude,
    OCCEmotionState,
    OCCGoal,
    OCCStandard,
)


class AppraisalEngine:
    """OCC appraisal engine using Claude Code SDK"""

    def __init__(
        self,
        goals: list[OCCGoal],
        standards: list[OCCStandard],
        attitudes: list[OCCAttitude],
    ):
        self.goals = goals
        self.standards = standards
        self.attitudes = attitudes

    async def appraise_stimulus(
        self,
        stimulus: dict | str,
        current_emotion_state: OCCEmotionState,
        context: dict | None = None,
        persona_name: str = "AI",
    ) -> AppraisalOutput | None:
        """Appraise a stimulus using Claude CLI"""

        try:
            # Build prompt
            prompt = self._build_appraisal_prompt(
                stimulus, current_emotion_state, context or {}, persona_name
            )

            logger.debug("[AppraisalEngine] Calling Claude CLI")

            # Call claude CLI - use simple mode, parse JSON from response
            process = await asyncio.create_subprocess_exec(
                "claude",
                "-p",
                prompt,
                "--model",
                "claude-3-5-haiku-20241022",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                logger.error(f"[AppraisalEngine] CLI failed: {stderr.decode()}")
                return None

            response_text = stdout.decode()

            # Parse JSON from response text
            try:
                json_start = response_text.find("{")
                json_end = response_text.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = response_text[json_start:json_end]
                    response_data = json.loads(json_str)
                else:
                    logger.error("[AppraisalEngine] No JSON found in response")
                    logger.debug(f"[AppraisalEngine] Response: {response_text[:500]}")
                    return None
            except json.JSONDecodeError as e:
                logger.error(f"[AppraisalEngine] Failed to parse JSON: {e}")
                logger.debug(f"[AppraisalEngine] Response: {response_text[:500]}")
                return None

            # Normalize emotion types to lowercase
            if "resulting_emotions" in response_data:
                for emotion in response_data["resulting_emotions"]:
                    if "type" in emotion:
                        emotion["type"] = emotion["type"].lower()

            # Validate with Pydantic
            try:
                appraisal_output = AppraisalOutput.model_validate(response_data)

                logger.info(
                    f"[AppraisalEngine] Appraisal completed: "
                    f"{len(appraisal_output.resulting_emotions)} emotions"
                )

                return appraisal_output

            except Exception as e:
                logger.error(f"[AppraisalEngine] Validation error: {e}")
                logger.debug(f"[AppraisalEngine] Response data: {response_data}")
                return None

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
            f"Current primary emotion: {current_emotion_state.primary.name} "
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

                context_lines.append(f"Personality: {context.get('personality', 'default')}")
                context_str = "\n".join(context_lines) + "\n\n"

        # Build the complete prompt following OCC hierarchy
        prompt = f"""You are implementing the OCC (Ortony, Clore, Collins) cognitive appraisal model.
Determine the most specific and applicable emotion(s) based on the agent's profile and situation.

AGENT'S PROFILE (Personality: {persona_name}):
Goals (Desirable/Undesirable Events):
{goals_str}

Standards (Praiseworthy/Blameworthy Actions):
{standards_str}

Attitudes (Appealing/Unappealing Objects):
{attitudes_str}

CURRENT STATE:
{current_emotion_str}

{context_str}SITUATION:
Stimulus Type: {stimulus_type}
Stimulus Details:
{stimulus_str}

APPRAISAL TASK:

1. **Identify Relevant Dimension(s):**
   - Event Consequences: Does it impact goals (desirability)?
   - Agent Actions: Does it involve praiseworthy/blameworthy actions related to standards?
   - Object Aspects: Does it concern appealingness of objects/people based on attitudes?

2. **Evaluate Along Dimension(s):**
   - Event: Desirable/undesirable/neutral? Prospective or actual? Affected goals? Strength (-10 to 10)?
   - Action: Praiseworthy/blameworthy/neutral? Self or other? Affected standards? Strength (-10 to 10)?
   - Object: Appealing/unappealing/neutral? Familiar/unfamiliar? Affected attitudes? Strength (-10 to 10)?

3. **Map to OCC Emotion(s):** Determine specific emotions and intensity (0-100) based on appraisal.

4. **Trust Delta:** If the stimulus significantly impacts trust, suggest adjustment (-0.1 to 0.1).

Use personality profile, goals, standards, attitudes, AND temporal context to interpret the stimulus.

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
