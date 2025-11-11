from __future__ import annotations

import json
from typing import Any

import asyncpg
from loguru import logger

from dere_graph.models import EntityNode


class PostgresDriver:
    """Postgres driver for entity meta-context storage."""

    def __init__(self, db_url: str, embedding_dim: int = 1536):
        """Initialize Postgres driver.

        Args:
            db_url: PostgreSQL connection URL
            embedding_dim: Embedding vector dimension
        """
        self.db_url = db_url
        self.embedding_dim = embedding_dim
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        """Create connection pool."""
        self.pool = await asyncpg.create_pool(self.db_url)
        logger.info("PostgresDriver connected")

    async def close(self) -> None:
        """Close connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("PostgresDriver closed")

    async def init_schema(self) -> None:
        """Create graph_entity_attributes table and indexes."""
        if not self.pool:
            raise RuntimeError("PostgresDriver not connected")

        async with self.pool.acquire() as conn:
            # Create table
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS graph_entity_attributes (
                    entity_uuid UUID PRIMARY KEY,
                    entity_type TEXT,
                    name TEXT NOT NULL,
                    attributes JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    name_embedding VECTOR({self.embedding_dim}),
                    group_id TEXT NOT NULL,
                    user_notes TEXT,
                    description TEXT,
                    bot_thoughts TEXT,
                    importance_score TEXT CHECK (importance_score IN ('low', 'medium', 'high')) DEFAULT 'low',
                    last_discussed_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Create indexes
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_graph_entity_group_id
                ON graph_entity_attributes(group_id)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_graph_entity_type
                ON graph_entity_attributes(entity_type)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_graph_entity_attributes_jsonb
                ON graph_entity_attributes USING gin(attributes)
            """)

            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_graph_entity_name_text
                ON graph_entity_attributes USING gin(to_tsvector('english', name))
            """)

            # Vector index for similarity search
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_graph_entity_embedding
                ON graph_entity_attributes
                USING ivfflat (name_embedding vector_cosine_ops)
                WITH (lists = 100)
            """)

            logger.info("graph_entity_attributes schema initialized")

    async def save_entity_attributes(
        self,
        entity: EntityNode,
        last_discussed_at: Any = None,
    ) -> None:
        """Save or update entity attributes.

        Args:
            entity: EntityNode with attributes to save
            last_discussed_at: When entity was last discussed (datetime)
        """
        if not self.pool:
            raise RuntimeError("PostgresDriver not connected")

        # Extract entity_type from labels (exclude "Entity")
        entity_types = [label for label in entity.labels if label != "Entity"]
        entity_type = "/".join(entity_types) if entity_types else None

        # Convert embedding to list for JSON serialization
        embedding_json = json.dumps(entity.name_embedding) if entity.name_embedding else None

        async with self.pool.acquire() as conn:
            if embedding_json:
                await conn.execute(
                    """
                    INSERT INTO graph_entity_attributes
                    (entity_uuid, entity_type, name, attributes, name_embedding, group_id, last_discussed_at, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5::vector, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (entity_uuid) DO UPDATE SET
                        entity_type = EXCLUDED.entity_type,
                        name = EXCLUDED.name,
                        attributes = EXCLUDED.attributes,
                        name_embedding = EXCLUDED.name_embedding,
                        group_id = EXCLUDED.group_id,
                        last_discussed_at = COALESCE(EXCLUDED.last_discussed_at, graph_entity_attributes.last_discussed_at),
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    entity.uuid,
                    entity_type,
                    entity.name,
                    json.dumps(entity.attributes),
                    embedding_json,
                    entity.group_id,
                    last_discussed_at,
                )
            else:
                await conn.execute(
                    """
                    INSERT INTO graph_entity_attributes
                    (entity_uuid, entity_type, name, attributes, group_id, last_discussed_at, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (entity_uuid) DO UPDATE SET
                        entity_type = EXCLUDED.entity_type,
                        name = EXCLUDED.name,
                        attributes = EXCLUDED.attributes,
                        group_id = EXCLUDED.group_id,
                        last_discussed_at = COALESCE(EXCLUDED.last_discussed_at, graph_entity_attributes.last_discussed_at),
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    entity.uuid,
                    entity_type,
                    entity.name,
                    json.dumps(entity.attributes),
                    entity.group_id,
                    last_discussed_at,
                )

            logger.debug(f"Saved entity attributes: {entity.uuid}")

    async def get_entity_attributes(self, entity_uuid: str) -> dict[str, Any] | None:
        """Get entity meta-context by UUID.

        Args:
            entity_uuid: Entity UUID

        Returns:
            Dict with entity meta-context or None if not found
        """
        if not self.pool:
            raise RuntimeError("PostgresDriver not connected")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT entity_uuid, entity_type, name, attributes,
                       user_notes, description, bot_thoughts, importance_score,
                       last_discussed_at, created_at, updated_at
                FROM graph_entity_attributes
                WHERE entity_uuid = $1
                """,
                entity_uuid,
            )

            if row:
                return dict(row)
            return None

    async def search_entities_by_embedding(
        self,
        embedding: list[float],
        limit: int = 10,
        group_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search entities by embedding similarity.

        Args:
            embedding: Query embedding vector
            limit: Maximum results
            group_id: Optional group filter

        Returns:
            List of entity attribute dicts with similarity scores
        """
        if not self.pool:
            raise RuntimeError("PostgresDriver not connected")

        embedding_json = json.dumps(embedding)

        async with self.pool.acquire() as conn:
            if group_id:
                rows = await conn.fetch(
                    """
                    SELECT entity_uuid, entity_type, name, attributes,
                           user_notes, description, bot_thoughts, importance_score,
                           last_discussed_at,
                           1 - (name_embedding <=> $1::vector) as similarity
                    FROM graph_entity_attributes
                    WHERE group_id = $2 AND name_embedding IS NOT NULL
                    ORDER BY name_embedding <=> $1::vector
                    LIMIT $3
                    """,
                    embedding_json,
                    group_id,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT entity_uuid, entity_type, name, attributes,
                           user_notes, description, bot_thoughts, importance_score,
                           last_discussed_at,
                           1 - (name_embedding <=> $1::vector) as similarity
                    FROM graph_entity_attributes
                    WHERE name_embedding IS NOT NULL
                    ORDER BY name_embedding <=> $1::vector
                    LIMIT $2
                    """,
                    embedding_json,
                    limit,
                )

            return [dict(row) for row in rows]
