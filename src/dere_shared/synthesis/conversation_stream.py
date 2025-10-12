"""
Conversation Stream Processor - Reads conversations from PostgreSQL and builds patterns.
Processes conversations as a temporal stream for pattern emergence.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from dere_daemon.database import Database


class ConversationStream:
    """Streams conversations from database for pattern analysis."""

    def __init__(self, db: Database):
        """Initialize stream processor.

        Args:
            db: Database instance for querying conversations
        """
        self.db = db

    def stream_for_personality(
        self, personality_combo: tuple[str, ...], limit: int | None = None
    ) -> list[dict]:
        """
        Stream conversations for a specific personality combination.

        Args:
            personality_combo: Tuple of personality names (e.g., ("tsun",) or ("dere", "kuu"))
            limit: Optional limit on number of conversations to retrieve

        Returns:
            List of conversation dicts with entities and metadata
        """
        sessions = self.db.get_sessions_by_personalities(personality_combo)
        if not sessions:
            return []

        session_ids = [s["id"] for s in sessions]
        conversations = []

        for session_id in session_ids:
            # Get conversations for this session
            result = self.db.conn.execute(
                """
                SELECT id, session_id, prompt, response, timestamp
                FROM conversations
                WHERE session_id = %s
                ORDER BY timestamp ASC
                """,
                [session_id],
            )

            for row in result:
                conv = self.db._row_to_dict(result, row)

                # Get entities for this conversation
                entity_result = self.db.conn.execute(
                    """
                    SELECT entity_type, entity_value, normalized_value
                    FROM entities
                    WHERE conversation_id = %s
                    """,
                    [conv["id"]],
                )

                entities = [self.db._row_to_dict(entity_result, e) for e in entity_result]
                conv["entities"] = entities
                conversations.append(conv)

                if limit and len(conversations) >= limit:
                    return conversations

        return conversations

    def build_cooccurrence_matrix(self, conversations: list[dict]) -> dict[tuple[str, str], int]:
        """
        Build entity co-occurrence matrix from conversations.

        Args:
            conversations: List of conversation dicts with entities

        Returns:
            Dict mapping (entity1, entity2) pairs to co-occurrence count
        """
        cooccurrences: Counter[tuple[str, str]] = Counter()

        for conv in conversations:
            entities = conv.get("entities", [])
            entity_values = [e["normalized_value"] for e in entities if e.get("normalized_value")]

            # Count co-occurrences within same conversation
            for i, e1 in enumerate(entity_values):
                for e2 in entity_values[i + 1 :]:
                    pair = tuple(sorted([e1, e2]))
                    cooccurrences[pair] += 1

        return dict(cooccurrences)

    def compute_entity_frequencies(self, conversations: list[dict]) -> dict[str, int]:
        """
        Compute frequency of each entity across conversations.

        Args:
            conversations: List of conversation dicts with entities

        Returns:
            Dict mapping entity normalized values to frequency counts
        """
        frequencies: Counter[str] = Counter()

        for conv in conversations:
            entities = conv.get("entities", [])
            for entity in entities:
                if normalized := entity.get("normalized_value"):
                    frequencies[normalized] += 1

        return dict(frequencies)

    def get_temporal_patterns(self, conversations: list[dict]) -> dict[str, list[int]]:
        """
        Analyze temporal patterns of entity mentions.

        Args:
            conversations: List of conversation dicts with entities and timestamps

        Returns:
            Dict mapping entity to list of hour-of-day when mentioned
        """
        from datetime import datetime

        temporal_data: defaultdict[str, list[int]] = defaultdict(list)

        for conv in conversations:
            timestamp = conv.get("timestamp")
            if not timestamp:
                continue

            # Convert timestamp to hour of day
            if isinstance(timestamp, int):
                dt = datetime.fromtimestamp(timestamp)
            else:
                dt = timestamp

            hour = dt.hour

            entities = conv.get("entities", [])
            for entity in entities:
                if normalized := entity.get("normalized_value"):
                    temporal_data[normalized].append(hour)

        return dict(temporal_data)
