from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from falkordb.asyncio import FalkorDB
from loguru import logger

from dere_graph.models import (
    EntityEdge,
    EntityNode,
    CommunityNode,
    EpisodicEdge,
    EpisodicNode,
    FactNode,
    FactRoleEdge,
    FactRoleDetail,
)


def convert_datetimes_to_strings(obj):
    """Convert datetime objects to ISO strings for database storage."""
    if isinstance(obj, dict):
        return {k: convert_datetimes_to_strings(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_datetimes_to_strings(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_datetimes_to_strings(item) for item in obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    else:
        return obj


def _parse_iso_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return datetime.fromisoformat(text)
    return None


class FalkorDriver:
    def __init__(
        self,
        host: str = "localhost",
        port: int = 6379,
        username: str | None = None,
        password: str | None = None,
        database: str = "dere_graph",
    ):
        self.client = FalkorDB(host=host, port=port, username=username, password=password)
        self.database = database

    async def execute_query(self, cypher_query: str, **kwargs: Any):
        graph = self.client.select_graph(self.database)

        # Convert datetime objects to ISO strings
        params = convert_datetimes_to_strings(dict(kwargs))

        try:
            result = await graph.query(cypher_query, params)
        except Exception as e:
            if "already indexed" in str(e):
                logger.info(f"Index already exists: {e}")
                return []

            # Filter out embedding vectors from logs
            log_params = {
                k: v if k != "search_vector" else f"<vector dim={len(v)}>"
                for k, v in params.items()
            }
            logger.error(f"Error executing FalkorDB query: {e}\n{cypher_query}\n{log_params}")
            raise

        # Convert result to list of dicts
        header = [h[1] for h in result.header]
        records = []
        for row in result.result_set:
            record = {}
            for i, field_name in enumerate(header):
                if i < len(row):
                    record[field_name] = row[i]
                else:
                    record[field_name] = None
            records.append(record)

        return records

    async def build_indices_and_constraints(self, delete_existing: bool = False) -> None:
        """Build database indices and constraints."""
        logger.info("Building FalkorDB indices...")

        # FalkorDB doesn't require vector indices - it uses vec.cosineDistance() directly
        # Only create fulltext indices

        # Fulltext index for entity names and summaries
        await self.execute_query(
            """
            CALL db.idx.fulltext.createNodeIndex(
                {label: 'Entity'},
                'name', 'summary', 'group_id'
            )
            """
        )

        # Fulltext index for episodic nodes
        await self.execute_query(
            """
            CALL db.idx.fulltext.createNodeIndex(
                {label: 'Episodic'},
                'content', 'source_description', 'group_id'
            )
            """
        )

        # Fulltext index for community names and summaries
        await self.execute_query(
            """
            CREATE FULLTEXT INDEX FOR (c:Community) ON (c.name, c.summary, c.group_id)
            """
        )

        # Fulltext index for edges
        await self.execute_query(
            """
            CREATE FULLTEXT INDEX FOR ()-[e:RELATES_TO]-() ON (e.name, e.fact, e.group_id)
            """
        )

        # Fulltext index for fact nodes
        await self.execute_query(
            """
            CREATE FULLTEXT INDEX FOR (f:Fact) ON (f.name, f.fact, f.group_id)
            """
        )

        logger.info("FalkorDB indices built")

    async def save_entity_node(self, node: EntityNode) -> None:
        # Sanitize labels: replace spaces with underscores, remove invalid chars
        sanitized_labels = [
            label.replace(" ", "_").replace("-", "_").replace("/", "_") for label in node.labels
        ]
        labels = ":".join(sanitized_labels + ["Entity"])
        entity_data = {
            "uuid": node.uuid,
            "name": node.name,
            "group_id": node.group_id,
            "summary": node.summary,
            "created_at": node.created_at,
            "expired_at": node.expired_at,
            "name_embedding": node.name_embedding,
            "aliases": node.aliases,
            "last_mentioned": node.last_mentioned,
            "mention_count": node.mention_count,
            "retrieval_count": node.retrieval_count,
            "citation_count": node.citation_count,
            "retrieval_quality": node.retrieval_quality,
            **node.attributes,
        }

        await self.execute_query(
            f"""
            MERGE (n:{labels} {{uuid: $entity_data.uuid}})
            SET n = $entity_data
            SET n.name_embedding = vecf32($entity_data.name_embedding)
            """,
            entity_data=entity_data,
        )
        logger.debug(f"Saved EntityNode: {node.uuid}")

    async def save_fact_node(self, node: FactNode) -> None:
        fact_data = {
            "uuid": node.uuid,
            "name": node.name,
            "fact": node.fact,
            "group_id": node.group_id,
            "created_at": node.created_at,
            "expired_at": node.expired_at,
            "fact_embedding": node.fact_embedding,
            "episodes": node.episodes,
            "valid_at": node.valid_at,
            "invalid_at": node.invalid_at,
            **node.attributes,
        }

        await self.execute_query(
            """
            MERGE (f:Fact {uuid: $fact_data.uuid})
            SET f = $fact_data
            SET f.fact_embedding = vecf32($fact_data.fact_embedding)
            """,
            fact_data=fact_data,
        )
        logger.debug(f"Saved FactNode: {node.uuid}")

    async def save_fact_role_edge(self, edge: FactRoleEdge) -> None:
        await self.execute_query(
            """
            MATCH (fact:Fact {uuid: $fact_uuid})
            MATCH (entity:Entity {uuid: $entity_uuid})
            MERGE (fact)-[r:HAS_ROLE {role: $role, entity_uuid: $entity_uuid}]->(entity)
            SET r.group_id = $group_id,
                r.role_description = $role_description,
                r.created_at = $created_at
            """,
            fact_uuid=edge.source_node_uuid,
            entity_uuid=edge.target_node_uuid,
            role=edge.role,
            group_id=edge.group_id,
            role_description=edge.role_description,
            created_at=edge.created_at,
        )
        logger.debug(
            "Saved FactRoleEdge: fact={} entity={} role={}",
            edge.source_node_uuid,
            edge.target_node_uuid,
            edge.role,
        )

    async def save_community_node(self, node: CommunityNode) -> None:
        await self.execute_query(
            """
            MERGE (c:Community {uuid: $uuid})
            SET c.name = $name,
                c.group_id = $group_id,
                c.summary = $summary,
                c.name_embedding = $name_embedding,
                c.created_at = $created_at,
                c.expired_at = $expired_at
            """,
            uuid=node.uuid,
            name=node.name,
            group_id=node.group_id,
            summary=node.summary,
            name_embedding=node.name_embedding,
            created_at=node.created_at,
            expired_at=node.expired_at,
        )
        logger.debug(f"Saved CommunityNode: {node.uuid}")

    async def save_community_members(
        self,
        community_uuid: str,
        member_uuids: list[str],
        group_id: str,
    ) -> None:
        if not member_uuids:
            return

        await self.execute_query(
            """
            MATCH (c:Community {uuid: $community_uuid})
            UNWIND $member_uuids AS member_uuid
            MATCH (e:Entity {uuid: member_uuid})
            MERGE (c)-[r:HAS_MEMBER]->(e)
            SET r.group_id = $group_id
            """,
            community_uuid=community_uuid,
            member_uuids=member_uuids,
            group_id=group_id,
        )

    async def delete_communities_by_group(self, group_id: str) -> None:
        await self.execute_query(
            """
            MATCH (c:Community {group_id: $group_id})
            DETACH DELETE c
            """,
            group_id=group_id,
        )

    async def save_episodic_node(self, node: EpisodicNode) -> None:
        await self.execute_query(
            """
            MERGE (e:Episodic {uuid: $uuid})
            SET e.name = $name,
                e.content = $content,
                e.source_description = $source_description,
                e.source = $source,
                e.group_id = $group_id,
                e.valid_at = $valid_at,
                e.conversation_id = $conversation_id,
                e.entity_edges = $entity_edges,
                e.fact_nodes = $fact_nodes,
                e.speaker_id = $speaker_id,
                e.speaker_name = $speaker_name,
                e.personality = $personality,
                e.created_at = $created_at
            """,
            uuid=node.uuid,
            name=node.name,
            content=node.content,
            source_description=node.source_description,
            source=node.source.value,
            group_id=node.group_id,
            valid_at=node.valid_at,
            conversation_id=node.conversation_id,
            entity_edges=node.entity_edges,
            fact_nodes=node.fact_nodes,
            speaker_id=node.speaker_id,
            speaker_name=node.speaker_name,
            personality=node.personality,
            created_at=node.created_at,
        )
        logger.debug(f"Saved EpisodicNode: {node.uuid}")

    async def get_recent_episodes(self, group_id: str, limit: int = 10) -> list[EpisodicNode]:
        """Get recent episodes for context in entity deduplication."""
        from dere_graph.models import EpisodeType

        records = await self.execute_query(
            """
            MATCH (e:Episodic {group_id: $group_id})
            RETURN e.uuid AS uuid,
                   e.name AS name,
                   e.content AS content,
                   e.source_description AS source_description,
                   e.source AS source,
                   e.group_id AS group_id,
	                   e.valid_at AS valid_at,
	                   e.conversation_id AS conversation_id,
	                   e.entity_edges AS entity_edges,
	                   e.fact_nodes AS fact_nodes,
	                   e.speaker_id AS speaker_id,
	                   e.speaker_name AS speaker_name,
	                   e.personality AS personality,
	                   e.created_at AS created_at
            ORDER BY e.created_at DESC
            LIMIT $limit
            """,
            group_id=group_id,
            limit=limit,
        )

        episodes = []
        for record in records:
            episode = EpisodicNode(
                uuid=record["uuid"],
                name=record["name"],
                content=record["content"],
                source_description=record["source_description"],
                source=EpisodeType(record["source"]),
	                group_id=record["group_id"],
	                conversation_id=record.get("conversation_id", "default"),
	                entity_edges=record.get("entity_edges") or [],
	                fact_nodes=record.get("fact_nodes") or [],
	                speaker_id=record.get("speaker_id"),
	                speaker_name=record.get("speaker_name"),
	                personality=record.get("personality"),
	                valid_at=_parse_iso_datetime(record["valid_at"]) or datetime.now(UTC),
	                created_at=_parse_iso_datetime(record["created_at"]) or datetime.now(UTC),
            )
            episodes.append(episode)

        return episodes

    async def get_recent_episode_entity_uuids(
        self,
        group_id: str,
        limit_episodes: int = 5,
        limit_entities: int = 10,
        conversation_id: str | None = None,
    ) -> list[str]:
        """Get entity UUIDs mentioned in recent episodes."""
        if limit_episodes <= 0 or limit_entities <= 0:
            return []

        where_parts = ["e.group_id = $group_id"]
        params: dict[str, Any] = {
            "group_id": group_id,
            "limit_episodes": limit_episodes,
            "limit_entities": limit_entities,
        }
        if conversation_id:
            where_parts.append("e.conversation_id = $conversation_id")
            params["conversation_id"] = conversation_id

        where_clause = "WHERE " + " AND ".join(where_parts)

        records = await self.execute_query(
            f"""
            MATCH (e:Episodic)
            {where_clause}
            WITH e
            ORDER BY e.created_at DESC
            LIMIT $limit_episodes
            MATCH (e)-[:MENTIONS]->(entity:Entity)
            WHERE entity.group_id = $group_id
            WITH entity, max(e.created_at) AS last_seen
            ORDER BY last_seen DESC
            RETURN entity.uuid AS uuid
            LIMIT $limit_entities
            """,
            **params,
        )

        return [record["uuid"] for record in records if record.get("uuid")]

    async def get_episodes_by_conversation_id(
        self, conversation_id: str, group_id: str
    ) -> list[EpisodicNode]:
        """Get episodes by conversation_id for reusing daily episodes."""
        from dere_graph.models import EpisodeType

        records = await self.execute_query(
            """
            MATCH (e:Episodic {conversation_id: $conversation_id, group_id: $group_id})
            RETURN e.uuid AS uuid,
                   e.name AS name,
                   e.content AS content,
                   e.source_description AS source_description,
                   e.source AS source,
                   e.group_id AS group_id,
	                   e.valid_at AS valid_at,
	                   e.conversation_id AS conversation_id,
	                   e.entity_edges AS entity_edges,
	                   e.fact_nodes AS fact_nodes,
	                   e.speaker_id AS speaker_id,
	                   e.speaker_name AS speaker_name,
	                   e.personality AS personality,
	                   e.created_at AS created_at
            ORDER BY e.created_at DESC
            LIMIT 1
            """,
            conversation_id=conversation_id,
            group_id=group_id,
        )

        episodes = []
        for record in records:
            episode = EpisodicNode(
                uuid=record["uuid"],
                name=record["name"],
                content=record["content"],
                source_description=record["source_description"],
                source=EpisodeType(record["source"]),
	                group_id=record["group_id"],
	                conversation_id=record.get("conversation_id", "default"),
	                entity_edges=record.get("entity_edges") or [],
	                fact_nodes=record.get("fact_nodes") or [],
	                speaker_id=record.get("speaker_id"),
	                speaker_name=record.get("speaker_name"),
	                personality=record.get("personality"),
	                valid_at=_parse_iso_datetime(record["valid_at"]) or datetime.now(UTC),
	                created_at=_parse_iso_datetime(record["created_at"]) or datetime.now(UTC),
            )
            episodes.append(episode)

        return episodes

    async def get_episodes_for_entities(
        self, entity_uuids: list[str], group_id: str, limit: int = 10
    ) -> list[EpisodicNode]:
        """Get episodes that mention specific entities via MENTIONS edges."""
        from dere_graph.models import EpisodeType

        if not entity_uuids:
            return []

        records = await self.execute_query(
            """
            MATCH (episode:Episodic)-[:MENTIONS]->(entity:Entity)
            WHERE entity.uuid IN $entity_uuids
              AND episode.group_id = $group_id
            RETURN DISTINCT episode.uuid AS uuid,
                   episode.name AS name,
                   episode.content AS content,
                   episode.source_description AS source_description,
                   episode.source AS source,
                   episode.group_id AS group_id,
	                   episode.valid_at AS valid_at,
	                   episode.conversation_id AS conversation_id,
	                   episode.entity_edges AS entity_edges,
	                   episode.fact_nodes AS fact_nodes,
	                   episode.created_at AS created_at
            ORDER BY episode.created_at DESC
            LIMIT $limit
            """,
            entity_uuids=entity_uuids,
            group_id=group_id,
            limit=limit,
        )

        episodes = []
        for record in records:
            episode = EpisodicNode(
                uuid=record["uuid"],
                name=record["name"],
                content=record["content"],
                source_description=record["source_description"],
                source=EpisodeType(record["source"]),
	                group_id=record["group_id"],
	                conversation_id=record.get("conversation_id", "default"),
	                entity_edges=record.get("entity_edges") or [],
	                fact_nodes=record.get("fact_nodes") or [],
	                valid_at=_parse_iso_datetime(record["valid_at"]) or datetime.now(UTC),
	                created_at=_parse_iso_datetime(record["created_at"]) or datetime.now(UTC),
            )
            episodes.append(episode)

        return episodes

    async def get_episodes_by_uuids(
        self, episode_uuids: list[str], group_id: str
    ) -> list[EpisodicNode]:
        """Fetch episodic nodes by UUID."""
        from dere_graph.models import EpisodeType

        if not episode_uuids:
            return []

        records = await self.execute_query(
            """
            MATCH (e:Episodic)
            WHERE e.uuid IN $episode_uuids
              AND e.group_id = $group_id
            RETURN e.uuid AS uuid,
                   e.name AS name,
                   e.content AS content,
                   e.source_description AS source_description,
                   e.source AS source,
                   e.group_id AS group_id,
                   e.valid_at AS valid_at,
                   e.conversation_id AS conversation_id,
                   e.entity_edges AS entity_edges,
                   e.fact_nodes AS fact_nodes,
                   e.speaker_id AS speaker_id,
                   e.speaker_name AS speaker_name,
                   e.personality AS personality,
                   e.created_at AS created_at
            """,
            episode_uuids=episode_uuids,
            group_id=group_id,
        )

        episodes = []
        for record in records:
            episode = EpisodicNode(
                uuid=record["uuid"],
                name=record["name"],
                content=record["content"],
                source_description=record["source_description"],
                source=EpisodeType(record["source"]),
                group_id=record["group_id"],
                conversation_id=record.get("conversation_id", "default"),
                entity_edges=record.get("entity_edges") or [],
                fact_nodes=record.get("fact_nodes") or [],
                speaker_id=record.get("speaker_id"),
                speaker_name=record.get("speaker_name"),
                personality=record.get("personality"),
                valid_at=_parse_iso_datetime(record["valid_at"]) or datetime.now(UTC),
                created_at=_parse_iso_datetime(record["created_at"]) or datetime.now(UTC),
            )
            episodes.append(episode)

        return episodes

    async def get_entity_by_uuid(self, uuid: str) -> EntityNode | None:
        records = await self.execute_query(
            """
            MATCH (n:Entity {uuid: $uuid})
            RETURN n.uuid AS uuid,
                   n.name AS name,
                   n.group_id AS group_id,
                   n.name_embedding AS name_embedding,
                   n.summary AS summary,
                   n.created_at AS created_at,
                   n.expired_at AS expired_at,
                   n.aliases AS aliases,
                   n.last_mentioned AS last_mentioned,
                   n.mention_count AS mention_count,
                   n.retrieval_count AS retrieval_count,
                   n.citation_count AS citation_count,
                   n.retrieval_quality AS retrieval_quality,
                   n AS attributes,
                   labels(n) AS labels
            """,
            uuid=uuid,
        )

        if not records:
            return None

        record = records[0]
        node_obj = record["attributes"]
        attributes = dict(node_obj.properties)
        for key in [
            "uuid",
            "name",
            "group_id",
            "name_embedding",
            "summary",
            "created_at",
            "expired_at",
            "aliases",
            "last_mentioned",
            "mention_count",
            "retrieval_count",
            "citation_count",
            "retrieval_quality",
        ]:
            attributes.pop(key, None)

        return EntityNode(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            name_embedding=record["name_embedding"],
            summary=record["summary"] or "",
            created_at=_parse_iso_datetime(record["created_at"]) or datetime.now(UTC),
            expired_at=_parse_iso_datetime(record.get("expired_at")),
            aliases=record.get("aliases") or [],
            last_mentioned=_parse_iso_datetime(record.get("last_mentioned")),
            mention_count=record.get("mention_count") or 1,
            retrieval_count=record.get("retrieval_count") or 0,
            citation_count=record.get("citation_count") or 0,
            retrieval_quality=record.get("retrieval_quality") or 1.0,
            labels=[label for label in record["labels"] if label != "Entity"],
            attributes=attributes,
        )

    async def get_fact_by_uuid(self, uuid: str) -> FactNode | None:
        records = await self.execute_query(
            """
            MATCH (f:Fact {uuid: $uuid})
            RETURN f AS fact
            """,
            uuid=uuid,
        )
        if not records:
            return None
        return self._dict_to_fact_node(records[0]["fact"])

    async def get_fact_by_text(self, fact: str, group_id: str) -> FactNode | None:
        records = await self.execute_query(
            """
            MATCH (f:Fact)
            WHERE f.group_id = $group_id
              AND toLower(f.fact) = toLower($fact)
            RETURN f AS fact
            LIMIT 1
            """,
            fact=fact,
            group_id=group_id,
        )
        if not records:
            return None
        return self._dict_to_fact_node(records[0]["fact"])

    async def get_fact_roles(
        self,
        fact_uuids: list[str],
        group_id: str,
    ) -> list[FactRoleDetail]:
        if not fact_uuids:
            return []

        records = await self.execute_query(
            """
            MATCH (fact:Fact)-[r:HAS_ROLE]->(entity:Entity)
            WHERE fact.uuid IN $fact_uuids
              AND fact.group_id = $group_id
              AND entity.group_id = $group_id
            RETURN fact.uuid AS fact_uuid,
                   entity.uuid AS entity_uuid,
                   entity.name AS entity_name,
                   r.role AS role,
                   r.role_description AS role_description
            """,
            fact_uuids=fact_uuids,
            group_id=group_id,
        )

        roles = []
        for record in records:
            role = FactRoleDetail(
                fact_uuid=record.get("fact_uuid") or "",
                entity_uuid=record.get("entity_uuid") or "",
                entity_name=record.get("entity_name") or "",
                role=record.get("role") or "",
                role_description=record.get("role_description"),
            )
            roles.append(role)

        return roles

    async def save_entity_edge(self, edge: EntityEdge) -> None:
        edge_data = {
            "uuid": edge.uuid,
            "name": edge.name,
            "fact": edge.fact,
            "fact_embedding": edge.fact_embedding,
            "episodes": edge.episodes,
            "created_at": edge.created_at,
            "expired_at": edge.expired_at,
            "valid_at": edge.valid_at,
            "invalid_at": edge.invalid_at,
            "strength": edge.strength,
            "group_id": edge.group_id,
        }
        if edge.attributes:
            reserved_keys = set(edge_data.keys())
            for key, value in edge.attributes.items():
                if key in reserved_keys:
                    continue
                edge_data[key] = value

        await self.execute_query(
            """
            MATCH (source:Entity {uuid: $source_uuid})
            MATCH (target:Entity {uuid: $target_uuid})
            MERGE (source)-[r:RELATES_TO {uuid: $edge_data.uuid}]->(target)
            SET r = $edge_data
            SET r.fact_embedding = vecf32($edge_data.fact_embedding)
            """,
            source_uuid=edge.source_node_uuid,
            target_uuid=edge.target_node_uuid,
            edge_data=edge_data,
        )
        logger.debug(f"Saved EntityEdge: {edge.uuid}")

    async def get_existing_edges(
        self, source_uuid: str, target_uuid: str, group_id: str
    ) -> list[EntityEdge]:
        """Get existing edges between two nodes for deduplication."""
        records = await self.execute_query(
            """
            MATCH (source:Entity {uuid: $source_uuid})
            MATCH (target:Entity {uuid: $target_uuid})
            MATCH (source)-[r:RELATES_TO]->(target)
            WHERE r.group_id = $group_id
            RETURN r AS edge, source.uuid AS source_uuid, target.uuid AS target_uuid
            """,
            source_uuid=source_uuid,
            target_uuid=target_uuid,
            group_id=group_id,
        )
        return [
            self._dict_to_entity_edge(record["edge"], record["source_uuid"], record["target_uuid"])
            for record in records
        ]

    async def get_edge_uuids_for_episode(self, episode_uuid: str, group_id: str) -> list[str]:
        """Return all semantic edge UUIDs that reference an episode UUID."""
        records = await self.execute_query(
            """
            MATCH ()-[r:RELATES_TO]->()
            WHERE r.group_id = $group_id
              AND r.episodes IS NOT NULL
              AND $episode_uuid IN r.episodes
            RETURN r.uuid AS uuid
            """,
            group_id=group_id,
            episode_uuid=episode_uuid,
        )
        return [record["uuid"] for record in records if record.get("uuid")]

    async def get_fact_uuids_for_episode(self, episode_uuid: str, group_id: str) -> list[str]:
        """Return all fact UUIDs that reference an episode UUID."""
        records = await self.execute_query(
            """
            MATCH (f:Fact)
            WHERE f.group_id = $group_id
              AND f.episodes IS NOT NULL
              AND $episode_uuid IN f.episodes
            RETURN f.uuid AS uuid
            """,
            group_id=group_id,
            episode_uuid=episode_uuid,
        )
        return [record["uuid"] for record in records if record.get("uuid")]

    async def invalidate_edge(self, edge_uuid: str, invalid_at: datetime) -> None:
        """Invalidate an edge by setting its invalid_at timestamp."""
        await self.execute_query(
            """
            MATCH ()-[r:RELATES_TO {uuid: $uuid}]->()
            SET r.invalid_at = $invalid_at
            """,
            uuid=edge_uuid,
            invalid_at=invalid_at,
        )
        logger.debug(f"Invalidated EntityEdge: {edge_uuid}")

    async def save_episodic_edge(self, edge: EpisodicEdge) -> None:
        await self.execute_query(
            """
            MATCH (source:Episodic {uuid: $source_uuid})
            MATCH (target:Entity {uuid: $target_uuid})
            MERGE (source)-[r:MENTIONS {uuid: $uuid}]->(target)
            SET r.group_id = $group_id,
                r.created_at = $created_at
            """,
            uuid=edge.uuid,
            source_uuid=edge.source_node_uuid,
            target_uuid=edge.target_node_uuid,
            group_id=edge.group_id,
            created_at=edge.created_at,
        )
        logger.debug(f"Saved EpisodicEdge: {edge.uuid}")

    async def get_episodic_by_uuid(self, uuid: str) -> EpisodicNode | None:
        """Get an episodic node by UUID."""
        from dere_graph.models import EpisodeType

        records = await self.execute_query(
            """
            MATCH (e:Episodic {uuid: $uuid})
            RETURN e.uuid AS uuid,
                   e.name AS name,
                   e.content AS content,
                   e.source_description AS source_description,
                   e.source AS source,
                   e.group_id AS group_id,
                   e.valid_at AS valid_at,
                   e.entity_edges AS entity_edges,
                   e.fact_nodes AS fact_nodes,
                   e.created_at AS created_at
            """,
            uuid=uuid,
        )

        if not records:
            return None

        record = records[0]
        return EpisodicNode(
            uuid=record["uuid"],
            name=record["name"],
            content=record["content"],
            source_description=record["source_description"],
            source=EpisodeType(record["source"]),
            group_id=record["group_id"],
            valid_at=_parse_iso_datetime(record["valid_at"]) or datetime.now(UTC),
            entity_edges=record.get("entity_edges") or [],
            fact_nodes=record.get("fact_nodes") or [],
            created_at=_parse_iso_datetime(record["created_at"]) or datetime.now(UTC),
        )

    async def remove_episode(self, episode_uuid: str) -> None:
        """Remove an episode and its associated edges from the graph.

        Args:
            episode_uuid: UUID of the episode to remove
        """
        await self.execute_query(
            """
            MATCH (e:Episodic {uuid: $uuid})
            OPTIONAL MATCH (e)-[r:MENTIONS]->()
            DELETE r, e
            """,
            uuid=episode_uuid,
        )
        logger.info(f"Removed episode: {episode_uuid}")

    async def get_entities_at_time(
        self, timestamp: datetime, group_id: str, limit: int = 100
    ) -> list[EntityNode]:
        """Get entities that were valid at a specific point in time.

        Args:
            timestamp: Point in time to query
            group_id: Graph partition
            limit: Maximum number of entities to return

        Returns:
            List of EntityNode objects valid at timestamp
        """
        ts = (
            timestamp.replace(tzinfo=UTC)
            if timestamp.tzinfo is None
            else timestamp.astimezone(UTC)
        ).isoformat()

        query = """
        MATCH (n:Entity)
        WHERE n.group_id = $group_id
          AND n.created_at <= $timestamp
          AND (n.expired_at IS NULL OR n.expired_at > $timestamp)
        RETURN n AS node
        LIMIT $limit
        """

        records = await self.execute_query(query, group_id=group_id, timestamp=ts, limit=limit)
        return [self._dict_to_entity_node(record["node"]) for record in records]

    async def get_edges_at_time(
        self, timestamp: datetime, group_id: str, limit: int = 100
    ) -> list[EntityEdge]:
        """Get edges that were valid at a specific point in time.

        Args:
            timestamp: Point in time to query
            group_id: Graph partition
            limit: Maximum number of edges to return

        Returns:
            List of EntityEdge objects valid at timestamp
        """
        ts = (
            timestamp.replace(tzinfo=UTC)
            if timestamp.tzinfo is None
            else timestamp.astimezone(UTC)
        ).isoformat()

        query = """
        MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
        WHERE r.group_id = $group_id
          AND r.created_at <= $timestamp
          AND (r.expired_at IS NULL OR r.expired_at > $timestamp)
          AND (r.valid_at IS NULL OR r.valid_at <= $timestamp)
          AND (r.invalid_at IS NULL OR r.invalid_at > $timestamp)
        RETURN r AS edge, source.uuid AS source_uuid, target.uuid AS target_uuid
        LIMIT $limit
        """

        records = await self.execute_query(query, group_id=group_id, timestamp=ts, limit=limit)
        return [
            self._dict_to_entity_edge(record["edge"], record["source_uuid"], record["target_uuid"])
            for record in records
        ]

    async def get_by_uuids(
        self, uuids: list[str], node_type: str = "Entity"
    ) -> list[EntityNode | EpisodicNode]:
        """Get multiple nodes by their UUIDs.

        Args:
            uuids: List of UUIDs to retrieve
            node_type: Type of node ('Entity' or 'Episode')

        Returns:
            List of node objects
        """
        if not uuids:
            return []

        query = f"""
        MATCH (n:{node_type})
        WHERE n.uuid IN $uuids
        RETURN n
        """

        records = await self.execute_query(query, uuids=uuids)

        nodes = []
        for record in records:
            node_data = record["n"]
            if node_type == "Entity":
                nodes.append(self._dict_to_entity_node(node_data))
            elif node_type == "Episode":
                nodes.append(self._dict_to_episodic_node(node_data))

        return nodes

    async def get_by_group_ids(
        self,
        group_ids: list[str],
        node_type: str = "Entity",
        limit: int = 1000,
    ) -> list[EntityNode | EpisodicNode]:
        """Get nodes from multiple group_ids.

        Args:
            group_ids: List of group IDs to query
            node_type: Type of node ('Entity' or 'Episode')
            limit: Maximum number of nodes to return

        Returns:
            List of node objects
        """
        if not group_ids:
            return []

        query = f"""
        MATCH (n:{node_type})
        WHERE n.group_id IN $group_ids
        RETURN n
        LIMIT $limit
        """

        records = await self.execute_query(query, group_ids=group_ids, limit=limit)

        nodes = []
        for record in records:
            node_data = record["n"]
            if node_type == "Entity":
                nodes.append(self._dict_to_entity_node(node_data))
            elif node_type == "Episode":
                nodes.append(self._dict_to_episodic_node(node_data))

        return nodes

    async def get_between_nodes(
        self, source_uuid: str, target_uuid: str, group_id: str
    ) -> list[EntityEdge]:
        """Get all edges between two nodes (in both directions).

        Args:
            source_uuid: UUID of first node
            target_uuid: UUID of second node
            group_id: Graph partition

        Returns:
            List of EntityEdge objects
        """
        query = """
        MATCH (source:Entity {uuid: $source_uuid})-[r:RELATES_TO]-(target:Entity {uuid: $target_uuid})
        WHERE r.group_id = $group_id
        RETURN r AS edge, source.uuid AS source_uuid, target.uuid AS target_uuid
        """

        records = await self.execute_query(
            query, source_uuid=source_uuid, target_uuid=target_uuid, group_id=group_id
        )

        return [
            self._dict_to_entity_edge(record["edge"], record["source_uuid"], record["target_uuid"])
            for record in records
        ]

    async def get_by_node_uuid(
        self, node_uuid: str, group_id: str, direction: str = "both"
    ) -> list[EntityEdge]:
        """Get all edges connected to a node.

        Args:
            node_uuid: UUID of the node
            group_id: Graph partition
            direction: 'outgoing', 'incoming', or 'both'

        Returns:
            List of EntityEdge objects
        """
        if direction == "outgoing":
            match_clause = "MATCH (source:Entity {uuid: $node_uuid})-[r:RELATES_TO]->(target:Entity)"
            extra_where = ""
        elif direction == "incoming":
            match_clause = (
                "MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity {uuid: $node_uuid})"
            )
            extra_where = ""
        else:  # both
            match_clause = "MATCH (source:Entity)-[r:RELATES_TO]-(target:Entity)"
            extra_where = "AND (source.uuid = $node_uuid OR target.uuid = $node_uuid)"

        query = f"""
        {match_clause}
        WHERE r.group_id = $group_id
          {extra_where}
        RETURN r AS edge, source.uuid AS source_uuid, target.uuid AS target_uuid
        """

        records = await self.execute_query(query, node_uuid=node_uuid, group_id=group_id)
        return [
            self._dict_to_entity_edge(record["edge"], record["source_uuid"], record["target_uuid"])
            for record in records
        ]

    async def delete_by_uuids(self, uuids: list[str], node_type: str = "Entity") -> int:
        """Delete multiple nodes by UUID.

        Args:
            uuids: List of UUIDs to delete
            node_type: Type of node to delete

        Returns:
            Number of nodes deleted
        """
        if not uuids:
            return 0

        query = f"""
        MATCH (n:{node_type})
        WHERE n.uuid IN $uuids
        DETACH DELETE n
        RETURN count(n) as deleted_count
        """

        records = await self.execute_query(query, uuids=uuids)
        if not records:
            return 0
        return int(records[0].get("deleted_count", 0) or 0)

    async def delete_by_group_id(self, group_id: str, node_type: str = "Entity") -> int:
        """Delete all nodes in a group_id.

        Args:
            group_id: Group ID to delete
            node_type: Type of node to delete

        Returns:
            Number of nodes deleted
        """
        query = f"""
        MATCH (n:{node_type})
        WHERE n.group_id = $group_id
        DETACH DELETE n
        RETURN count(n) as deleted_count
        """

        records = await self.execute_query(query, group_id=group_id)
        if not records:
            return 0
        return int(records[0].get("deleted_count", 0) or 0)

    def _dict_to_entity_node(self, node_data: Any) -> EntityNode:
        """Convert FalkorDB node data to EntityNode."""
        props = dict(node_data.properties)

        # Extract known fields
        uuid = props.pop("uuid", "")
        name = props.pop("name", "")
        group_id = props.pop("group_id", "")
        name_embedding = props.pop("name_embedding", None)
        summary = props.pop("summary", "")
        created_at_str = props.pop("created_at", None)
        expired_at_str = props.pop("expired_at", None)
        aliases = props.pop("aliases", []) or []
        last_mentioned_str = props.pop("last_mentioned", None)
        mention_count = props.pop("mention_count", 1)
        retrieval_count = props.pop("retrieval_count", 0)
        citation_count = props.pop("citation_count", 0)
        retrieval_quality = props.pop("retrieval_quality", 1.0)

        # Remaining props are attributes
        attributes = props

        created_at = _parse_iso_datetime(created_at_str) or datetime.now(UTC)
        expired_at = _parse_iso_datetime(expired_at_str)
        last_mentioned = _parse_iso_datetime(last_mentioned_str)

        # Get labels (excluding 'Entity')
        labels = [label for label in node_data.labels if label != "Entity"]

        return EntityNode(
            uuid=uuid,
            name=name,
            group_id=group_id,
            name_embedding=name_embedding,
            summary=summary,
            created_at=created_at,
            expired_at=expired_at,
            aliases=aliases,
            last_mentioned=last_mentioned,
            mention_count=mention_count,
            retrieval_count=retrieval_count,
            citation_count=citation_count,
            retrieval_quality=retrieval_quality,
            labels=labels,
            attributes=attributes,
        )

    def _dict_to_episodic_node(self, node_data: Any) -> EpisodicNode:
        """Convert FalkorDB node data to EpisodicNode."""
        from dere_graph.models import EpisodeType

        props = dict(node_data.properties)

        uuid = props.pop("uuid", "")
        name = props.pop("name", "")
        group_id = props.pop("group_id", "")
        source = EpisodeType.from_str(props.pop("source", "text"))
        source_description = props.pop("source_description", "")
        content = props.pop("content", "")
        valid_at_str = props.pop("valid_at", None)
        conversation_id = props.pop("conversation_id", "")
        entity_edges = props.pop("entity_edges", [])
        fact_nodes = props.pop("fact_nodes", [])
        speaker_id = props.pop("speaker_id", None)
        speaker_name = props.pop("speaker_name", None)
        personality = props.pop("personality", None)
        created_at_str = props.pop("created_at", None)

        valid_at = _parse_iso_datetime(valid_at_str) or datetime.now(UTC)
        created_at = _parse_iso_datetime(created_at_str) or datetime.now(UTC)

        return EpisodicNode(
            uuid=uuid,
            name=name,
            group_id=group_id,
            source=source,
            source_description=source_description,
            content=content,
            valid_at=valid_at,
            conversation_id=conversation_id,
            entity_edges=entity_edges,
            fact_nodes=fact_nodes,
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            personality=personality,
            created_at=created_at,
        )

    def _dict_to_fact_node(self, node_data: Any) -> FactNode:
        """Convert FalkorDB node data to FactNode."""
        props = dict(node_data.properties)

        uuid = props.pop("uuid", "")
        name = props.pop("name", "")
        group_id = props.pop("group_id", "")
        fact = props.pop("fact", "")
        fact_embedding = props.pop("fact_embedding", None)
        episodes = props.pop("episodes", [])
        created_at_str = props.pop("created_at", None)
        expired_at_str = props.pop("expired_at", None)
        valid_at_str = props.pop("valid_at", None)
        invalid_at_str = props.pop("invalid_at", None)

        created_at = _parse_iso_datetime(created_at_str) or datetime.now(UTC)
        expired_at = _parse_iso_datetime(expired_at_str)
        valid_at = _parse_iso_datetime(valid_at_str)
        invalid_at = _parse_iso_datetime(invalid_at_str)

        attributes = props

        return FactNode(
            uuid=uuid,
            name=name,
            group_id=group_id,
            fact=fact,
            fact_embedding=fact_embedding,
            episodes=episodes,
            created_at=created_at,
            expired_at=expired_at,
            valid_at=valid_at,
            invalid_at=invalid_at,
            attributes=attributes,
        )

    def _dict_to_entity_edge(
        self, edge_data: Any, source_uuid: str, target_uuid: str
    ) -> EntityEdge:
        """Convert FalkorDB edge data to EntityEdge."""
        props = dict(edge_data.properties)

        uuid = props.pop("uuid", "")
        group_id = props.pop("group_id", "")
        name = props.pop("name", "")
        fact = props.pop("fact", "")
        fact_embedding = props.pop("fact_embedding", None)
        episodes = props.pop("episodes", [])
        strength = props.pop("strength", None)
        expired_at_str = props.pop("expired_at", None)
        valid_at_str = props.pop("valid_at", None)
        invalid_at_str = props.pop("invalid_at", None)
        created_at_str = props.pop("created_at", None)

        # Remaining props are attributes
        attributes = props

        expired_at = _parse_iso_datetime(expired_at_str)
        valid_at = _parse_iso_datetime(valid_at_str)
        invalid_at = _parse_iso_datetime(invalid_at_str)
        created_at = _parse_iso_datetime(created_at_str) or datetime.now(UTC)

        strength_val: float | None
        if strength is None:
            strength_val = None
        else:
            try:
                strength_val = float(strength)
            except Exception:
                strength_val = None

        return EntityEdge(
            uuid=uuid,
            group_id=group_id,
            source_node_uuid=source_uuid,
            target_node_uuid=target_uuid,
            name=name,
            fact=fact,
            fact_embedding=fact_embedding,
            episodes=episodes,
            expired_at=expired_at,
            valid_at=valid_at,
            invalid_at=invalid_at,
            created_at=created_at,
            strength=strength_val,
            attributes=attributes,
        )

    async def close(self) -> None:
        """Close the FalkorDB connection."""
        # FalkorDB client doesn't need explicit closing
        logger.info("FalkorDB connection closed")
