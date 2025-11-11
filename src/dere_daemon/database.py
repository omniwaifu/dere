from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import psycopg

from dere_shared.models import (
    Conversation,
    Session,
    TaskQueue,
    TaskStatus,
)


class Database:
    def __init__(self, db_url: str, embedding_dimension: int = 1024):
        self.db_url = db_url
        self.embedding_dimension = embedding_dimension
        self.conn = psycopg.connect(db_url, autocommit=True)
        self._init_schema()

    def _execute_and_commit(self, query: str, params: list | None = None):
        """Execute query and commit immediately"""
        return self.conn.execute(query, params or [])

    def _row_to_dict(self, cursor, row) -> dict[str, Any]:
        """Convert cursor row tuple to dictionary"""
        if row is None:
            return {}
        cols = [d[0] for d in cursor.description]
        return dict(zip(cols, row))

    def _rows_to_dicts(self, cursor, rows) -> list[dict[str, Any]]:
        """Convert cursor rows to list of dictionaries"""
        if not rows:
            return []
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in rows]

    def _init_schema(self) -> None:
        """Initialize database schema with all tables and indexes"""

        # Enable pgvector extension
        self.conn.execute("CREATE EXTENSION IF NOT EXISTS vector")

        # User sessions - cross-medium continuity (create first for FK reference)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                default_personality TEXT,
                started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            )
        """)

        # Sessions table
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id BIGSERIAL PRIMARY KEY,
                working_dir TEXT NOT NULL,
                start_time BIGINT NOT NULL,
                end_time BIGINT,
                continued_from BIGINT REFERENCES sessions(id),
                project_type TEXT,
                claude_session_id TEXT,
                user_session_id BIGINT REFERENCES user_sessions(id),
                medium TEXT,
                user_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Session personalities
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_personalities (
                session_id BIGINT REFERENCES sessions(id),
                personality_name TEXT NOT NULL,
                PRIMARY KEY (session_id, personality_name)
            )
        """)

        # Session MCPs
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_mcps (
                session_id BIGINT REFERENCES sessions(id),
                mcp_name TEXT NOT NULL,
                PRIMARY KEY (session_id, mcp_name)
            )
        """)

        # Session flags
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_flags (
                session_id BIGINT REFERENCES sessions(id),
                flag_name TEXT NOT NULL,
                flag_value TEXT,
                PRIMARY KEY (session_id, flag_name)
            )
        """)

        # Conversations with vector embeddings
        self.conn.execute(f"""
            CREATE TABLE IF NOT EXISTS conversations (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                prompt TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'user',
                embedding_text TEXT,
                processing_mode TEXT,
                prompt_embedding VECTOR({self.embedding_dimension}),
                timestamp BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: Add medium and user_id columns to conversations
        try:
            self.conn.execute("""
                ALTER TABLE conversations ADD COLUMN medium TEXT
            """)
        except Exception:
            pass

        try:
            self.conn.execute("""
                ALTER TABLE conversations ADD COLUMN user_id TEXT
            """)
        except Exception:
            pass

        # Task queue
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS task_queue (
                id BIGSERIAL PRIMARY KEY,
                task_type TEXT NOT NULL,
                model_name TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                priority INTEGER DEFAULT 5,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
                session_id BIGINT REFERENCES sessions(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP,
                retry_count INTEGER DEFAULT 0,
                error_message TEXT
            )
        """)

        # Entities
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS entities (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                conversation_id BIGINT REFERENCES conversations(id),
                entity_type TEXT NOT NULL,
                entity_value TEXT NOT NULL,
                normalized_value TEXT NOT NULL,
                fingerprint TEXT,
                confidence FLOAT NOT NULL,
                context_start INTEGER,
                context_end INTEGER,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: Add fingerprint column if it doesn't exist
        try:
            self.conn.execute("""
                ALTER TABLE entities ADD COLUMN fingerprint TEXT
            """)
        except Exception:
            pass

        # Entity relationships
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS entity_relationships (
                id BIGSERIAL PRIMARY KEY,
                entity_1_id BIGINT REFERENCES entities(id),
                entity_2_id BIGINT REFERENCES entities(id),
                relationship_type TEXT NOT NULL,
                confidence FLOAT NOT NULL,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Session summaries
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_summaries (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                summary_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                key_topics TEXT,
                key_entities TEXT,
                task_status TEXT,
                next_steps TEXT,
                model_used TEXT,
                processing_time_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Conversation segments
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_segments (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                segment_number INTEGER NOT NULL,
                segment_summary TEXT NOT NULL,
                original_length INTEGER NOT NULL,
                summary_length INTEGER NOT NULL,
                start_conversation_id BIGINT REFERENCES conversations(id),
                end_conversation_id BIGINT REFERENCES conversations(id),
                model_used TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(session_id, segment_number)
            )
        """)

        # Context cache
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS context_cache (
                session_id BIGINT PRIMARY KEY REFERENCES sessions(id),
                context_text TEXT NOT NULL,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Session relationships
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS session_relationships (
                session_id BIGINT REFERENCES sessions(id),
                related_session_id BIGINT REFERENCES sessions(id),
                relationship_type TEXT NOT NULL,
                strength REAL DEFAULT 1.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (session_id, related_session_id)
            )
        """)

        # Wellness sessions
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS wellness_sessions (
                id BIGSERIAL PRIMARY KEY,
                session_id TEXT UNIQUE NOT NULL,
                mode TEXT NOT NULL,
                mood INTEGER,
                energy INTEGER,
                stress INTEGER,
                key_themes TEXT,
                notes TEXT,
                homework TEXT,
                next_step_notes TEXT,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()),
                updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
            )
        """)

        # Emotion states
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS emotion_states (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                primary_emotion TEXT NOT NULL,
                primary_intensity REAL NOT NULL,
                secondary_emotion TEXT,
                secondary_intensity REAL,
                overall_intensity REAL NOT NULL,
                appraisal_data JSONB,
                trigger_data JSONB,
                last_update TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Stimulus history
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS stimulus_history (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                stimulus_type TEXT NOT NULL,
                valence REAL NOT NULL,
                intensity REAL NOT NULL,
                timestamp BIGINT NOT NULL,
                context JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Medium presence - track online mediums for routing
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS medium_presence (
                medium TEXT NOT NULL,
                user_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'online' CHECK(status IN ('online', 'offline')),
                last_heartbeat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                available_channels JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (medium, user_id)
            )
        """)

        # Ambient notifications - queue for LLM-routed messages
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS ambient_notifications (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                target_medium TEXT NOT NULL,
                target_location TEXT NOT NULL,
                message TEXT NOT NULL,
                priority TEXT NOT NULL CHECK(priority IN ('alert', 'conversation')),
                routing_reasoning TEXT,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'failed')),
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                delivered_at TIMESTAMP
            )
        """)

        # Conversation insights - synthesized insights from patterns
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_insights (
                id BIGSERIAL PRIMARY KEY,
                insight_type TEXT NOT NULL,
                content TEXT NOT NULL,
                evidence JSONB,
                confidence FLOAT,
                user_session_id BIGINT REFERENCES user_sessions(id),
                personality_combo TEXT[] NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Conversation patterns - detected patterns across sessions
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_patterns (
                id BIGSERIAL PRIMARY KEY,
                pattern_type TEXT NOT NULL,
                description TEXT NOT NULL,
                frequency INT,
                sessions JSONB,
                user_session_id BIGINT REFERENCES user_sessions(id),
                personality_combo TEXT[] NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Pattern evolution - track how patterns change over time
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS pattern_evolution (
                id BIGSERIAL PRIMARY KEY,
                pattern_id BIGINT REFERENCES conversation_patterns(id) ON DELETE CASCADE,
                snapshot_data JSONB NOT NULL,
                frequency INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create indexes
        self._create_indexes()

        # Create vector index for embeddings using ivfflat
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS conversations_embedding_idx
            ON conversations USING ivfflat (prompt_embedding vector_cosine_ops)
            WITH (lists = 100)
        """)

    def _create_indexes(self) -> None:
        """Create optimized indexes for common query patterns"""
        indexes = [
            "CREATE INDEX IF NOT EXISTS sessions_working_dir_idx ON sessions(working_dir)",
            "CREATE INDEX IF NOT EXISTS sessions_start_time_idx ON sessions(start_time DESC)",
            "CREATE INDEX IF NOT EXISTS sessions_user_session_idx ON sessions(user_session_id) WHERE user_session_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations(session_id)",
            "CREATE INDEX IF NOT EXISTS conversations_timestamp_idx ON conversations(timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS conversations_medium_idx ON conversations(medium) WHERE medium IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id) WHERE user_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS conversations_medium_timestamp_idx ON conversations(medium, timestamp DESC) WHERE medium IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS task_queue_pending_model_idx ON task_queue(status, model_name) WHERE status = 'pending'",
            "CREATE INDEX IF NOT EXISTS task_queue_claim_idx ON task_queue(status, model_name, priority, created_at) WHERE status = 'pending'",
            "CREATE INDEX IF NOT EXISTS task_queue_id_status_idx ON task_queue(id, status)",
            "CREATE INDEX IF NOT EXISTS task_queue_session_idx ON task_queue(session_id) WHERE session_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS task_queue_created_idx ON task_queue(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS entities_session_idx ON entities(session_id)",
            "CREATE INDEX IF NOT EXISTS entities_type_idx ON entities(entity_type)",
            "CREATE INDEX IF NOT EXISTS entities_normalized_idx ON entities(normalized_value)",
            "CREATE INDEX IF NOT EXISTS entities_fingerprint_idx ON entities(fingerprint) WHERE fingerprint IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS emotion_states_session_idx ON emotion_states(session_id)",
            "CREATE INDEX IF NOT EXISTS emotion_states_last_update_idx ON emotion_states(last_update DESC)",
            "CREATE INDEX IF NOT EXISTS stimulus_history_session_idx ON stimulus_history(session_id)",
            "CREATE INDEX IF NOT EXISTS stimulus_history_timestamp_idx ON stimulus_history(timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS conversation_insights_personality_idx ON conversation_insights USING GIN (personality_combo)",
            "CREATE INDEX IF NOT EXISTS conversation_patterns_personality_idx ON conversation_patterns USING GIN (personality_combo)",
            "CREATE INDEX IF NOT EXISTS pattern_evolution_pattern_idx ON pattern_evolution(pattern_id)",
            "CREATE INDEX IF NOT EXISTS pattern_evolution_created_idx ON pattern_evolution(created_at DESC)",
        ]

        for idx in indexes:
            self.conn.execute(idx)

    def create_session(self, session: Session) -> int:
        """Create a new session and return its ID"""
        result = self._execute_and_commit(
            """
            INSERT INTO sessions (working_dir, start_time, end_time, continued_from, project_type, claude_session_id, personality, medium, user_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            [
                session.working_dir,
                session.start_time,
                session.end_time,
                session.continued_from,
                session.project_type,
                session.claude_session_id,
                session.personality,
                session.medium,
                session.user_id,
            ],
        )
        return result.fetchone()[0]

    def store_conversation(self, conv: Conversation) -> int:
        """Store a conversation message"""
        # For vector columns, pass as JSON array string for vector32() function
        embedding_json = json.dumps(conv.prompt_embedding) if conv.prompt_embedding else None

        if embedding_json:
            result = self._execute_and_commit(
                """
                INSERT INTO conversations
                (session_id, prompt, message_type, embedding_text, processing_mode, prompt_embedding, timestamp, medium, user_id)
                VALUES (%s, %s, %s, %s, %s, %s::vector, %s, %s, %s)
                RETURNING id
                """,
                [
                    conv.session_id,
                    conv.prompt,
                    conv.message_type.value,
                    conv.embedding_text,
                    conv.processing_mode,
                    embedding_json,
                    conv.timestamp,
                    conv.medium,
                    conv.user_id,
                ],
            )
        else:
            result = self._execute_and_commit(
                """
                INSERT INTO conversations
                (session_id, prompt, message_type, embedding_text, processing_mode, timestamp, medium, user_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                [
                    conv.session_id,
                    conv.prompt,
                    conv.message_type.value,
                    conv.embedding_text,
                    conv.processing_mode,
                    conv.timestamp,
                    conv.medium,
                    conv.user_id,
                ],
            )
        return result.fetchone()[0]

    def search_similar(
        self, embedding: list[float], limit: int = 10, threshold: float = 0.7
    ) -> list[dict[str, Any]]:
        """Search for similar conversations using vector similarity"""
        embedding_json = json.dumps(embedding)

        # Use vector_top_k for indexed similarity search
        result = self.conn.execute(
            """
            SELECT c.id, c.session_id, c.prompt, c.message_type, c.timestamp,
                   (1 - (c.prompt_embedding <=> %s::vector)) as distance
            FROM conversations c
            WHERE c.prompt_embedding IS NOT NULL
              AND (1 - (c.prompt_embedding <=> %s::vector)) >= %s
            ORDER BY c.prompt_embedding <=> %s::vector
            LIMIT %s
            """,
            [embedding_json, embedding_json, threshold, embedding_json, limit],
        )

        return self._rows_to_dicts(result, result.fetchall())

    def queue_task(self, task: TaskQueue) -> int:
        """Add a task to the background processing queue"""
        metadata_json = json.dumps(task.task_metadata) if task.task_metadata else None

        result = self._execute_and_commit(
            """
            INSERT INTO task_queue
            (task_type, model_name, content, metadata, priority, status, session_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            [
                task.task_type,
                task.model_name,
                task.content,
                metadata_json,
                task.priority,
                task.status.value,
                task.session_id,
            ],
        )
        return result.fetchone()[0]

    def ensure_session_exists(
        self, session_id: int, working_dir: str, personality: str | None = None
    ) -> None:
        """Ensure session exists, create if it doesn't"""
        result = self.conn.execute(
            "SELECT COUNT(*) as count FROM sessions WHERE id = %s", [session_id]
        )
        row = result.fetchone()
        count = self._row_to_dict(result, row)["count"]

        if count > 0:
            return

        # Create session with specified ID
        self._execute_and_commit(
            """
            INSERT INTO sessions (id, working_dir, start_time, project_type)
            VALUES (%s, %s, %s, %s)
            """,
            [session_id, working_dir, int(Path(working_dir).stat().st_mtime), "unknown"],
        )

        # Log session creation
        personality_str = f" with {personality} personality" if personality else ""
        print(f"INFO: New dere session {session_id}{personality_str} in {working_dir}")

        # Store personality if provided
        if personality:
            self._execute_and_commit(
                "INSERT INTO session_personalities (session_id, personality_name) VALUES (%s, %s)",
                [session_id, personality],
            )

    def get_session_content(
        self, session_id: int, since_timestamp: int | None = None, max_messages: int = 50
    ) -> str:
        """Get formatted conversation content for a session.

        Args:
            session_id: Session to get content for
            since_timestamp: Only include messages after this timestamp (unix seconds)
            max_messages: Maximum number of recent messages to include (default 50)

        Returns:
            Formatted conversation string
        """
        if since_timestamp is not None:
            result = self.conn.execute(
                """
                SELECT prompt, message_type
                FROM conversations
                WHERE session_id = %s AND timestamp >= %s
                ORDER BY timestamp ASC
                """,
                [session_id, since_timestamp],
            )
        else:
            result = self.conn.execute(
                """
                SELECT prompt, message_type
                FROM conversations
                WHERE session_id = %s
                ORDER BY timestamp DESC
                LIMIT %s
                """,
                [session_id, max_messages],
            )

        rows = self._rows_to_dicts(result, result.fetchall())

        if since_timestamp is None:
            rows = list(reversed(rows))

        content_parts = []
        for row in rows:
            if row["message_type"] == "assistant":
                content_parts.append(f"Assistant: {row['prompt']}")
            else:
                content_parts.append(f"User: {row['prompt']}")

        return "\n\n".join(content_parts)

    def mark_session_ended(self, session_id: int, end_time: int | None = None) -> None:
        """Mark session as ended"""
        import time

        end_time = end_time or int(time.time())
        self._execute_and_commit(
            "UPDATE sessions SET end_time = %s WHERE id = %s", [end_time, session_id]
        )

    def get_session_personality(self, session_id: int) -> str | None:
        """Get personality for a session"""
        result = self.conn.execute(
            "SELECT personality FROM sessions WHERE id = %s",
            [session_id],
        )
        row = result.fetchone()
        return row[0] if row and row[0] else None

    def resolve_personality_hierarchy(
        self, session_id: int, default_personality: str | None = None
    ) -> str | None:
        """Resolve personality: session > default.

        Args:
            session_id: Session ID to resolve personality for
            default_personality: System default personality (fallback)

        Returns:
            Resolved personality name or None
        """
        session_personality = self.get_session_personality(session_id)
        return session_personality if session_personality else default_personality

    def get_cached_context(self, session_id: int, max_age_seconds: int) -> tuple[str | None, bool]:
        """Get cached context if it exists and is fresh"""
        import time

        result = self._execute_and_commit(
            "SELECT context_text, updated_at FROM context_cache WHERE session_id = %s", [session_id]
        )

        row = result.fetchone()
        if not row:
            return None, False

        row_dict = self._row_to_dict(result, row)
        age = int(time.time()) - row_dict["updated_at"]

        if age > max_age_seconds:
            return None, False

        return row_dict["context_text"], True

    def store_context_cache(
        self, session_id: int, context: str, metadata: dict[str, Any] | None = None
    ) -> None:
        """Store or update context cache"""
        import time

        metadata_json = json.dumps(metadata) if metadata else None
        current_time = int(time.time())

        self._execute_and_commit(
            """
            INSERT INTO context_cache (session_id, context_text, metadata, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT(session_id) DO UPDATE SET
                context_text = excluded.context_text,
                metadata = excluded.metadata,
                updated_at = excluded.updated_at
            """,
            [session_id, context, metadata_json, current_time, current_time],
        )

    def get_queue_stats(self) -> dict[str, int]:
        """Get task queue statistics"""
        result = self.conn.execute(
            """
            SELECT status, COUNT(*) as count
            FROM task_queue
            GROUP BY status
            """
        )

        stats = {"pending": 0, "processing": 0, "completed": 0, "failed": 0}
        rows = self._rows_to_dicts(result, result.fetchall())
        for row in rows:
            stats[row["status"]] = row["count"]

        return stats

    def update_conversation_embedding(self, conversation_id: int, embedding: list[float]) -> None:
        """Update conversation with embedding vector"""
        embedding_json = json.dumps(embedding)
        self._execute_and_commit(
            "UPDATE conversations SET prompt_embedding = %s::vector WHERE id = %s",
            [embedding_json, conversation_id],
        )

    def get_session(self, session_id: int) -> dict[str, Any] | None:
        """Get session by ID"""
        result = self.conn.execute(
            """
            SELECT id, working_dir, start_time, end_time, claude_session_id
            FROM sessions
            WHERE id = %s
            """,
            [session_id],
        )
        row = result.fetchone()
        return self._row_to_dict(result, row) if row else None

    def get_last_message_time(self, session_id: int) -> int | None:
        """Get timestamp of the most recent conversation message in this session.

        Args:
            session_id: Session ID

        Returns:
            Unix timestamp (seconds) of last message, or None if no messages
        """
        result = self.conn.execute(
            """
            SELECT created_at
            FROM conversations
            WHERE session_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [session_id],
        )
        row = result.fetchone()
        if row and row[0]:
            return int(row[0].timestamp())
        return None

    def get_latest_session_for_channel(
        self, working_dir: str, max_age_hours: int | None = None
    ) -> dict[str, Any] | None:
        """Find the most recent session for a channel/working directory.

        Args:
            working_dir: The working directory (e.g., discord://guild/123/channel/456)
            max_age_hours: Optional maximum age in hours to consider session active

        Returns:
            Session dict with id, working_dir, start_time, end_time, or None if not found
        """
        import time

        if max_age_hours is not None:
            cutoff = int(time.time()) - (max_age_hours * 3600)
            result = self.conn.execute(
                """
                SELECT id, working_dir, start_time, end_time, claude_session_id
                FROM sessions
                WHERE working_dir = %s AND start_time >= %s
                ORDER BY start_time DESC
                LIMIT 1
                """,
                [working_dir, cutoff],
            )
        else:
            result = self.conn.execute(
                """
                SELECT id, working_dir, start_time, end_time, claude_session_id
                FROM sessions
                WHERE working_dir = %s
                ORDER BY start_time DESC
                LIMIT 1
                """,
                [working_dir],
            )

        row = result.fetchone()
        if not row:
            return None

        return self._row_to_dict(result, row)

    def update_claude_session_id(self, session_id: int, claude_session_id: str) -> None:
        """Update the Claude SDK session ID for an existing session.

        Args:
            session_id: Daemon session ID
            claude_session_id: Claude SDK session ID to store for future resumption
        """
        from loguru import logger

        logger.info(
            "Updating claude_session_id for session {} to {}",
            session_id,
            claude_session_id,
        )
        result = self._execute_and_commit(
            "UPDATE sessions SET claude_session_id = %s WHERE id = %s",
            [claude_session_id, session_id],
        )
        logger.info("UPDATE affected {} rows", result.rowcount)

    def get_latest_active_session(
        self, medium: str | None = None, max_age_hours: int = 24
    ) -> dict[str, Any] | None:
        """Find the most recent active session, optionally filtered by medium.

        Args:
            medium: Optional medium filter ("cli", "discord", or None for any)
            max_age_hours: Maximum age in hours to consider session active

        Returns:
            Session dict with id, working_dir, start_time, personality, or None
        """
        import time

        cutoff = int(time.time()) - (max_age_hours * 3600)

        # Medium prefix mapping for future extensibility
        medium_prefixes = {
            "discord": "discord://",
            # TODO: Telegram integration - add "telegram": "telegram://" when implementing
            # TODO: Slack integration - add "slack": "slack://" if needed
        }

        if medium and medium in medium_prefixes:
            # Specific medium: match prefix
            medium_filter = "working_dir LIKE %s"
            params = [cutoff, f"{medium_prefixes[medium]}%"]
        elif medium == "cli":
            # CLI: exclude all known protocol prefixes
            prefixes = list(medium_prefixes.values())
            conditions = " AND ".join(["working_dir NOT LIKE %s"] * len(prefixes))
            medium_filter = f"({conditions})" if prefixes else "1=1"
            params = [cutoff] + [f"{p}%" for p in prefixes]
        else:
            # No filter: any medium
            medium_filter = "1=1"
            params = [cutoff]

        query = f"""
            SELECT s.id, s.working_dir, s.start_time, sp.personality_name
            FROM sessions s
            LEFT JOIN session_personalities sp ON s.id = sp.session_id
            WHERE s.end_time IS NULL
              AND s.start_time >= %s
              AND {medium_filter}
            ORDER BY s.start_time DESC
            LIMIT 1
        """

        result = self.conn.execute(query, params)
        row = result.fetchone()
        return self._row_to_dict(result, row) if row else None

    def get_previous_mode_session(self, mode: str, working_dir: str) -> dict[str, Any] | None:
        """Find the most recent completed session for a given mode"""
        # Python 3.13 multi-line f-string
        query = """
            SELECT s.id, s.start_time,
                   COALESCE(ss.summary, '') as summary,
                   COALESCE(ss.key_topics, '') as key_topics,
                   COALESCE(ss.next_steps, '') as next_steps
            FROM sessions s
            LEFT JOIN session_summaries ss
                ON s.id = ss.session_id
                AND ss.summary_type = 'wellness'
            JOIN session_flags sf ON s.id = sf.session_id
            WHERE sf.flag_name = 'mode'
              AND sf.flag_value = %s
              AND s.working_dir = %s
              AND s.end_time IS NOT NULL
            ORDER BY s.start_time DESC
            LIMIT 1
        """
        result = self.conn.execute(query, [mode, working_dir])

        row = result.fetchone()
        if not row:
            return None

        return self._row_to_dict(result, row)

    def store_wellness_session(
        self, session_id: int, mode: str, wellness_data: dict[str, Any]
    ) -> None:
        """Store wellness session data"""
        self._execute_and_commit(
            """
            INSERT INTO wellness_sessions
            (session_id, mode, mood, energy, stress, key_themes, notes, homework, next_step_notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(session_id) DO UPDATE SET
                mood = excluded.mood,
                energy = excluded.energy,
                stress = excluded.stress,
                key_themes = excluded.key_themes,
                notes = excluded.notes,
                homework = excluded.homework,
                next_step_notes = excluded.next_step_notes,
                updated_at = strftime('%s', 'now')
            """,
            [
                str(session_id),
                mode,
                wellness_data.get("mood"),
                wellness_data.get("energy"),
                wellness_data.get("stress"),
                json.dumps(wellness_data.get("key_themes", [])),
                wellness_data.get("notes", ""),
                json.dumps(wellness_data.get("homework", [])),
                wellness_data.get("next_step_notes", ""),
            ],
        )

    def store_session_summary(
        self,
        session_id: int,
        summary_type: str,
        summary: str,
        key_topics: str | None = None,
        next_steps: str | None = None,
        model_used: str | None = None,
    ) -> None:
        """Store session summary"""
        self._execute_and_commit(
            """
            INSERT INTO session_summaries
            (session_id, summary_type, summary, key_topics, next_steps, model_used)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [session_id, summary_type, summary, key_topics, next_steps, model_used],
        )

    def get_tasks_by_model(self) -> dict[str, list[TaskQueue]]:
        """Get pending tasks grouped by model"""
        result = self.conn.execute(
            """
            SELECT id, task_type, model_name, content, metadata, priority, status, session_id, retry_count
            FROM task_queue
            WHERE status = 'pending'
            ORDER BY priority DESC, created_at ASC
            """
        )

        tasks_by_model: dict[str, list[TaskQueue]] = {}
        rows = self._rows_to_dicts(result, result.fetchall())
        for row in rows:
            task = TaskQueue(
                id=row["id"],
                task_type=row["task_type"],
                model_name=row["model_name"],
                content=row["content"],
                metadata=json.loads(row["metadata"]) if row["metadata"] else None,
                priority=row["priority"],
                status=TaskStatus(row["status"]),
                session_id=row["session_id"],
                retry_count=row["retry_count"],
            )

            if task.model_name not in tasks_by_model:
                tasks_by_model[task.model_name] = []
            tasks_by_model[task.model_name].append(task)

        return tasks_by_model

    def update_task_status(
        self, task_id: int, status: TaskStatus, error_message: str | None = None
    ) -> None:
        """Update task status"""
        if error_message:
            self._execute_and_commit(
                "UPDATE task_queue SET status = %s, error_message = %s, processed_at = NOW() WHERE id = %s",
                [status.value, error_message, task_id],
            )
        else:
            self._execute_and_commit(
                "UPDATE task_queue SET status = %s, processed_at = NOW() WHERE id = %s",
                [status.value, task_id],
            )

    def increment_task_retry(self, task_id: int) -> None:
        """Increment task retry count"""
        self._execute_and_commit(
            "UPDATE task_queue SET retry_count = retry_count + 1 WHERE id = %s", [task_id]
        )

    def reset_stuck_tasks(self) -> int:
        """Reset any tasks stuck in processing state back to pending"""
        result = self._execute_and_commit(
            "UPDATE task_queue SET status = 'pending' WHERE status = 'processing'"
        )
        return result.rowcount

    def store_entity(
        self,
        session_id: int,
        conversation_id: int | None,
        entity_type: str,
        entity_value: str,
        normalized_value: str,
        confidence: float,
    ) -> None:
        """Store extracted entity with semantic fingerprint"""
        from dere_shared.synthesis import SemanticFingerprinter

        # Generate fingerprint for entity resolution
        fingerprinter = SemanticFingerprinter()
        fingerprint = fingerprinter.fingerprint(normalized_value)

        self._execute_and_commit(
            """
            INSERT INTO entities
            (session_id, conversation_id, entity_type, entity_value, normalized_value, fingerprint, confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                session_id,
                conversation_id,
                entity_type,
                entity_value,
                normalized_value,
                fingerprint,
                confidence,
            ],
        )

    def get_entities_for_conversation(self, conversation_id: int) -> list[dict[str, Any]]:
        """Get all entities extracted from a specific conversation"""
        result = self.conn.execute(
            """
            SELECT id, entity_type, entity_value, normalized_value, confidence
            FROM entities
            WHERE conversation_id = %s
            ORDER BY confidence DESC
            """,
            [conversation_id],
        )
        return self._rows_to_dicts(result, result.fetchall())

    def get_entities_by_session(
        self, session_id: int, entity_type: str | None = None
    ) -> list[dict[str, Any]]:
        """Get entities for a session, optionally filtered by type"""
        if entity_type:
            result = self.conn.execute(
                """
                SELECT id, conversation_id, entity_type, entity_value,
                       normalized_value, confidence, created_at
                FROM entities
                WHERE session_id = %s AND entity_type = %s
                ORDER BY created_at DESC
                """,
                [session_id, entity_type],
            )
        else:
            result = self.conn.execute(
                """
                SELECT id, conversation_id, entity_type, entity_value,
                       normalized_value, confidence, created_at
                FROM entities
                WHERE session_id = %s
                ORDER BY created_at DESC
                """,
                [session_id],
            )
        return self._rows_to_dicts(result, result.fetchall())

    def get_conversations_with_entities(
        self, entity_values: list[str], limit: int = 50
    ) -> list[dict[str, Any]]:
        """Find conversations that mention specific entities"""
        result = self.conn.execute(
            """
            SELECT DISTINCT c.id, c.session_id, c.prompt, c.message_type,
                   c.timestamp, s.working_dir,
                   ARRAY_AGG(DISTINCT e.normalized_value) as matched_entities
            FROM conversations c
            JOIN entities e ON e.conversation_id = c.id
            JOIN sessions s ON s.id = c.session_id
            WHERE e.normalized_value = ANY(%s)
            GROUP BY c.id, s.working_dir
            ORDER BY c.timestamp DESC
            LIMIT %s
            """,
            [entity_values, limit],
        )
        return self._rows_to_dicts(result, result.fetchall())

    def get_entities_by_user(
        self, user_id: str, entity_type: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Get all entities for a user across all sessions and mediums.

        Args:
            user_id: User ID to filter by
            entity_type: Optional entity type filter
            limit: Maximum number of entities to return

        Returns:
            List of entities with session and medium information
        """
        type_filter = "AND e.entity_type = %s" if entity_type else ""
        params = [user_id]
        if entity_type:
            params.append(entity_type)
        params.append(limit)

        result = self.conn.execute(
            f"""
            SELECT
                e.id,
                e.normalized_value,
                e.entity_type,
                e.entity_value,
                e.fingerprint,
                e.confidence,
                s.id as session_id,
                s.working_dir as medium,
                e.created_at
            FROM entities e
            JOIN sessions s ON s.id = e.session_id
            WHERE s.user_id = %s
            {type_filter}
            ORDER BY e.created_at DESC
            LIMIT %s
            """,
            params,
        )
        return self._rows_to_dicts(result, result.fetchall())

    def merge_duplicate_entities(self, user_id: str) -> dict[str, int]:
        """Merge duplicate entities for a user across mediums using fingerprints.

        Finds entities with the same fingerprint and consolidates them.

        Args:
            user_id: User ID to process

        Returns:
            Dictionary with merge statistics
        """
        from dere_shared.synthesis.fingerprinter import Fingerprinter

        fingerprinter = Fingerprinter()

        # Get all entities for user
        all_entities = self.get_entities_by_user(user_id, limit=1000)

        # Group by fingerprint
        fingerprint_groups: dict[str, list[dict]] = {}
        entities_without_fingerprint = []

        for entity in all_entities:
            fp = entity.get("fingerprint")
            if not fp:
                # Generate fingerprint if missing
                fp = fingerprinter.fingerprint_entity(entity["normalized_value"])
                entities_without_fingerprint.append((entity["id"], fp))

            if fp not in fingerprint_groups:
                fingerprint_groups[fp] = []
            fingerprint_groups[fp].append(entity)

        # Update fingerprints for entities that were missing them
        for entity_id, fp in entities_without_fingerprint:
            self._execute_and_commit(
                "UPDATE entities SET fingerprint = %s WHERE id = %s",
                [fp, entity_id],
            )

        # Merge duplicates (entities with same fingerprint but different IDs)
        merged_count = 0
        for fp, entities_list in fingerprint_groups.items():
            if len(entities_list) > 1:
                # Keep the first one (oldest), update references to others
                # For now, just mark duplicates in metadata
                # In a full implementation, we'd update all references
                merged_count += len(entities_list) - 1

        return {
            "total_entities": len(all_entities),
            "unique_fingerprints": len(fingerprint_groups),
            "merged_count": merged_count,
            "updated_fingerprints": len(entities_without_fingerprint),
        }

    def find_co_occurring_entities(
        self, entity_value: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Find entities that frequently appear with the given entity"""
        result = self.conn.execute(
            """
            SELECT e2.normalized_value, e2.entity_type,
                   COUNT(DISTINCT e2.conversation_id) as co_occurrence_count,
                   AVG(e2.confidence) as avg_confidence
            FROM entities e1
            JOIN entities e2 ON e1.conversation_id = e2.conversation_id
            WHERE e1.normalized_value = %s
              AND e2.normalized_value != %s
            GROUP BY e2.normalized_value, e2.entity_type
            ORDER BY co_occurrence_count DESC, avg_confidence DESC
            LIMIT %s
            """,
            [entity_value, entity_value, limit],
        )
        return self._rows_to_dicts(result, result.fetchall())

    def get_entity_timeline(self, entity_value: str) -> list[dict[str, Any]]:
        """Get chronological timeline of entity mentions across sessions"""
        result = self.conn.execute(
            """
            SELECT
                s.id as session_id,
                s.working_dir,
                s.start_time,
                COUNT(e.id) as mention_count,
                MAX(c.timestamp) as last_mentioned,
                ARRAY_AGG(DISTINCT e.entity_type) as context_types
            FROM entities e
            JOIN conversations c ON c.id = e.conversation_id
            JOIN sessions s ON s.id = e.session_id
            WHERE e.normalized_value = %s
            GROUP BY s.id, s.working_dir, s.start_time
            ORDER BY s.start_time DESC
            """,
            [entity_value],
        )
        return self._rows_to_dicts(result, result.fetchall())

    def get_entity_importance_scores(
        self, user_id: str | None = None, limit: int = 50, recency_days: int = 30
    ) -> list[dict[str, Any]]:
        """Calculate entity importance scores based on mention count, recency, and cross-medium presence.

        Args:
            user_id: Optional user ID to filter entities
            limit: Maximum number of entities to return
            recency_days: Number of days to consider for recency weighting

        Returns:
            List of entities with importance scores, sorted by score descending
        """
        import time

        cutoff_time = int(time.time()) - (recency_days * 86400)

        user_filter = "AND s.user_id = %s" if user_id else ""
        params = [cutoff_time]
        if user_id:
            params.append(user_id)
        params.append(limit)

        result = self.conn.execute(
            f"""
            WITH entity_stats AS (
                SELECT
                    e.normalized_value,
                    e.entity_type,
                    COUNT(DISTINCT e.conversation_id) as mention_count,
                    MAX(c.timestamp) as last_mentioned,
                    COUNT(DISTINCT s.working_dir) as medium_count,
                    AVG(e.confidence) as avg_confidence,
                    ARRAY_AGG(DISTINCT s.working_dir) as mediums
                FROM entities e
                JOIN conversations c ON c.id = e.conversation_id
                JOIN sessions s ON s.id = e.session_id
                WHERE c.timestamp >= %s
                {user_filter}
                GROUP BY e.normalized_value, e.entity_type
            )
            SELECT
                normalized_value,
                entity_type,
                mention_count,
                last_mentioned,
                medium_count,
                avg_confidence,
                mediums,
                (
                    (mention_count * 0.4) +
                    (medium_count * 20.0) +
                    (EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(last_mentioned))) / 86400.0 * -0.5) +
                    (avg_confidence * 10.0)
                ) as importance_score
            FROM entity_stats
            ORDER BY importance_score DESC
            LIMIT %s
            """,
            params,
        )
        return self._rows_to_dicts(result, result.fetchall())

    def search_with_entities_and_embeddings(
        self,
        entity_values: list[str],
        embedding: list[float],
        limit: int = 10,
        entity_weight: float = 0.6,
        recency_weight: float = 0.3,
    ) -> list[dict[str, Any]]:
        """Hybrid search combining entity matching, embedding similarity, and recency

        Args:
            entity_values: List of normalized entity values to match
            embedding: Query embedding vector
            limit: Maximum results to return
            entity_weight: Weight for entity matching score (0-1)
            recency_weight: Weight for recency score (0-1), remaining weight goes to semantic+entity

        Returns:
            List of conversations with scores and timestamps
        """
        import time

        embedding_json = json.dumps(embedding)
        semantic_weight = 1.0 - entity_weight
        current_time = int(time.time())

        result = self.conn.execute(
            """
            WITH entity_matches AS (
                SELECT c.id, COUNT(DISTINCT e.id)::float as entity_score
                FROM conversations c
                JOIN entities e ON e.conversation_id = c.id
                WHERE e.normalized_value = ANY(%s)
                GROUP BY c.id
            ),
            semantic_matches AS (
                SELECT c.id, (1 - (c.prompt_embedding <=> %s::vector)) as semantic_score
                FROM conversations c
                WHERE c.prompt_embedding IS NOT NULL
            )
            SELECT
                c.id, c.session_id, c.prompt, c.message_type, c.timestamp,
                s.working_dir,
                COALESCE(em.entity_score, 0) as entity_score,
                COALESCE(sm.semantic_score, 0) as semantic_score,
                EXP(-(%s - c.timestamp)::float / 604800.0) as recency_score,
                (
                    (COALESCE(em.entity_score, 0) / %s * %s +
                     COALESCE(sm.semantic_score, 0) * %s) * (1 - %s) +
                    EXP(-(%s - c.timestamp)::float / 604800.0) * %s
                ) as combined_score,
                ARRAY(
                    SELECT e.normalized_value
                    FROM entities e
                    WHERE e.conversation_id = c.id
                ) as matched_entities
            FROM conversations c
            JOIN sessions s ON s.id = c.session_id
            LEFT JOIN entity_matches em ON em.id = c.id
            LEFT JOIN semantic_matches sm ON sm.id = c.id
            WHERE COALESCE(em.entity_score, 0) > 0
               OR COALESCE(sm.semantic_score, 0) >= 0.65
            ORDER BY combined_score DESC
            LIMIT %s
            """,
            [
                entity_values,
                embedding_json,
                current_time,
                float(len(entity_values)),
                entity_weight,
                semantic_weight,
                recency_weight,
                current_time,
                recency_weight,
                limit,
            ],
        )
        return self._rows_to_dicts(result, result.fetchall())

    def search_user_session_context(
        self,
        user_session_id: int,
        entity_values: list[str],
        embedding: list[float],
        limit: int = 10,
        entity_weight: float = 0.6,
        recency_weight: float = 0.3,
    ) -> list[dict[str, Any]]:
        """Search conversations across all sessions in a user_session using hybrid search.

        Args:
            user_session_id: User session ID to search within
            entity_values: List of normalized entity values to match
            embedding: Query embedding vector
            limit: Maximum results to return
            entity_weight: Weight for entity matching score (0-1)
            recency_weight: Weight for recency score (0-1)

        Returns:
            List of conversations with scores, including session medium
        """
        import time

        embedding_json = json.dumps(embedding)
        semantic_weight = 1.0 - entity_weight
        current_time = int(time.time())

        result = self.conn.execute(
            """
            WITH entity_matches AS (
                SELECT c.id, COUNT(DISTINCT e.id)::float as entity_score
                FROM conversations c
                JOIN sessions s ON s.id = c.session_id
                JOIN entities e ON e.conversation_id = c.id
                WHERE s.user_session_id = %s
                  AND e.normalized_value = ANY(%s)
                GROUP BY c.id
            ),
            semantic_matches AS (
                SELECT c.id, (1 - (c.prompt_embedding <=> %s::vector)) as semantic_score
                FROM conversations c
                JOIN sessions s ON s.id = c.session_id
                WHERE s.user_session_id = %s
                  AND c.prompt_embedding IS NOT NULL
            )
            SELECT
                c.id, c.session_id, c.prompt, c.message_type, c.timestamp,
                s.working_dir, s.medium,
                COALESCE(em.entity_score, 0) as entity_score,
                COALESCE(sm.semantic_score, 0) as semantic_score,
                EXP(-(%s - c.timestamp)::float / 604800.0) as recency_score,
                (
                    (COALESCE(em.entity_score, 0) / %s * %s +
                     COALESCE(sm.semantic_score, 0) * %s) * (1 - %s) +
                    EXP(-(%s - c.timestamp)::float / 604800.0) * %s
                ) as combined_score,
                ARRAY(
                    SELECT e.normalized_value
                    FROM entities e
                    WHERE e.conversation_id = c.id
                ) as matched_entities
            FROM conversations c
            JOIN sessions s ON s.id = c.session_id
            LEFT JOIN entity_matches em ON em.id = c.id
            LEFT JOIN semantic_matches sm ON sm.id = c.id
            WHERE s.user_session_id = %s
              AND (COALESCE(em.entity_score, 0) > 0 OR COALESCE(sm.semantic_score, 0) >= 0.65)
            ORDER BY combined_score DESC
            LIMIT %s
            """,
            [
                user_session_id,
                entity_values,
                embedding_json,
                user_session_id,
                current_time,
                float(len(entity_values)),
                entity_weight,
                semantic_weight,
                recency_weight,
                current_time,
                recency_weight,
                user_session_id,
                limit,
            ],
        )
        return self._rows_to_dicts(result, result.fetchall())

    # Emotion system methods

    def store_emotion_state(
        self, session_id: int, active_emotions: dict, last_decay_time: int
    ) -> None:
        """Store current emotional state for a session"""

        # Get dominant emotions
        sorted_emotions = sorted(
            [(k, v) for k, v in active_emotions.items() if k != "neutral"],
            key=lambda x: x[1].intensity,
            reverse=True,
        )

        primary_emotion = sorted_emotions[0] if sorted_emotions else None
        secondary_emotion = sorted_emotions[1] if len(sorted_emotions) > 1 else None

        # Build appraisal data
        appraisal_data = {
            "active_emotions": {
                str(k): {"intensity": v.intensity, "last_updated": v.last_updated}
                for k, v in active_emotions.items()
                if k != "neutral"
            },
            "last_decay_time": last_decay_time,
        }

        if primary_emotion:
            self._execute_and_commit(
                """
                INSERT INTO emotion_states
                (session_id, primary_emotion, primary_intensity, secondary_emotion,
                 secondary_intensity, overall_intensity, appraisal_data, last_update)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                [
                    session_id,
                    str(primary_emotion[0]),
                    primary_emotion[1].intensity,
                    str(secondary_emotion[0]) if secondary_emotion else None,
                    secondary_emotion[1].intensity if secondary_emotion else None,
                    primary_emotion[1].intensity,
                    json.dumps(appraisal_data),
                ],
            )

    def load_emotion_state(self, session_id: int) -> dict | None:
        """Load most recent emotional state for a session"""
        from dere_shared.emotion.models import EmotionInstance, OCCEmotionType

        result = self._execute_and_commit(
            """
            SELECT appraisal_data, last_update
            FROM emotion_states
            WHERE session_id = %s
            ORDER BY last_update DESC
            LIMIT 1
            """,
            [session_id],
        )

        row = result.fetchone()
        if not row:
            return None

        # Handle both string JSON and dict (postgres may deserialize JSONB automatically)
        appraisal_data = (
            row[0] if isinstance(row[0], dict) else (json.loads(row[0]) if row[0] else {})
        )

        # Reconstruct active emotions
        active_emotions = {}
        for emotion_str, data in appraisal_data.get("active_emotions", {}).items():
            try:
                emotion_type = OCCEmotionType(emotion_str)
                active_emotions[emotion_type] = EmotionInstance(
                    type=emotion_type,
                    intensity=data["intensity"],
                    last_updated=data["last_updated"],
                )
            except Exception:
                continue

        return {
            "active_emotions": active_emotions,
            "last_decay_time": appraisal_data.get("last_decay_time", int(time.time() * 1000)),
        }

    def store_stimulus(self, session_id: int, stimulus_record) -> None:
        """Store a stimulus record in history"""

        self._execute_and_commit(
            """
            INSERT INTO stimulus_history
            (session_id, stimulus_type, valence, intensity, timestamp, context)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [
                session_id,
                stimulus_record.type,
                stimulus_record.valence,
                stimulus_record.intensity,
                stimulus_record.timestamp,
                json.dumps(stimulus_record.context),
            ],
        )

    # Presence management methods

    def register_presence(
        self, medium: str, user_id: str, available_channels: list[dict[str, Any]]
    ) -> None:
        """Register a medium as online with available channels.

        Args:
            medium: Medium identifier (e.g., 'discord', 'telegram')
            user_id: User identifier
            available_channels: List of channel dicts with structure specific to medium
        """
        self.conn.execute(
            """
            INSERT INTO medium_presence (medium, user_id, status, last_heartbeat, available_channels)
            VALUES (%s, %s, 'online', CURRENT_TIMESTAMP, %s)
            ON CONFLICT (medium, user_id)
            DO UPDATE SET
                status = 'online',
                last_heartbeat = CURRENT_TIMESTAMP,
                available_channels = EXCLUDED.available_channels
            """,
            [medium, user_id, json.dumps(available_channels)],
        )

    def heartbeat_presence(self, medium: str, user_id: str) -> None:
        """Update heartbeat for a medium to keep it alive.

        Args:
            medium: Medium identifier
            user_id: User identifier
        """
        self.conn.execute(
            """
            UPDATE medium_presence
            SET last_heartbeat = CURRENT_TIMESTAMP
            WHERE medium = %s AND user_id = %s
            """,
            [medium, user_id],
        )

    def unregister_presence(self, medium: str, user_id: str) -> None:
        """Mark a medium as offline.

        Args:
            medium: Medium identifier
            user_id: User identifier
        """
        self.conn.execute(
            """
            UPDATE medium_presence
            SET status = 'offline'
            WHERE medium = %s AND user_id = %s
            """,
            [medium, user_id],
        )

    def get_available_mediums(self, user_id: str) -> list[dict[str, Any]]:
        """Get all online mediums for a user.

        Args:
            user_id: User identifier

        Returns:
            List of dicts with medium, available_channels, last_heartbeat
        """
        result = self.conn.execute(
            """
            SELECT medium, available_channels, last_heartbeat
            FROM medium_presence
            WHERE user_id = %s AND status = 'online'
            ORDER BY last_heartbeat DESC
            """,
            [user_id],
        )
        rows = result.fetchall()
        mediums = []
        for row in rows:
            row_dict = self._row_to_dict(result, row)
            # Parse JSON channels
            if row_dict.get("available_channels"):
                try:
                    row_dict["available_channels"] = json.loads(row_dict["available_channels"])
                except json.JSONDecodeError:
                    row_dict["available_channels"] = []
            mediums.append(row_dict)
        return mediums

    def cleanup_stale_presence(self, stale_seconds: int = 60) -> int:
        """Mark presence as offline if no heartbeat received.

        Args:
            stale_seconds: Seconds without heartbeat to consider stale

        Returns:
            Number of records marked offline
        """
        result = self.conn.execute(
            """
            UPDATE medium_presence
            SET status = 'offline'
            WHERE status = 'online'
              AND last_heartbeat < CURRENT_TIMESTAMP - INTERVAL '%s seconds'
            """,
            [stale_seconds],
        )
        return result.rowcount

    # Notification queue methods

    def create_notification(
        self,
        user_id: str,
        target_medium: str,
        target_location: str,
        message: str,
        priority: str,
        routing_reasoning: str,
    ) -> int:
        """Create a pending notification in the queue.

        Args:
            user_id: User identifier
            target_medium: Medium to deliver to (discord, telegram, etc)
            target_location: Channel/DM ID within medium
            message: Message content
            priority: Message priority ('alert' or 'conversation')
            routing_reasoning: LLM explanation for routing decision

        Returns:
            Notification ID
        """
        result = self.conn.execute(
            """
            INSERT INTO ambient_notifications
                (user_id, target_medium, target_location, message, priority, routing_reasoning, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'pending')
            RETURNING id
            """,
            [user_id, target_medium, target_location, message, priority, routing_reasoning],
        )
        row = result.fetchone()
        return row[0] if row else -1

    def get_pending_notifications(self, medium: str) -> list[dict[str, Any]]:
        """Get pending notifications for a specific medium.

        Args:
            medium: Medium identifier (e.g., 'discord')

        Returns:
            List of pending notification dicts
        """
        result = self.conn.execute(
            """
            SELECT id, user_id, target_location, message, priority, routing_reasoning, created_at
            FROM ambient_notifications
            WHERE target_medium = %s AND status = 'pending'
            ORDER BY created_at ASC
            """,
            [medium],
        )
        return self._rows_to_dicts(result, result.fetchall())

    def mark_notification_delivered(self, notification_id: int) -> None:
        """Mark notification as successfully delivered.

        Args:
            notification_id: Notification ID
        """
        self.conn.execute(
            """
            UPDATE ambient_notifications
            SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            [notification_id],
        )

    def mark_notification_failed(self, notification_id: int, error_message: str) -> None:
        """Mark notification as failed with error.

        Args:
            notification_id: Notification ID
            error_message: Error description
        """
        self.conn.execute(
            """
            UPDATE ambient_notifications
            SET status = 'failed', error_message = %s, delivered_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            [error_message, notification_id],
        )

    def close(self) -> None:
        """Close database connection"""
        self.conn.close()
