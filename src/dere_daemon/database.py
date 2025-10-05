from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import libsql_client

from dere_shared.models import (
    Conversation,
    ConversationSegment,
    ContextCache,
    Entity,
    EntityRelationship,
    Session,
    SessionFlag,
    SessionMCP,
    SessionPersonality,
    SessionRelationship,
    SessionSummary,
    TaskQueue,
    WellnessSession,
)


class Database:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self.client = libsql_client.create_client_sync(f"file:{self.db_path}")
        self._init_schema()

    def _init_schema(self) -> None:
        """Initialize database schema with all tables and indexes"""

        # Sessions table
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                working_dir TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                continued_from INTEGER REFERENCES sessions(id),
                project_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Session personalities
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS session_personalities (
                session_id INTEGER REFERENCES sessions(id),
                personality_name TEXT NOT NULL,
                PRIMARY KEY (session_id, personality_name)
            )
        """)

        # Session MCPs
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS session_mcps (
                session_id INTEGER REFERENCES sessions(id),
                mcp_name TEXT NOT NULL,
                PRIMARY KEY (session_id, mcp_name)
            )
        """)

        # Session flags
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS session_flags (
                session_id INTEGER REFERENCES sessions(id),
                flag_name TEXT NOT NULL,
                flag_value TEXT,
                PRIMARY KEY (session_id, flag_name)
            )
        """)

        # Conversations with vector embeddings
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER REFERENCES sessions(id),
                prompt TEXT NOT NULL,
                message_type TEXT NOT NULL DEFAULT 'user',
                embedding_text TEXT,
                processing_mode TEXT,
                prompt_embedding FLOAT32(1024),
                timestamp INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Task queue
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS task_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type TEXT NOT NULL,
                model_name TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                priority INTEGER DEFAULT 5,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
                session_id INTEGER REFERENCES sessions(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP,
                retry_count INTEGER DEFAULT 0,
                error_message TEXT
            )
        """)

        # Entities
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER REFERENCES sessions(id),
                conversation_id INTEGER REFERENCES conversations(id),
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
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS entity_relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_1_id INTEGER REFERENCES entities(id),
                entity_2_id INTEGER REFERENCES entities(id),
                relationship_type TEXT NOT NULL,
                confidence FLOAT NOT NULL,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Session summaries
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS session_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER REFERENCES sessions(id),
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
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS conversation_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER REFERENCES sessions(id),
                segment_number INTEGER NOT NULL,
                segment_summary TEXT NOT NULL,
                original_length INTEGER NOT NULL,
                summary_length INTEGER NOT NULL,
                start_conversation_id INTEGER REFERENCES conversations(id),
                end_conversation_id INTEGER REFERENCES conversations(id),
                model_used TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(session_id, segment_number)
            )
        """)

        # Context cache
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS context_cache (
                session_id INTEGER PRIMARY KEY REFERENCES sessions(id),
                context_text TEXT NOT NULL,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Session relationships
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS session_relationships (
                session_id INTEGER REFERENCES sessions(id),
                related_session_id INTEGER REFERENCES sessions(id),
                relationship_type TEXT NOT NULL,
                strength REAL DEFAULT 1.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (session_id, related_session_id)
            )
        """)

        # Wellness sessions
        self.client.execute("""
            CREATE TABLE IF NOT EXISTS wellness_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                mode TEXT NOT NULL,
                mood INTEGER,
                energy INTEGER,
                stress INTEGER,
                key_themes TEXT,
                notes TEXT,
                homework TEXT,
                next_step_notes TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        """)

        # Create indexes
        self._create_indexes()

        # Create vector index for embeddings
        self.client.execute("""
            CREATE INDEX IF NOT EXISTS conversations_embedding_idx
            ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'))
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
            self.client.execute(idx)

    def create_session(self, session: Session) -> int:
        """Create a new session and return its ID"""
        result = self.client.execute(
            """
            INSERT INTO sessions (working_dir, start_time, end_time, continued_from, project_type)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                session.working_dir,
                session.start_time,
                session.end_time,
                session.continued_from,
                session.project_type,
            ],
        )
        return result.last_insert_rowid

    def store_conversation(self, conv: Conversation) -> int:
        """Store a conversation message"""
        # Convert embedding list to JSON if present
        embedding_json = json.dumps(conv.prompt_embedding) if conv.prompt_embedding else None

        result = self.client.execute(
            """
            INSERT INTO conversations
            (session_id, prompt, message_type, embedding_text, processing_mode, prompt_embedding, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
        return result.last_insert_rowid

    def search_similar(
        self, embedding: list[float], limit: int = 10, threshold: float = 0.7
    ) -> list[dict[str, Any]]:
        """Search for similar conversations using vector similarity"""
        embedding_json = json.dumps(embedding)

        result = self.client.execute(
            """
            SELECT id, session_id, prompt, message_type, timestamp,
                   vector_distance_cos(prompt_embedding, ?) as distance
            FROM conversations
            WHERE prompt_embedding IS NOT NULL
              AND vector_distance_cos(prompt_embedding, ?) < ?
            ORDER BY distance
            LIMIT ?
            """,
            [embedding_json, embedding_json, 1.0 - threshold, limit],
        )

        return [dict(row) for row in result.rows]

    def queue_task(self, task: TaskQueue) -> int:
        """Add a task to the background processing queue"""
        metadata_json = json.dumps(task.metadata) if task.metadata else None

        result = self.client.execute(
            """
            INSERT INTO task_queue
            (task_type, model_name, content, metadata, priority, status, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
        return result.last_insert_rowid

    def close(self) -> None:
        """Close database connection"""
        self.client.close()
