from __future__ import annotations

import asyncio
from datetime import datetime

from loguru import logger
from pydantic import BaseModel

from dere_graph.communities import CommunityDetector
from dere_graph.driver import FalkorDriver
from dere_graph.embeddings import OpenAIEmbedder
from dere_graph.filters import SearchFilters
from dere_graph.llm_client import ClaudeClient
from dere_graph.models import CommunityNode, EntityEdge, EntityNode, EpisodeType, EpisodicNode
from dere_graph.operations import add_episode
from dere_graph.reranking import mmr_rerank, score_by_recency
from dere_graph.search import hybrid_edge_search, hybrid_node_search
from dere_graph.traversal import (
    calculate_node_distances,
    edge_bfs_search,
    node_bfs_search,
    node_distance_reranker,
)


class AddEpisodeResults(BaseModel):
    episode: EpisodicNode
    nodes: list[EntityNode]
    edges: list[EntityEdge]


class SearchResults(BaseModel):
    nodes: list[EntityNode]
    edges: list[EntityEdge]


class DereGraph:
    """Main API for dere_graph - minimal Graphiti clone."""

    def __init__(
        self,
        falkor_host: str = "localhost",
        falkor_port: int = 6379,
        falkor_username: str | None = None,
        falkor_password: str | None = None,
        falkor_database: str = "dere_graph",
        openai_api_key: str | None = None,
        claude_model: str = "claude-sonnet-4-5",
        embedding_dim: int = 1536,
        postgres_db_url: str | None = None,
        enable_reflection: bool = True,
    ):
        """Initialize DereGraph with database and AI clients.

        Args:
            falkor_host: FalkorDB host
            falkor_port: FalkorDB port
            falkor_username: FalkorDB username
            falkor_password: FalkorDB password
            falkor_database: FalkorDB database name
            openai_api_key: OpenAI API key for embeddings
            claude_model: Claude model name
            embedding_dim: Embedding dimensionality
            postgres_db_url: Optional Postgres connection URL for entity meta-context
            enable_reflection: Enable reflection-based entity extraction validation
        """
        self.driver = FalkorDriver(
            host=falkor_host,
            port=falkor_port,
            username=falkor_username,
            password=falkor_password,
            database=falkor_database,
        )
        self.llm_client = ClaudeClient(model=claude_model)
        self.embedder = OpenAIEmbedder(
            api_key=openai_api_key,
            embedding_dim=embedding_dim,
        )
        self.enable_reflection = enable_reflection

        # Optional Postgres for entity meta-context
        if postgres_db_url:
            from dere_graph.postgres import PostgresDriver

            self.postgres_driver = PostgresDriver(
                db_url=postgres_db_url,
                embedding_dim=embedding_dim,
            )
            logger.info("Postgres driver initialized for entity meta-context")
        else:
            self.postgres_driver = None

        logger.info("DereGraph initialized")

    async def close(self) -> None:
        """Close database connections."""
        await self.driver.close()
        if self.postgres_driver:
            await self.postgres_driver.close()
        logger.info("DereGraph closed")

    async def build_indices(self, delete_existing: bool = False) -> None:
        """Build database indices and constraints.

        Args:
            delete_existing: Whether to delete existing indices first
        """
        await self.driver.build_indices_and_constraints(delete_existing)

        # Initialize Postgres schema if enabled
        if self.postgres_driver:
            await self.postgres_driver.connect()
            await self.postgres_driver.init_schema()

        logger.info("Database indices built")

    async def add_episode(
        self,
        episode_body: str,
        source_description: str,
        reference_time: datetime,
        source: EpisodeType = EpisodeType.text,
        group_id: str = "default",
        name: str | None = None,
        conversation_id: str | None = None,
        speaker_id: str | None = None,
        speaker_name: str | None = None,
        personality: str | None = None,
    ) -> AddEpisodeResults:
        """Add an episode to the knowledge graph.

        This method:
        1. Creates an episodic node
        2. Extracts entities from the content
        3. Deduplicates entities
        4. Extracts relationships
        5. Generates embeddings
        6. Saves everything to Neo4j

        Args:
            episode_body: Episode content
            source_description: Description of the data source
            reference_time: Timestamp for the episode
            source: Episode type (text, message, json)
            group_id: Partition ID for the graph
            name: Optional episode name (auto-generated if not provided)
            conversation_id: Conversation grouping ID (auto-generated as YYYY-MM-DD if not provided)
            speaker_id: Optional speaker ID for pronoun resolution (e.g., Discord user ID)
            speaker_name: Optional speaker display name for pronoun resolution
            personality: Optional AI personality name (e.g., 'Tsun', 'Kuu')

        Returns:
            AddEpisodeResults with created nodes and edges
        """
        # Auto-generate name if not provided
        if name is None:
            name = reference_time.strftime("%Y-%m-%d")

        # Auto-generate conversation_id if not provided (per-day + source format)
        if conversation_id is None:
            # Extract medium from source_description (e.g., "discord conversation" -> "discord")
            medium = source_description.split()[0] if source_description else "unknown"
            conversation_id = f"{reference_time.strftime('%Y-%m-%d')}-{medium}"

        logger.info(f"Adding episode: {name}")

        # Check if episode already exists for this conversation_id
        existing_episodes = await self.driver.get_episodes_by_conversation_id(
            conversation_id=conversation_id,
            group_id=group_id,
        )

        if existing_episodes:
            # Reuse existing episode, append content
            episode = existing_episodes[0]
            episode.content = f"{episode.content}\n\n{episode_body}"
        else:
            # Create new episode node
            episode = EpisodicNode(
                name=name,
                group_id=group_id,
                source=source,
                content=episode_body,
                source_description=source_description,
                valid_at=reference_time,
                conversation_id=conversation_id,
                speaker_id=speaker_id,
                speaker_name=speaker_name,
                personality=personality,
            )

        # Retrieve previous episodes for context
        previous_episodes = await self.driver.get_recent_episodes(group_id, limit=5)

        # Run ingestion pipeline
        await add_episode(
            self.driver,
            self.llm_client,
            self.embedder,
            episode,
            previous_episodes,
            self.postgres_driver,
            self.enable_reflection,
        )

        logger.info(f"Episode added: {episode.uuid}")

        # Return results (for now, just the episode)
        # TODO: Track and return actual nodes/edges created
        return AddEpisodeResults(
            episode=episode,
            nodes=[],
            edges=[],
        )

    async def add_episodes_bulk(
        self,
        episodes: list[tuple[str, str, datetime, EpisodeType]],
        group_id: str = "default",
        max_concurrent: int = 5,
    ) -> list[AddEpisodeResults]:
        """Add multiple episodes in parallel with concurrency control.

        Args:
            episodes: List of tuples (body, source_desc, ref_time, source_type)
            group_id: Partition ID for the graph
            max_concurrent: Maximum number of concurrent ingestions

        Returns:
            List of AddEpisodeResults for each episode
        """
        logger.info(f"Bulk adding {len(episodes)} episodes with max_concurrent={max_concurrent}")

        semaphore = asyncio.Semaphore(max_concurrent)

        async def add_with_semaphore(
            episode_body: str,
            source_description: str,
            reference_time: datetime,
            source: EpisodeType,
        ) -> AddEpisodeResults:
            async with semaphore:
                return await self.add_episode(
                    episode_body=episode_body,
                    source_description=source_description,
                    reference_time=reference_time,
                    source=source,
                    group_id=group_id,
                )

        tasks = [add_with_semaphore(*episode_data) for episode_data in episodes]
        results = await asyncio.gather(*tasks)

        logger.info(f"Bulk ingestion complete: {len(results)} episodes added")
        return results

    async def search(
        self,
        query: str,
        group_id: str = "default",
        limit: int = 10,
        filters: SearchFilters | None = None,
        center_node_uuid: str | None = None,
        rerank_method: str | None = None,
        lambda_param: float = 0.5,
        rerank_alpha: float = 0.5,
        recency_weight: float = 0.0,
    ) -> SearchResults:
        """Search the knowledge graph using hybrid search with optional reranking.

        Combines BM25 fulltext search and vector similarity search
        using Reciprocal Rank Fusion, with optional reranking strategies.

        Args:
            query: Search query
            group_id: Graph partition to search
            limit: Maximum number of results
            filters: Optional temporal/attribute filters
            center_node_uuid: Optional center node for distance-based reranking
            rerank_method: Optional reranking method ("mmr", "distance", "episode_mentions", "recency", or None)
            lambda_param: MMR lambda parameter (1=pure relevance, 0=pure diversity)
            rerank_alpha: Alpha parameter for episode_mentions/recency reranking (0-1)
            recency_weight: Weight for recency boost (0-1, 0=no boost)

        Returns:
            SearchResults with matching nodes and edges
        """
        logger.info(f"Searching for: {query}")

        # Generate query embedding for MMR
        query_embedding = await self.embedder.create(query.replace("\n", " "))

        # Search nodes and edges in parallel
        # For episode_mentions and recency, reranking is done in hybrid_node_search
        if rerank_method in ("episode_mentions", "recency"):
            nodes = await hybrid_node_search(
                self.driver,
                self.embedder,
                query,
                group_id,
                limit,
                filters,
                rerank_method=rerank_method,
                rerank_alpha=rerank_alpha,
            )
        else:
            nodes = await hybrid_node_search(
                self.driver,
                self.embedder,
                query,
                group_id,
                limit * 2 if rerank_method else limit,
                filters,
            )

        edges = await hybrid_edge_search(
            self.driver,
            self.embedder,
            query,
            group_id,
            limit * 2 if rerank_method else limit,
            filters,
        )

        # Apply reranking if requested (for MMR and distance methods)
        if rerank_method == "mmr" and nodes:
            nodes = mmr_rerank(nodes, query_embedding, lambda_param, limit)
        elif rerank_method == "distance" and center_node_uuid and nodes:
            node_uuids = [n.uuid for n in nodes]
            distances = await calculate_node_distances(
                self.driver, center_node_uuid, node_uuids, group_id
            )
            nodes = node_distance_reranker(nodes, center_node_uuid, distances)
            nodes = nodes[:limit]
        elif rerank_method not in ("episode_mentions", "recency"):
            nodes = nodes[:limit]

        # Apply recency boost if requested (separate from rerank_method="recency")
        if recency_weight > 0 and nodes:
            scored_nodes = score_by_recency(nodes)
            nodes = [node for node, score in sorted(scored_nodes, key=lambda x: x[1], reverse=True)]

        edges = edges[:limit]

        logger.info(f"Search found {len(nodes)} nodes, {len(edges)} edges")

        return SearchResults(nodes=nodes, edges=edges)

    async def get_node(self, uuid: str) -> EntityNode | None:
        """Get a node by UUID.

        Args:
            uuid: Node UUID

        Returns:
            EntityNode if found, None otherwise
        """
        return await self.driver.get_entity_by_uuid(uuid)

    async def get_episode(self, uuid: str) -> EpisodicNode | None:
        """Get an episode by UUID.

        Args:
            uuid: Episode UUID

        Returns:
            EpisodicNode if found, None otherwise
        """
        return await self.driver.get_episodic_by_uuid(uuid)

    async def build_communities(
        self,
        group_id: str = "default",
        resolution: float = 1.0,
    ) -> list[CommunityNode]:
        """Detect communities in the graph using Leiden algorithm.

        Args:
            group_id: Graph partition to analyze
            resolution: Resolution parameter for Leiden (higher = more communities)

        Returns:
            List of CommunityNode objects with summaries
        """
        logger.info(f"Building communities for group: {group_id}")

        detector = CommunityDetector(self.driver, self.llm_client)
        communities = await detector.build_communities(group_id, resolution)

        logger.info(f"Built {len(communities)} communities")
        return communities

    async def remove_episode(self, episode_uuid: str) -> None:
        """Remove an episode from the graph.

        This removes the episode node and its MENTIONS edges but leaves
        entities and their relationships intact.

        Args:
            episode_uuid: UUID of the episode to remove
        """
        logger.info(f"Removing episode: {episode_uuid}")
        await self.driver.remove_episode(episode_uuid)
        logger.info(f"Episode removed: {episode_uuid}")

    async def add_triplet(
        self,
        source_name: str,
        relation_type: str,
        target_name: str,
        fact: str,
        group_id: str = "default",
        valid_at: datetime | None = None,
        invalid_at: datetime | None = None,
    ) -> EntityEdge:
        """Manually add a fact triplet to the graph.

        This creates or updates entity nodes and adds an edge between them.
        Useful for manual curation or importing structured data.

        Args:
            source_name: Name of the source entity
            relation_type: Relationship type (e.g., "WORKS_AT")
            target_name: Name of the target entity
            fact: Human-readable fact description
            group_id: Graph partition
            valid_at: When the relationship became true
            invalid_at: When the relationship stopped being true

        Returns:
            The created EntityEdge
        """
        logger.info(f"Adding triplet: {source_name} -{relation_type}-> {target_name}")

        # Create or get source entity
        source_node = EntityNode(
            name=source_name,
            group_id=group_id,
            summary="",
        )

        # Generate embedding for source
        source_embedding = await self.embedder.create(source_name.replace("\n", " "))
        source_node.name_embedding = source_embedding

        await self.driver.save_entity_node(source_node)

        # Create or get target entity
        target_node = EntityNode(
            name=target_name,
            group_id=group_id,
            summary="",
        )

        # Generate embedding for target
        target_embedding = await self.embedder.create(target_name.replace("\n", " "))
        target_node.name_embedding = target_embedding

        await self.driver.save_entity_node(target_node)

        # Create edge
        edge = EntityEdge(
            source_node_uuid=source_node.uuid,
            target_node_uuid=target_node.uuid,
            name=relation_type,
            fact=fact,
            group_id=group_id,
            valid_at=valid_at,
            invalid_at=invalid_at,
            episodes=[],
        )

        # Generate embedding for fact
        fact_embedding = await self.embedder.create(fact.replace("\n", " "))
        edge.fact_embedding = fact_embedding

        await self.driver.save_entity_edge(edge)

        logger.info(f"Triplet added: {edge.uuid}")
        return edge

    async def get_entities_at_time(
        self,
        timestamp: datetime,
        group_id: str = "default",
        limit: int = 100,
    ) -> list[EntityNode]:
        """Get entities that were valid at a specific point in time.

        Args:
            timestamp: Point in time to query
            group_id: Graph partition
            limit: Maximum number of entities to return

        Returns:
            List of EntityNode objects
        """
        return await self.driver.get_entities_at_time(timestamp, group_id, limit)

    async def get_edges_at_time(
        self,
        timestamp: datetime,
        group_id: str = "default",
        limit: int = 100,
    ) -> list[EntityEdge]:
        """Get edges that were valid at a specific point in time.

        Args:
            timestamp: Point in time to query
            group_id: Graph partition
            limit: Maximum number of edges to return

        Returns:
            List of EntityEdge objects
        """
        return await self.driver.get_edges_at_time(timestamp, group_id, limit)

    async def get_entities_by_uuids(self, uuids: list[str]) -> list[EntityNode]:
        """Get multiple entities by their UUIDs.

        Args:
            uuids: List of entity UUIDs

        Returns:
            List of EntityNode objects (non-existent UUIDs are skipped)
        """
        results = await self.driver.get_by_uuids(uuids, node_type="Entity")
        return [node for node in results if isinstance(node, EntityNode)]

    async def get_edges_between_nodes(
        self,
        source_uuid: str,
        target_uuid: str,
        group_id: str = "default",
    ) -> list[EntityEdge]:
        """Get all edges between two nodes (in both directions).

        Args:
            source_uuid: Source node UUID
            target_uuid: Target node UUID
            group_id: Graph partition

        Returns:
            List of EntityEdge objects
        """
        return await self.driver.get_between_nodes(source_uuid, target_uuid, group_id)

    async def delete_entities_by_uuids(self, uuids: list[str]) -> int:
        """Delete multiple entities by UUID.

        Args:
            uuids: List of entity UUIDs to delete

        Returns:
            Number of entities deleted
        """
        return await self.driver.delete_by_uuids(uuids, node_type="Entity")

    async def delete_edges_by_uuids(self, uuids: list[str]) -> int:
        """Delete multiple edges by UUID.

        Args:
            uuids: List of edge UUIDs to delete

        Returns:
            Number of edges deleted
        """
        query = """
        MATCH ()-[e:RELATES_TO]->()
        WHERE e.uuid IN $uuids
        DELETE e
        RETURN count(e) as deleted
        """
        result = await self.driver.execute_query(query, uuids=uuids)
        if result.result_set:
            return result.result_set[0][0]
        return 0

    async def bfs_search_nodes(
        self,
        origin_uuids: list[str],
        group_id: str = "default",
        max_depth: int = 3,
        limit: int = 100,
    ) -> list[EntityNode]:
        """Breadth-first search starting from origin nodes.

        Args:
            origin_uuids: Starting node UUIDs
            group_id: Graph partition
            max_depth: Maximum traversal depth
            limit: Maximum number of nodes to return

        Returns:
            List of EntityNode objects found via BFS
        """
        return await node_bfs_search(self.driver, origin_uuids, group_id, max_depth, limit)

    async def bfs_search_edges(
        self,
        origin_uuids: list[str],
        group_id: str = "default",
        max_depth: int = 3,
        limit: int = 100,
    ) -> list[EntityEdge]:
        """Breadth-first search for edges starting from origin nodes.

        Args:
            origin_uuids: Starting node UUIDs
            group_id: Graph partition
            max_depth: Maximum traversal depth
            limit: Maximum number of edges to return

        Returns:
            List of EntityEdge objects found via BFS
        """
        return await edge_bfs_search(self.driver, origin_uuids, group_id, max_depth, limit)
