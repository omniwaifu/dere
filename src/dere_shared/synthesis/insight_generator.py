"""
Insight Generator - Statistical pattern analysis → LLM presentation.
Inspired by amplifier's synthesizer.py but adapted for conversation analysis.
Uses algorithms for detection, LLM for formatting insights.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any


class InsightGenerator:
    """
    Generates insights from conversation patterns using statistical analysis.
    LLM formats the insights in personality-appropriate style.
    """

    def __init__(self, convergence_threshold: int = 3):
        """
        Initialize insight generator.

        Args:
            convergence_threshold: Minimum co-occurrences for convergence patterns
        """
        self.convergence_threshold = convergence_threshold

    def generate_insights(
        self, conversations: list[dict[str, Any]], personality_combo: tuple[str, ...]
    ) -> list[dict[str, Any]]:
        """
        Generate insights from conversation patterns.

        Args:
            conversations: List of conversation dicts
            personality_combo: Current personality configuration

        Returns:
            List of statistical insights (ready for LLM presentation)
        """
        insights = []

        # Extract statistical patterns
        patterns = self._extract_patterns(conversations)

        # Generate insights from patterns
        insights.extend(self._find_entity_convergence(patterns))
        insights.extend(self._find_temporal_patterns(patterns))
        insights.extend(self._find_emotion_entity_correlation(patterns))
        insights.extend(self._find_cross_medium_patterns(patterns))

        # Add personality context for LLM presentation
        for insight in insights:
            insight["personality_combo"] = personality_combo

        return insights

    def _extract_patterns(self, conversations: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Extract statistical patterns from conversations.

        Returns:
            Dict with entity frequencies, co-occurrences, temporal data, etc.
        """
        entity_counts: Counter[str] = Counter()
        entity_cooccurrences: Counter[tuple[str, str]] = Counter()
        temporal_buckets: defaultdict[int, list[dict]] = defaultdict(list)
        entity_emotions: defaultdict[str, list[tuple[str, float]]] = defaultdict(list)
        medium_entities: defaultdict[str, Counter[str]] = defaultdict(Counter)

        for conv in conversations:
            entities = conv.get("entities", [])
            timestamp = conv.get("timestamp")
            emotion_state = conv.get("emotion_state", {})
            medium = conv.get("medium", "unknown")

            # Extract entity names
            entity_names = [e.get("name", "").lower() for e in entities if e.get("name")]

            # Count entity frequencies
            for entity_name in entity_names:
                entity_counts[entity_name] += 1

            # Count co-occurrences
            for i, e1 in enumerate(entity_names):
                for e2 in entity_names[i + 1 :]:
                    pair = tuple(sorted([e1, e2]))
                    entity_cooccurrences[pair] += 1

            # Temporal bucketing (by hour of day)
            if timestamp:
                hour = timestamp.hour if hasattr(timestamp, "hour") else 0
                temporal_buckets[hour].append(conv)

            # Entity-emotion correlation
            primary_emotion = emotion_state.get("primary_emotion")
            intensity = emotion_state.get("intensity", 0)
            if primary_emotion:
                for entity_name in entity_names:
                    entity_emotions[entity_name].append((primary_emotion, intensity))

            # Medium-specific entity tracking
            for entity_name in entity_names:
                medium_entities[medium][entity_name] += 1

        return {
            "entity_counts": entity_counts,
            "entity_cooccurrences": entity_cooccurrences,
            "temporal_buckets": temporal_buckets,
            "entity_emotions": entity_emotions,
            "medium_entities": medium_entities,
        }

    def _find_entity_convergence(self, patterns: dict[str, Any]) -> list[dict[str, Any]]:
        """
        Find entities that frequently co-occur (convergence).

        Example: "project" and "deadline" mentioned together often.
        """
        insights = []
        cooccurrences = patterns.get("entity_cooccurrences", {})

        for (entity1, entity2), count in cooccurrences.items():
            if count >= self.convergence_threshold:
                strength = min(count / 10, 1.0)
                insights.append(
                    {
                        "type": "entity_convergence",
                        "pattern": "co-occurrence",
                        "entities": [entity1, entity2],
                        "count": count,
                        "strength": strength,
                        "description": f"'{entity1}' and '{entity2}' co-occur {count} times",
                        "statistical_evidence": {
                            "co_occurrence_count": count,
                            "threshold": self.convergence_threshold,
                        },
                    }
                )

        return insights

    def _find_temporal_patterns(self, patterns: dict[str, Any]) -> list[dict[str, Any]]:
        """
        Find temporal conversation patterns.

        Example: User talks more at 10am and 8pm.
        """
        insights = []
        temporal_buckets = patterns.get("temporal_buckets", {})

        if not temporal_buckets:
            return insights

        # Find peak activity hours
        hourly_counts = {hour: len(convs) for hour, convs in temporal_buckets.items()}
        if not hourly_counts:
            return insights

        max_count = max(hourly_counts.values())
        avg_count = sum(hourly_counts.values()) / len(hourly_counts)

        peak_hours = [hour for hour, count in hourly_counts.items() if count > avg_count * 1.5]

        if peak_hours:
            insights.append(
                {
                    "type": "temporal_pattern",
                    "pattern": "peak_activity",
                    "peak_hours": sorted(peak_hours),
                    "max_count": max_count,
                    "avg_count": round(avg_count, 2),
                    "strength": 0.8,
                    "description": f"Peak activity at hours: {sorted(peak_hours)}",
                    "statistical_evidence": {
                        "hourly_distribution": dict(hourly_counts),
                        "peak_threshold": round(avg_count * 1.5, 2),
                    },
                }
            )

        return insights

    def _find_emotion_entity_correlation(
        self, patterns: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """
        Find correlation between entities and emotions.

        Example: "work" entity correlates with high distress intensity.
        """
        insights = []
        entity_emotions = patterns.get("entity_emotions", {})

        for entity_name, emotion_records in entity_emotions.items():
            if len(emotion_records) < 3:
                continue

            # Calculate emotion distribution
            emotion_counts: Counter[str] = Counter()
            total_intensity = 0.0

            for emotion, intensity in emotion_records:
                emotion_counts[emotion] += 1
                total_intensity += intensity

            avg_intensity = total_intensity / len(emotion_records)
            dominant_emotion = emotion_counts.most_common(1)[0] if emotion_counts else None

            if dominant_emotion and avg_intensity > 50:  # Significant intensity
                insights.append(
                    {
                        "type": "emotion_entity_correlation",
                        "pattern": "emotion_association",
                        "entity": entity_name,
                        "dominant_emotion": dominant_emotion[0],
                        "emotion_count": dominant_emotion[1],
                        "avg_intensity": round(avg_intensity, 2),
                        "strength": min(avg_intensity / 100, 1.0),
                        "description": f"'{entity_name}' strongly associated with {dominant_emotion[0]}",
                        "statistical_evidence": {
                            "emotion_distribution": dict(emotion_counts),
                            "total_mentions": len(emotion_records),
                            "avg_intensity": round(avg_intensity, 2),
                        },
                    }
                )

        return insights

    def _find_cross_medium_patterns(self, patterns: dict[str, Any]) -> list[dict[str, Any]]:
        """
        Find differences in entity usage across mediums (CLI vs Discord).

        Example: "task" entities mentioned 80% in CLI, 20% in Discord.
        User is all business in terminal but chatty on Discord.
        """
        insights = []
        medium_entities = patterns.get("medium_entities", {})

        if len(medium_entities) < 2:
            return insights

        # Compare entity distributions across mediums
        all_entities = set()
        for entities_counter in medium_entities.values():
            all_entities.update(entities_counter.keys())

        for entity_name in all_entities:
            medium_counts = {
                medium: entities_counter.get(entity_name, 0)
                for medium, entities_counter in medium_entities.items()
            }

            total = sum(medium_counts.values())
            if total < 3:
                continue

            # Calculate distribution percentages
            medium_percentages = {
                medium: round((count / total) * 100, 1)
                for medium, count in medium_counts.items()
            }

            # Find dominant medium (>70% mentions)
            dominant_medium = None
            max_percentage = 0.0
            for medium, percentage in medium_percentages.items():
                if percentage > 70:
                    dominant_medium = medium
                    max_percentage = percentage

            if dominant_medium:
                insights.append(
                    {
                        "type": "cross_medium_pattern",
                        "pattern": "medium_preference",
                        "entity": entity_name,
                        "dominant_medium": dominant_medium,
                        "percentage": max_percentage,
                        "strength": max_percentage / 100,
                        "description": f"'{entity_name}' mentioned {max_percentage}% in {dominant_medium}",
                        "statistical_evidence": {
                            "medium_distribution": medium_percentages,
                            "total_mentions": total,
                        },
                    }
                )

        return insights
