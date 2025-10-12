"""
Tension Detector - Identifies contradictions in conversations.
Finds emotional tensions and contradictory statements across sessions.
Inspired by amplifier's tension_detector.py but adapted for conversation analysis.
"""

from __future__ import annotations

from typing import Any

from dere_shared.emotion.models import EMOTION_CHARACTERISTICS, OCCEmotionType


class TensionDetector:
    """Detects emotional contradictions and statement tensions in conversations."""

    def __init__(self, threshold: int = 3):
        """
        Initialize tension detector.

        Args:
            threshold: Minimum occurrences to flag a tension (default: 3)
        """
        self.threshold = threshold

        # Opposing emotion pairs from OCC model
        self.opposing_emotions = {
            OCCEmotionType.JOY: [OCCEmotionType.DISTRESS],
            OCCEmotionType.DISTRESS: [OCCEmotionType.JOY],
            OCCEmotionType.HOPE: [OCCEmotionType.FEAR],
            OCCEmotionType.FEAR: [OCCEmotionType.HOPE],
            OCCEmotionType.PRIDE: [OCCEmotionType.SHAME],
            OCCEmotionType.SHAME: [OCCEmotionType.PRIDE],
            OCCEmotionType.ADMIRATION: [OCCEmotionType.REPROACH],
            OCCEmotionType.REPROACH: [OCCEmotionType.ADMIRATION],
            OCCEmotionType.LOVE: [OCCEmotionType.HATE],
            OCCEmotionType.HATE: [OCCEmotionType.LOVE],
            OCCEmotionType.INTEREST: [OCCEmotionType.DISGUST],
            OCCEmotionType.DISGUST: [OCCEmotionType.INTEREST],
            OCCEmotionType.SATISFACTION: [
                OCCEmotionType.DISAPPOINTMENT,
                OCCEmotionType.FEARS_CONFIRMED,
            ],
            OCCEmotionType.DISAPPOINTMENT: [OCCEmotionType.SATISFACTION, OCCEmotionType.RELIEF],
            OCCEmotionType.RELIEF: [OCCEmotionType.FEARS_CONFIRMED, OCCEmotionType.DISAPPOINTMENT],
            OCCEmotionType.FEARS_CONFIRMED: [OCCEmotionType.SATISFACTION, OCCEmotionType.RELIEF],
            OCCEmotionType.HAPPY_FOR: [OCCEmotionType.RESENTMENT],
            OCCEmotionType.RESENTMENT: [OCCEmotionType.HAPPY_FOR],
            OCCEmotionType.PITY: [OCCEmotionType.GLOATING],
            OCCEmotionType.GLOATING: [OCCEmotionType.PITY],
            OCCEmotionType.GRATITUDE: [OCCEmotionType.ANGER, OCCEmotionType.REMORSE],
            OCCEmotionType.ANGER: [OCCEmotionType.GRATITUDE],
            OCCEmotionType.GRATIFICATION: [OCCEmotionType.REMORSE],
            OCCEmotionType.REMORSE: [OCCEmotionType.GRATIFICATION],
        }

    def find_tensions(self, conversations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Find tensions and contradictions in conversation window.

        Args:
            conversations: List of conversation dicts with entities, emotions, messages

        Returns:
            List of tension dictionaries with type, evidence, severity
        """
        tensions = []

        # Find entity-emotion contradictions
        entity_tensions = self._find_entity_emotion_tensions(conversations)
        tensions.extend(entity_tensions)

        # Find statement contradictions
        statement_tensions = self._find_statement_tensions(conversations)
        tensions.extend(statement_tensions)

        # Find temporal behavior contradictions
        behavior_tensions = self._find_behavior_tensions(conversations)
        tensions.extend(behavior_tensions)

        return tensions

    def _find_entity_emotion_tensions(
        self, conversations: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Find entities mentioned with opposing emotions.

        Example: User expresses joy about "work" in one session,
        distress about "work" in another.
        """
        tensions = []
        entity_emotions: dict[str, list[dict[str, Any]]] = {}

        # Collect entity-emotion associations
        for conv in conversations:
            session_id = conv.get("session_id")
            entities = conv.get("entities", [])
            emotion_state = conv.get("emotion_state", {})
            primary_emotion = emotion_state.get("primary_emotion")
            timestamp = conv.get("timestamp")

            if not primary_emotion or not entities:
                continue

            for entity in entities:
                entity_name = entity.get("name", "").lower()
                if not entity_name:
                    continue

                if entity_name not in entity_emotions:
                    entity_emotions[entity_name] = []

                entity_emotions[entity_name].append(
                    {
                        "emotion": primary_emotion,
                        "session_id": session_id,
                        "timestamp": timestamp,
                        "intensity": emotion_state.get("intensity", 0),
                    }
                )

        # Find contradictions
        for entity_name, emotion_records in entity_emotions.items():
            if len(emotion_records) < self.threshold:
                continue

            emotions_seen = [r["emotion"] for r in emotion_records]

            # Check for opposing emotions
            for emotion_str in emotions_seen:
                try:
                    emotion_type = OCCEmotionType(emotion_str)
                except (ValueError, TypeError):
                    continue

                if emotion_type not in self.opposing_emotions:
                    continue

                opposites = self.opposing_emotions[emotion_type]
                conflicts = [
                    r
                    for r in emotion_records
                    if r["emotion"] in [opp.value for opp in opposites]
                ]

                if conflicts:
                    original = [r for r in emotion_records if r["emotion"] == emotion_str]

                    # Calculate severity based on intensity and frequency
                    avg_intensity_orig = sum(r["intensity"] for r in original) / len(original)
                    avg_intensity_conf = sum(r["intensity"] for r in conflicts) / len(conflicts)
                    severity = (avg_intensity_orig + avg_intensity_conf) / 200  # Normalize to 0-1

                    tensions.append(
                        {
                            "type": "entity_emotion_contradiction",
                            "entity": entity_name,
                            "emotion_a": emotion_str,
                            "emotion_b": conflicts[0]["emotion"],
                            "occurrences_a": len(original),
                            "occurrences_b": len(conflicts),
                            "sessions": list(
                                {r["session_id"] for r in original + conflicts if r["session_id"]}
                            ),
                            "severity": severity,
                            "evidence": {
                                "positive_examples": original[:2],
                                "negative_examples": conflicts[:2],
                            },
                        }
                    )

        return tensions

    def _find_statement_tensions(self, conversations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Find contradictory statements using keyword analysis.

        Detects statements like:
        - "I love X" vs "I hate X"
        - "X is essential" vs "X is unnecessary"
        - "always" vs "never" about same topic
        """
        tensions = []

        # Contradiction patterns (positive, negative)
        contradiction_patterns = [
            ("love", "hate"),
            ("like", "dislike"),
            ("enjoy", "despise"),
            ("essential", "unnecessary"),
            ("critical", "optional"),
            ("important", "trivial"),
            ("always", "never"),
            ("all", "none"),
            ("increase", "decrease"),
            ("improve", "worsen"),
            ("help", "harm"),
            ("enable", "prevent"),
        ]

        # Collect statements
        statements = []
        for conv in conversations:
            message = conv.get("message", "").lower()
            session_id = conv.get("session_id")
            timestamp = conv.get("timestamp")

            if message:
                statements.append(
                    {"text": message, "session_id": session_id, "timestamp": timestamp}
                )

        # Find contradictions
        for i, stmt1 in enumerate(statements):
            for stmt2 in statements[i + 1 :]:
                # Check each contradiction pattern
                for pos_word, neg_word in contradiction_patterns:
                    if (pos_word in stmt1["text"] and neg_word in stmt2["text"]) or (
                        neg_word in stmt1["text"] and pos_word in stmt2["text"]
                    ):
                        # Check if they're about the same topic (word overlap)
                        words1 = set(stmt1["text"].split())
                        words2 = set(stmt2["text"].split())
                        common = words1 & words2 - {pos_word, neg_word, "i", "the", "a", "is"}

                        if len(common) >= 2:  # At least 2 common topic words
                            tensions.append(
                                {
                                    "type": "statement_contradiction",
                                    "statement_a": stmt1["text"][:200],
                                    "statement_b": stmt2["text"][:200],
                                    "contradiction_words": [pos_word, neg_word],
                                    "common_topics": list(common)[:5],
                                    "sessions": [stmt1["session_id"], stmt2["session_id"]],
                                    "severity": 0.7,
                                }
                            )
                            break

        return tensions

    def _find_behavior_tensions(self, conversations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Find temporal behavior contradictions.

        Example: User says "I'll do X daily" but only does it once a week.
        This requires comparing stated intentions with actual patterns.
        """
        tensions = []

        # Keywords indicating intentions/commitments
        intention_keywords = [
            "will",
            "going to",
            "plan to",
            "always",
            "every day",
            "daily",
            "weekly",
            "regularly",
        ]

        # Collect intentions and their follow-through
        intentions = []
        for conv in conversations:
            message = conv.get("message", "").lower()
            session_id = conv.get("session_id")
            timestamp = conv.get("timestamp")
            entities = conv.get("entities", [])

            # Check if message contains intention
            has_intention = any(keyword in message for keyword in intention_keywords)

            if has_intention and entities:
                intentions.append(
                    {
                        "message": message[:200],
                        "entities": [e.get("name", "").lower() for e in entities],
                        "session_id": session_id,
                        "timestamp": timestamp,
                    }
                )

        # For now, just flag intentions for manual review
        # Full implementation would track entity mentions over time
        # and compare frequency against stated intentions

        return tensions

    def _calculate_severity(self, count1: int, count2: int, max_intensity: float = 1.0) -> float:
        """
        Calculate tension severity.

        Higher severity when both sides have multiple occurrences
        and high emotional intensity.
        """
        # Normalized frequency component
        freq_score = min(count1 + count2, 10) / 10

        # Combined with intensity
        return (freq_score + max_intensity) / 2
