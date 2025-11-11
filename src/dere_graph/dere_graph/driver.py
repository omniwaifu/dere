from __future__ import annotations

from datetime import datetime
from typing import Any

from falkordb.asyncio import FalkorDB
from loguru import logger

from dere_graph.models import (
    EntityEdge,
    EntityNode,
    EpisodicEdge,
    EpisodicNode,
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

        # Fulltext index for edges
        await self.execute_query(
            """
            CREATE FULLTEXT INDEX FOR ()-[e:RELATES_TO]-() ON (e.name, e.fact, e.group_id)
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
                speaker_id=record.get("speaker_id"),
                speaker_name=record.get("speaker_name"),
                personality=record.get("personality"),
                valid_at=datetime.fromisoformat(record["valid_at"]) if record["valid_at"] else None,
                created_at=datetime.fromisoformat(record["created_at"])
                if record["created_at"]
                else None,
            )
            episodes.append(episode)

        return episodes

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
                speaker_id=record.get("speaker_id"),
                speaker_name=record.get("speaker_name"),
                personality=record.get("personality"),
                valid_at=datetime.fromisoformat(record["valid_at"]) if record["valid_at"] else None,
                created_at=datetime.fromisoformat(record["created_at"])
                if record["created_at"]
                else None,
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
                valid_at=datetime.fromisoformat(record["valid_at"]) if record["valid_at"] else None,
                created_at=datetime.fromisoformat(record["created_at"])
                if record["created_at"]
                else None,
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
            "mention_count",
        ]:
            attributes.pop(key, None)

        return EntityNode(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            name_embedding=record["name_embedding"],
            summary=record["summary"] or "",
            created_at=datetime.fromisoformat(record["created_at"])
            if record["created_at"]
            else None,
            mention_count=record.get("mention_count", 1),
            labels=[label for label in record["labels"] if label != "Entity"],
            attributes=attributes,
        )

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
            RETURN r.uuid AS uuid,
                   r.name AS name,
                   r.fact AS fact,
                   r.fact_embedding AS fact_embedding,
                   r.episodes AS episodes,
                   r.created_at AS created_at,
                   r.expired_at AS expired_at,
                   r.valid_at AS valid_at,
                   r.invalid_at AS invalid_at,
                   r.group_id AS group_id
            """,
            source_uuid=source_uuid,
            target_uuid=target_uuid,
            group_id=group_id,
        )

        edges = []
        for record in records:
            edge = EntityEdge(
                uuid=record["uuid"],
                source_node_uuid=source_uuid,
                target_node_uuid=target_uuid,
                name=record["name"],
                fact=record["fact"],
                fact_embedding=record["fact_embedding"],
                episodes=record["episodes"] or [],
                created_at=datetime.fromisoformat(record["created_at"])
                if record["created_at"]
                else None,
                expired_at=datetime.fromisoformat(record["expired_at"])
                if record["expired_at"]
                else None,
                valid_at=datetime.fromisoformat(record["valid_at"]) if record["valid_at"] else None,
                invalid_at=datetime.fromisoformat(record["invalid_at"])
                if record["invalid_at"]
                else None,
                group_id=record["group_id"],
            )
            edges.append(edge)

        return edges

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
            valid_at=datetime.fromisoformat(record["valid_at"]) if record["valid_at"] else None,
            created_at=datetime.fromisoformat(record["created_at"])
            if record["created_at"]
            else None,
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
        ts = int(timestamp.timestamp())

        query = """
        MATCH (n:Entity)
        WHERE n.group_id = $group_id
          AND n.created_at <= $timestamp
          AND (n.expired_at IS NULL OR n.expired_at > $timestamp)
        RETURN n
        LIMIT $limit
        """

        result = await self.execute_query(query, group_id=group_id, timestamp=ts, limit=limit)

        nodes = []
        for record in result.result_set:
            node_data = record[0]
            nodes.append(self._dict_to_entity_node(node_data))

        return nodes

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
        ts = int(timestamp.timestamp())

        query = """
        MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
        WHERE r.group_id = $group_id
          AND r.created_at <= $timestamp
          AND (r.expired_at IS NULL OR r.expired_at > $timestamp)
          AND (r.valid_at IS NULL OR r.valid_at <= $timestamp)
          AND (r.invalid_at IS NULL OR r.invalid_at > $timestamp)
        RETURN r, source.uuid, target.uuid
        LIMIT $limit
        """

        result = await self.execute_query(query, group_id=group_id, timestamp=ts, limit=limit)

        edges = []
        for record in result.result_set:
            edge_data = record[0]
            source_uuid = record[1]
            target_uuid = record[2]
            edges.append(self._dict_to_entity_edge(edge_data, source_uuid, target_uuid))

        return edges

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

        result = await self.execute_query(query, uuids=uuids)

        nodes = []
        for record in result.result_set:
            node_data = record[0]
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

        result = await self.execute_query(query, group_ids=group_ids, limit=limit)

        nodes = []
        for record in result.result_set:
            node_data = record[0]
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
        RETURN r, source.uuid, target.uuid
        """

        result = await self.execute_query(
            query, source_uuid=source_uuid, target_uuid=target_uuid, group_id=group_id
        )

        edges = []
        for record in result.result_set:
            edge_data = record[0]
            src_uuid = record[1]
            tgt_uuid = record[2]
            edges.append(self._dict_to_entity_edge(edge_data, src_uuid, tgt_uuid))

        return edges

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
            pattern = "(n:Entity {uuid: $node_uuid})-[r:RELATES_TO]->(target:Entity)"
        elif direction == "incoming":
            pattern = "(source:Entity)-[r:RELATES_TO]->(n:Entity {uuid: $node_uuid})"
        else:  # both
            pattern = "(source:Entity)-[r:RELATES_TO]-(target:Entity) WHERE source.uuid = $node_uuid OR target.uuid = $node_uuid"

        query = f"""
        MATCH {pattern}
        WHERE r.group_id = $group_id
        RETURN r, source.uuid, target.uuid
        """

        result = await self.execute_query(query, node_uuid=node_uuid, group_id=group_id)

        edges = []
        for record in result.result_set:
            edge_data = record[0]
            src_uuid = record[1]
            tgt_uuid = record[2]
            edges.append(self._dict_to_entity_edge(edge_data, src_uuid, tgt_uuid))

        return edges

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

        result = await self.execute_query(query, uuids=uuids)
        return result.result_set[0][0] if result.result_set else 0

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

        result = await self.execute_query(query, group_id=group_id)
        return result.result_set[0][0] if result.result_set else 0

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
        mention_count = props.pop("mention_count", 1)
        retrieval_count = props.pop("retrieval_count", 0)
        citation_count = props.pop("citation_count", 0)
        retrieval_quality = props.pop("retrieval_quality", 1.0)

        # Remaining props are attributes
        attributes = props

        created_at = datetime.fromisoformat(created_at_str) if created_at_str else datetime.now()

        # Get labels (excluding 'Entity')
        labels = [label for label in node_data.labels if label != "Entity"]

        return EntityNode(
            uuid=uuid,
            name=name,
            group_id=group_id,
            name_embedding=name_embedding,
            summary=summary,
            created_at=created_at,
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
        speaker_id = props.pop("speaker_id", None)
        speaker_name = props.pop("speaker_name", None)
        created_at_str = props.pop("created_at", None)

        valid_at = datetime.fromisoformat(valid_at_str) if valid_at_str else datetime.now()
        created_at = datetime.fromisoformat(created_at_str) if created_at_str else datetime.now()

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
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            created_at=created_at,
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
        expired_at_str = props.pop("expired_at", None)
        valid_at_str = props.pop("valid_at", None)
        invalid_at_str = props.pop("invalid_at", None)
        created_at_str = props.pop("created_at", None)

        # Remaining props are attributes
        attributes = props

        expired_at = datetime.fromisoformat(expired_at_str) if expired_at_str else None
        valid_at = datetime.fromisoformat(valid_at_str) if valid_at_str else None
        invalid_at = datetime.fromisoformat(invalid_at_str) if invalid_at_str else None
        created_at = datetime.fromisoformat(created_at_str) if created_at_str else datetime.now()

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
            attributes=attributes,
        )

    async def close(self) -> None:
        """Close the FalkorDB connection."""
        # FalkorDB client doesn't need explicit closing
        logger.info("FalkorDB connection closed")
