"""
Pattern Detector - Finds recurring patterns across conversations.
Uses statistical analysis (not LLM) to detect patterns, then LLM can present them.
"""

from __future__ import annotations

from collections import Counter

from .models import ConversationPattern


class PatternDetector:
    """Detects patterns in conversation data using statistical methods."""

    def __init__(self, min_frequency: int = 3):
        """Initialize pattern detector.

        Args:
            min_frequency: Minimum occurrences to consider a pattern significant
        """
        self.min_frequency = min_frequency

    def find_convergence_patterns(
        self,
        cooccurrences: dict[tuple[str, str], int],
        personality_combo: tuple[str, ...],
    ) -> list[ConversationPattern]:
        """
        Find entity pairs that frequently appear together (convergence).

        Args:
            cooccurrences: Entity pair co-occurrence counts
            personality_combo: Personality combination

        Returns:
            List of convergence patterns
        """
        patterns = []

        for (entity1, entity2), count in cooccurrences.items():
            if count >= self.min_frequency:
                patterns.append(
                    ConversationPattern(
                        pattern_type="convergence",
                        description=f"'{entity1}' and '{entity2}' frequently discussed together",
                        frequency=count,
                        personality_combo=personality_combo,
                    )
                )

        # Sort by frequency
        patterns.sort(key=lambda p: p.frequency, reverse=True)
        return patterns[:10]  # Top 10

    def find_temporal_patterns(
        self,
        temporal_data: dict[str, list[int]],
        entity_frequencies: dict[str, int],
        personality_combo: tuple[str, ...],
    ) -> list[ConversationPattern]:
        """
        Find temporal patterns (e.g., entity X discussed mostly at hour Y).

        Args:
            temporal_data: Entity to list of hours mapping
            entity_frequencies: Overall entity frequencies
            personality_combo: Personality combination

        Returns:
            List of temporal patterns
        """
        patterns = []

        for entity, hours in temporal_data.items():
            if entity_frequencies.get(entity, 0) < self.min_frequency:
                continue

            if not hours:
                continue

            # Find peak hour
            hour_counts = Counter(hours)
            peak_hour, peak_count = hour_counts.most_common(1)[0]

            # Only report if there's a clear peak (>40% of mentions in one hour)
            if peak_count / len(hours) >= 0.4:
                patterns.append(
                    ConversationPattern(
                        pattern_type="temporal",
                        description=f"'{entity}' discussed primarily around {peak_hour:02d}:00",
                        frequency=peak_count,
                        personality_combo=personality_combo,
                    )
                )

        patterns.sort(key=lambda p: p.frequency, reverse=True)
        return patterns[:5]

    def find_divergence_patterns(
        self,
        entity_frequencies: dict[str, int],
        cooccurrences: dict[tuple[str, str], int],
        personality_combo: tuple[str, ...],
    ) -> list[ConversationPattern]:
        """
        Find entities that are frequent but never co-occur (divergent approaches).

        Args:
            entity_frequencies: Entity frequency counts
            cooccurrences: Entity co-occurrence counts
            personality_combo: Personality combination

        Returns:
            List of divergence patterns
        """
        patterns = []

        high_freq_entities = [
            entity for entity, freq in entity_frequencies.items() if freq >= self.min_frequency
        ]

        for i, entity1 in enumerate(high_freq_entities):
            for entity2 in high_freq_entities[i + 1 :]:
                pair = tuple(sorted([entity1, entity2]))

                # If never co-occur but both frequent
                if pair not in cooccurrences:
                    patterns.append(
                        ConversationPattern(
                            pattern_type="divergence",
                            description=f"'{entity1}' and '{entity2}' discussed separately (never together)",
                            frequency=entity_frequencies[entity1] + entity_frequencies[entity2],
                            personality_combo=personality_combo,
                        )
                    )

        patterns.sort(key=lambda p: p.frequency, reverse=True)
        return patterns[:5]

    def find_frequency_leaders(
        self,
        entity_frequencies: dict[str, int],
        personality_combo: tuple[str, ...],
    ) -> list[ConversationPattern]:
        """
        Find most frequently discussed entities.

        Args:
            entity_frequencies: Entity frequency counts
            personality_combo: Personality combination

        Returns:
            List of frequency leader patterns
        """
        patterns = []

        # Sort by frequency
        sorted_entities = sorted(entity_frequencies.items(), key=lambda x: x[1], reverse=True)

        for entity, freq in sorted_entities[:10]:
            if freq >= self.min_frequency:
                patterns.append(
                    ConversationPattern(
                        pattern_type="frequency_leader",
                        description=f"'{entity}' is a frequent topic",
                        frequency=freq,
                        personality_combo=personality_combo,
                    )
                )

        return patterns
