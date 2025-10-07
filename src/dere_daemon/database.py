from __future__ import annotations

import json
import os
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
    def __init__(self, db_url: str):
        self.db_url = db_url
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: Add claude_session_id column if it doesn't exist
        try:
            self.conn.execute("""
                ALTER TABLE sessions ADD COLUMN claude_session_id TEXT
            """)
        except Exception:
            pass

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
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id BIGSERIAL PRIMARY KEY,
                session_id BIGINT REFERENCES sessions(id),
                prompt TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'user',
                embedding_text TEXT,
                processing_mode TEXT,
                prompt_embedding VECTOR(1024),
                timestamp BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

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
                confidence FLOAT NOT NULL,
                context_start INTEGER,
                context_end INTEGER,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

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
            "CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations(session_id)",
            "CREATE INDEX IF NOT EXISTS conversations_timestamp_idx ON conversations(timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS task_queue_pending_model_idx ON task_queue(status, model_name) WHERE status = 'pending'",
            "CREATE INDEX IF NOT EXISTS task_queue_claim_idx ON task_queue(status, model_name, priority, created_at) WHERE status = 'pending'",
            "CREATE INDEX IF NOT EXISTS task_queue_id_status_idx ON task_queue(id, status)",
            "CREATE INDEX IF NOT EXISTS task_queue_session_idx ON task_queue(session_id) WHERE session_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS task_queue_created_idx ON task_queue(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS entities_session_idx ON entities(session_id)",
            "CREATE INDEX IF NOT EXISTS entities_type_idx ON entities(entity_type)",
            "CREATE INDEX IF NOT EXISTS entities_normalized_idx ON entities(normalized_value)",
        ]

        for idx in indexes:
            self.conn.execute(idx)

    def create_session(self, session: Session) -> int:
        """Create a new session and return its ID"""
        result = self._execute_and_commit(
            """
            INSERT INTO sessions (working_dir, start_time, end_time, continued_from, project_type, claude_session_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            [
                session.working_dir,
                session.start_time,
                session.end_time,
                session.continued_from,
                session.project_type,
                session.claude_session_id,
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
                (session_id, prompt, message_type, embedding_text, processing_mode, prompt_embedding, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s::vector, %s)
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
                ],
            )
        else:
            result = self._execute_and_commit(
                """
                INSERT INTO conversations
                (session_id, prompt, message_type, embedding_text, processing_mode, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                [
                    conv.session_id,
                    conv.prompt,
                    conv.message_type.value,
                    conv.embedding_text,
                    conv.processing_mode,
                    conv.timestamp,
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

        return [dict(row) for row in result.fetchall()]

    def queue_task(self, task: TaskQueue) -> int:
        """Add a task to the background processing queue"""
        metadata_json = json.dumps(task.metadata) if task.metadata else None

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
        self._execute_and_commit("UPDATE sessions SET end_time = %s WHERE id = %s", [end_time, session_id])

    def get_session_personality(self, session_id: int) -> str | None:
        """Get personality for a session"""
        result = self.conn.execute(
            "SELECT personality_name FROM session_personalities WHERE session_id = %s LIMIT 1",
            [session_id],
        )
        row = result.fetchone()
        if row:
            return self._row_to_dict(result, row)["personality_name"]
        return None

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

    def get_previous_mode_session(self, mode: str, working_dir: str) -> dict[str, Any] | None:
        """Find the most recent completed session for a given mode"""
        # Python 3.13 multi-line f-string
        query = f"""
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
        """Store extracted entity"""
        self._execute_and_commit(
            """
            INSERT INTO entities
            (session_id, conversation_id, entity_type, entity_value, normalized_value, confidence)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [session_id, conversation_id, entity_type, entity_value, normalized_value, confidence],
        )

    def close(self) -> None:
        """Close database connection"""
        self.conn.close()
