from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, Protocol, TypeVar

from loguru import logger
from pydantic import BaseModel, Field

from dere_graph.communities import CommunityDetector
from dere_graph.driver import FalkorDriver
from dere_graph.embeddings import OpenAIEmbedder
from dere_graph.filters import SearchFilters
from dere_graph.llm_client import ClaudeClient
from dere_graph.models import (
    CommunityNode,
    EntityEdge,
    EntityNode,
    EpisodeType,
    EpisodicNode,
    FactNode,
    FactRoleDetail,
    FactRoleEdge,
)
from dere_graph.operations import add_episode, track_entity_citation, track_entity_retrieval
from dere_graph.reranking import (
    CrossEncoderScorer,
    cross_encoder_rerank,
    mmr_rerank,
    score_by_recency,
)
from dere_graph.routing import (
    DEFAULT_DOMAIN_ROUTES,
    DomainRoute,
    merge_filters,
    select_domain_filters,
)
from dere_graph.search import (
    fulltext_community_search,
    hybrid_edge_search,
    hybrid_fact_search,
    hybrid_node_search,
    rrf,
)
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
    facts: list[FactNode] = Field(default_factory=list)
    fact_roles: list[FactRoleEdge] = Field(default_factory=list)


class SearchResults(BaseModel):
    nodes: list[EntityNode]
    edges: list[EntityEdge]
    facts: list[FactNode] = Field(default_factory=list)


class EdgeCitation(BaseModel):
    edge_uuid: str
    episodes: list[EpisodicNode]


class FactCitation(BaseModel):
    fact_uuid: str
    episodes: list[EpisodicNode]


class _HasUUID(Protocol):
    uuid: str


T = TypeVar("T", bound=_HasUUID)


def _select_with_bfs(
    ranked: list[T],
    bfs: list[T],
    limit: int,
    bfs_slots: int,
) -> list[T]:
    if limit <= 0:
        return []

    bfs_slots = max(0, min(bfs_slots, limit))
    primary_limit = max(0, limit - bfs_slots)
    primary = ranked[:primary_limit]
    seen = {item.uuid for item in primary}
    ranked_uuids = {item.uuid for item in ranked}
    combined = list(primary)

    for item in bfs:
        if len(combined) >= limit:
            break
        if item.uuid in seen or item.uuid in ranked_uuids:
            continue
        combined.append(item)
        seen.add(item.uuid)

    for item in ranked[primary_limit:]:
        if len(combined) >= limit:
            break
        if item.uuid in seen:
            continue
        combined.append(item)
        seen.add(item.uuid)

    return combined


def _collect_bfs_seed_uuids(
    nodes: list[EntityNode],
    edges: list[EntityEdge],
    seed_limit: int,
) -> list[str]:
    if seed_limit <= 0:
        return []

    seeds: list[str] = []
    seen: set[str] = set()

    for node in nodes:
        if node.uuid in seen:
            continue
        seeds.append(node.uuid)
        seen.add(node.uuid)
        if len(seeds) >= seed_limit:
            return seeds

    for edge in edges:
        for uuid in (edge.source_node_uuid, edge.target_node_uuid):
            if uuid in seen:
                continue
            seeds.append(uuid)
            seen.add(uuid)
            if len(seeds) >= seed_limit:
                return seeds

    return seeds


def _extend_seed_uuids(seeds: list[str], extras: list[str], limit: int) -> list[str]:
    if limit <= 0:
        return []

    seen = set(seeds)
    for uuid in extras:
        if len(seeds) >= limit:
            break
        if uuid in seen:
            continue
        seeds.append(uuid)
        seen.add(uuid)

    return seeds


def _merge_ranked_items[T](result_lists: list[list[T]], limit: int) -> list[T]:
    if limit <= 0:
        return []

    uuid_lists = [[item.uuid for item in items] for items in result_lists if items]
    if not uuid_lists:
        return []

    merged_uuids, _ = rrf(uuid_lists)
    item_by_uuid: dict[str, T] = {}
    for items in result_lists:
        for item in items:
            item_by_uuid.setdefault(item.uuid, item)

    merged = [item_by_uuid[uuid] for uuid in merged_uuids if uuid in item_by_uuid]
    return merged[:limit]


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
        enable_attribute_hydration: bool = False,
        enable_edge_date_refinement: bool = False,
        idle_threshold_minutes: int = 15,
        enable_bfs_search: bool = True,
        search_bfs_max_depth: int = 2,
        search_bfs_limit: int = 5,
        search_bfs_seed_limit: int = 5,
        search_recent_episode_limit: int = 3,
        search_bfs_episode_seed_limit: int = 5,
        enable_domain_routing: bool = True,
        search_domain_max_routes: int = 2,
        search_domain_limit: int = 10,
        domain_routes: list[DomainRoute] | None = None,
        cross_encoder: CrossEncoderScorer | None = None,
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
            enable_attribute_hydration: Run a dedicated attribute hydration pass after deduplication
            enable_edge_date_refinement: Run a dedicated edge date extraction pass post-deduplication
            idle_threshold_minutes: Minutes of idle time before creating new conversation_id
            enable_bfs_search: Enable BFS expansion in search
            search_bfs_max_depth: Maximum traversal depth for BFS expansion
            search_bfs_limit: Maximum number of BFS-expanded nodes/edges to consider
            search_bfs_seed_limit: Maximum number of seed nodes for BFS expansion
            search_recent_episode_limit: Number of recent episodes to seed BFS from
            search_bfs_episode_seed_limit: Maximum number of episode-derived seed entities
            enable_domain_routing: Enable domain-aware query routing ("brain views")
            search_domain_max_routes: Maximum number of domain routes to apply per query
            search_domain_limit: Max results per domain-specific search
            domain_routes: Optional custom domain routes for query routing
            cross_encoder: Optional cross-encoder scorer for reranking
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
        self.enable_attribute_hydration = enable_attribute_hydration
        self.enable_edge_date_refinement = enable_edge_date_refinement
        self.idle_threshold_minutes = idle_threshold_minutes
        self.enable_bfs_search = enable_bfs_search
        self.search_bfs_max_depth = search_bfs_max_depth
        self.search_bfs_limit = search_bfs_limit
        self.search_bfs_seed_limit = search_bfs_seed_limit
        self.search_recent_episode_limit = search_recent_episode_limit
        self.search_bfs_episode_seed_limit = search_bfs_episode_seed_limit
        self.enable_domain_routing = enable_domain_routing
        self.search_domain_max_routes = search_domain_max_routes
        self.search_domain_limit = search_domain_limit
        self.domain_routes = domain_routes or DEFAULT_DOMAIN_ROUTES
        self.cross_encoder = cross_encoder

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
        enable_attribute_hydration: bool | None = None,
        enable_edge_date_refinement: bool | None = None,
        entity_types: dict[str, type[BaseModel]] | None = None,
        excluded_entity_types: list[str] | None = None,
        edge_types: dict[str, type[BaseModel]] | None = None,
        excluded_edge_types: list[str] | None = None,
    ) -> AddEpisodeResults:
        """Add an episode to the knowledge graph.

        This method:
        1. Creates an episodic node
        2. Extracts entities from the content
        3. Deduplicates entities
        4. Extracts relationships
        5. Generates embeddings
        6. Persists everything to FalkorDB (and optional Postgres metadata)

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
            enable_attribute_hydration: Override default attribute hydration behavior for this call
            enable_edge_date_refinement: Override default edge date refinement behavior for this call
            entity_types: Optional ontology mapping entity type label -> attribute schema
            excluded_entity_types: Optional entity type labels to exclude at extraction time
            edge_types: Optional ontology mapping edge type -> attribute schema
            excluded_edge_types: Optional edge types to exclude at extraction time

        Returns:
            AddEpisodeResults with created nodes and edges
        """
        # Auto-generate name if not provided
        if name is None:
            name = reference_time.strftime("%Y-%m-%d")

        # Auto-generate conversation_id with idle detection if not provided
        if conversation_id is None:
            conversation_id = await self._generate_conversation_id(
                current_timestamp=reference_time,
                source_description=source_description,
                group_id=group_id,
            )

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
        # Pass episode_body as extraction_content so we only extract from NEW content,
        # not the accumulated episode.content
        created_nodes, created_edges, fact_nodes, fact_role_edges = await add_episode(
            self.driver,
            self.llm_client,
            self.embedder,
            episode,
            previous_episodes,
            self.postgres_driver,
            self.enable_reflection,
            enable_attribute_hydration=(
                self.enable_attribute_hydration
                if enable_attribute_hydration is None
                else enable_attribute_hydration
            ),
            enable_edge_date_refinement=(
                self.enable_edge_date_refinement
                if enable_edge_date_refinement is None
                else enable_edge_date_refinement
            ),
            entity_types=entity_types,
            excluded_entity_types=excluded_entity_types,
            edge_types=edge_types,
            excluded_edge_types=excluded_edge_types,
            extraction_content=episode_body,
        )

        logger.info(f"Episode added: {episode.uuid}")

        # Return results with actual nodes/edges created
        return AddEpisodeResults(
            episode=episode,
            nodes=created_nodes,
            edges=created_edges,
            facts=fact_nodes,
            fact_roles=fact_role_edges,
        )

    async def add_episodes_bulk(
        self,
        episodes: list[tuple[str, str, datetime, EpisodeType]],
        group_id: str = "default",
        max_concurrent: int = 5,
        enable_attribute_hydration: bool | None = None,
        enable_edge_date_refinement: bool | None = None,
        entity_types: dict[str, type[BaseModel]] | None = None,
        excluded_entity_types: list[str] | None = None,
        edge_types: dict[str, type[BaseModel]] | None = None,
        excluded_edge_types: list[str] | None = None,
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
                    enable_attribute_hydration=enable_attribute_hydration,
                    enable_edge_date_refinement=enable_edge_date_refinement,
                    entity_types=entity_types,
                    excluded_entity_types=excluded_entity_types,
                    edge_types=edge_types,
                    excluded_edge_types=excluded_edge_types,
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
        conversation_id: str | None = None,
        domain_routing: bool | None = None,
        include_expired_facts: bool = False,
    ) -> SearchResults:
        """Search the knowledge graph using hybrid search with optional reranking.

        Combines BM25 fulltext search and vector similarity search
        using Reciprocal Rank Fusion, with optional reranking strategies and BFS expansion.

        Args:
            query: Search query
            group_id: Graph partition to search
            limit: Maximum number of results
            filters: Optional temporal/attribute filters
            center_node_uuid: Optional center node for distance-based reranking
            rerank_method: Optional reranking method ("mmr", "distance", "episode_mentions", "recency", "cross_encoder", or None)
            lambda_param: MMR lambda parameter (1=pure relevance, 0=pure diversity)
            rerank_alpha: Alpha parameter for episode_mentions/recency reranking (0-1)
            recency_weight: Weight for recency boost (0-1, 0=no boost)
            conversation_id: Optional conversation grouping ID for BFS seeding
            domain_routing: Override domain routing for this search
            include_expired_facts: Whether to include facts with invalid_at set

        Returns:
            SearchResults with matching nodes and edges
        """
        if not query or not query.strip():
            logger.info("Skipping search with empty query")
            return SearchResults(nodes=[], edges=[], facts=[])

        logger.info(f"Searching for: {query}")

        if limit <= 0:
            return SearchResults(nodes=[], edges=[], facts=[])

        bfs_slots = 0
        if self.enable_bfs_search and self.search_bfs_limit > 0 and limit > 1:
            bfs_slots = min(self.search_bfs_limit, limit - 1)
        primary_limit = limit - bfs_slots

        # Generate query embedding for MMR
        query_embedding = await self.embedder.create(query.replace("\n", " "))

        domain_filters: list[SearchFilters] = []
        if (
            (self.enable_domain_routing if domain_routing is None else domain_routing)
            and query.strip()
            and not (filters and (filters.node_labels or filters.edge_types))
            and self.search_domain_max_routes > 0
        ):
            domain_filters = select_domain_filters(
                query, self.domain_routes, self.search_domain_max_routes
            )

        # Search nodes and edges in parallel
        # For episode_mentions and recency, reranking is done in hybrid_node_search
        node_fetch_limit = limit + bfs_slots
        edge_fetch_limit = limit + bfs_slots
        fact_fetch_limit = limit + bfs_slots

        if rerank_method in ("episode_mentions", "recency"):
            node_candidates = await hybrid_node_search(
                self.driver,
                self.embedder,
                query,
                group_id,
                node_fetch_limit,
                filters,
                rerank_method=rerank_method,
                rerank_alpha=rerank_alpha,
            )
        else:
            hybrid_limit = node_fetch_limit * 2 if rerank_method else node_fetch_limit
            node_candidates = await hybrid_node_search(
                self.driver,
                self.embedder,
                query,
                group_id,
                hybrid_limit,
                filters,
            )

        edge_candidates = await hybrid_edge_search(
            self.driver,
            self.embedder,
            query,
            group_id,
            edge_fetch_limit,
            filters,
        )

        fact_candidates = await hybrid_fact_search(
            self.driver,
            self.embedder,
            query,
            group_id,
            fact_fetch_limit,
            filters,
            include_expired=include_expired_facts,
        )

        if domain_filters:
            domain_limit = max(1, min(self.search_domain_limit, node_fetch_limit))
            domain_tasks = []
            for domain_filter in domain_filters:
                merged_filter = merge_filters(filters, domain_filter)
                if rerank_method in ("episode_mentions", "recency"):
                    domain_tasks.append(
                        hybrid_node_search(
                            self.driver,
                            self.embedder,
                            query,
                            group_id,
                            domain_limit,
                            merged_filter,
                            rerank_method=rerank_method,
                            rerank_alpha=rerank_alpha,
                        )
                    )
                else:
                    domain_tasks.append(
                        hybrid_node_search(
                            self.driver,
                            self.embedder,
                            query,
                            group_id,
                            domain_limit,
                            merged_filter,
                        )
                    )

            domain_node_lists = await asyncio.gather(*domain_tasks)
            merge_limit = max(len(node_candidates), node_fetch_limit)
            node_candidates = _merge_ranked_items(
                [node_candidates] + list(domain_node_lists),
                merge_limit,
            )

            if any(domain_filter.edge_types for domain_filter in domain_filters):
                edge_tasks = []
                edge_domain_limit = max(1, min(self.search_domain_limit, edge_fetch_limit))
                for domain_filter in domain_filters:
                    merged_filter = merge_filters(filters, domain_filter)
                    edge_tasks.append(
                        hybrid_edge_search(
                            self.driver,
                            self.embedder,
                            query,
                            group_id,
                            edge_domain_limit,
                            merged_filter,
                        )
                    )
                domain_edge_lists = await asyncio.gather(*edge_tasks)
                edge_candidates = _merge_ranked_items(
                    [edge_candidates] + list(domain_edge_lists),
                    edge_fetch_limit,
                )

        # Apply reranking if requested (for MMR, distance, and cross-encoder methods)
        if rerank_method == "mmr" and node_candidates:
            ranked_nodes = mmr_rerank(
                node_candidates, query_embedding, lambda_param, node_fetch_limit
            )
        elif rerank_method == "distance" and center_node_uuid and node_candidates:
            node_uuids = [n.uuid for n in node_candidates]
            distances = await calculate_node_distances(
                self.driver, center_node_uuid, node_uuids, group_id
            )
            ranked_nodes = node_distance_reranker(node_candidates, center_node_uuid, distances)
            ranked_nodes = ranked_nodes[:node_fetch_limit]
        elif rerank_method in ("cross_encoder", "cross-encoder") and node_candidates:
            if self.cross_encoder:
                ranked_nodes = await cross_encoder_rerank(
                    node_candidates, query, self.cross_encoder, node_fetch_limit
                )
                edge_candidates = await cross_encoder_rerank(
                    edge_candidates, query, self.cross_encoder, edge_fetch_limit
                )
                fact_candidates = await cross_encoder_rerank(
                    fact_candidates, query, self.cross_encoder, fact_fetch_limit
                )
            else:
                logger.warning("Cross-encoder rerank requested but no scorer is configured")
                ranked_nodes = node_candidates[:node_fetch_limit]
        else:
            ranked_nodes = node_candidates[:node_fetch_limit]

        # Apply recency boost if requested (separate from rerank_method="recency")
        primary_nodes = ranked_nodes[:primary_limit]
        primary_edges = edge_candidates[:primary_limit]

        bfs_nodes: list[EntityNode] = []
        bfs_edges: list[EntityEdge] = []
        if bfs_slots > 0:
            seed_uuids = _collect_bfs_seed_uuids(
                primary_nodes,
                primary_edges,
                self.search_bfs_seed_limit,
            )
            if self.search_recent_episode_limit > 0 and self.search_bfs_episode_seed_limit > 0:
                episode_seeds = await self.driver.get_recent_episode_entity_uuids(
                    group_id=group_id,
                    limit_episodes=self.search_recent_episode_limit,
                    limit_entities=self.search_bfs_episode_seed_limit,
                    conversation_id=conversation_id,
                )
                seed_uuids = _extend_seed_uuids(
                    seed_uuids,
                    episode_seeds,
                    self.search_bfs_seed_limit + self.search_bfs_episode_seed_limit,
                )
            if seed_uuids:
                bfs_nodes, bfs_edges = await asyncio.gather(
                    node_bfs_search(
                        self.driver,
                        seed_uuids,
                        group_id,
                        self.search_bfs_max_depth,
                        self.search_bfs_limit,
                    ),
                    edge_bfs_search(
                        self.driver,
                        seed_uuids,
                        group_id,
                        self.search_bfs_max_depth,
                        self.search_bfs_limit,
                    ),
                )

        nodes = _select_with_bfs(ranked_nodes, bfs_nodes, limit, bfs_slots)
        edges = _select_with_bfs(edge_candidates, bfs_edges, limit, bfs_slots)
        facts = fact_candidates[:limit]

        if recency_weight > 0 and nodes:
            scored_nodes = score_by_recency(nodes)
            nodes = [node for node, score in sorted(scored_nodes, key=lambda x: x[1], reverse=True)]

        logger.info(
            "Search found {} nodes, {} edges, {} facts",
            len(nodes),
            len(edges),
            len(facts),
        )

        return SearchResults(nodes=nodes, edges=edges, facts=facts)

    async def search_facts(
        self,
        query: str,
        group_id: str = "default",
        limit: int = 10,
        filters: SearchFilters | None = None,
        include_expired: bool = False,
    ) -> list[FactNode]:
        """Search fact nodes only with optional filters."""
        if limit <= 0:
            return []

        return await hybrid_fact_search(
            self.driver,
            self.embedder,
            query,
            group_id,
            limit,
            filters,
            include_expired=include_expired,
        )

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

    async def search_communities(
        self,
        query: str,
        group_id: str = "default",
        limit: int = 10,
    ) -> list[CommunityNode]:
        """Search community nodes by name and summary."""
        return await fulltext_community_search(self.driver, query, group_id, limit)

    async def track_entity_retrievals(self, entity_uuids: list[str]) -> None:
        """Track that entities were retrieved for context."""
        if not entity_uuids:
            return
        await track_entity_retrieval(self.driver, entity_uuids)

    async def track_entity_citations(self, entity_uuids: list[str]) -> None:
        """Track that entities were cited in responses."""
        if not entity_uuids:
            return
        await track_entity_citation(self.driver, entity_uuids)

    async def get_edge_citations(
        self,
        edges: list[EntityEdge],
        group_id: str = "default",
        max_episodes_per_edge: int = 2,
    ) -> list[EdgeCitation]:
        """Fetch episodic citations for edges based on stored episode UUIDs."""
        if not edges or max_episodes_per_edge <= 0:
            return []

        edge_episode_ids: dict[str, list[str]] = {}
        all_episode_ids: list[str] = []
        for edge in edges:
            episode_ids = (edge.episodes or [])[:max_episodes_per_edge]
            edge_episode_ids[edge.uuid] = episode_ids
            all_episode_ids.extend(episode_ids)

        if not all_episode_ids:
            return []

        unique_episode_ids = list(dict.fromkeys(all_episode_ids))
        episodes = await self.driver.get_episodes_by_uuids(unique_episode_ids, group_id)
        episodes_by_uuid = {episode.uuid: episode for episode in episodes}

        citations = []
        for edge_uuid, episode_ids in edge_episode_ids.items():
            resolved = [
                episodes_by_uuid[episode_id]
                for episode_id in episode_ids
                if episode_id in episodes_by_uuid
            ]
            if resolved:
                citations.append(EdgeCitation(edge_uuid=edge_uuid, episodes=resolved))

        return citations

    async def get_fact_citations(
        self,
        facts: list[FactNode],
        group_id: str = "default",
        max_episodes_per_fact: int = 2,
    ) -> list[FactCitation]:
        """Fetch episodic citations for fact nodes based on stored episode UUIDs."""
        if not facts or max_episodes_per_fact <= 0:
            return []

        fact_episode_ids: dict[str, list[str]] = {}
        all_episode_ids: list[str] = []
        for fact in facts:
            episode_ids = (fact.episodes or [])[:max_episodes_per_fact]
            fact_episode_ids[fact.uuid] = episode_ids
            all_episode_ids.extend(episode_ids)

        if not all_episode_ids:
            return []

        unique_episode_ids = list(dict.fromkeys(all_episode_ids))
        episodes = await self.driver.get_episodes_by_uuids(unique_episode_ids, group_id)
        episodes_by_uuid = {episode.uuid: episode for episode in episodes}

        citations = []
        for fact_uuid, episode_ids in fact_episode_ids.items():
            resolved = [
                episodes_by_uuid[episode_id]
                for episode_id in episode_ids
                if episode_id in episodes_by_uuid
            ]
            if resolved:
                citations.append(FactCitation(fact_uuid=fact_uuid, episodes=resolved))

        return citations

    async def get_fact_roles(
        self,
        facts: list[FactNode],
        group_id: str = "default",
    ) -> dict[str, list[FactRoleDetail]]:
        """Fetch role edges for fact nodes and group them by fact UUID."""
        if not facts:
            return {}

        fact_uuids = [fact.uuid for fact in facts]
        roles = await self.driver.get_fact_roles(fact_uuids, group_id)

        roles_by_fact: dict[str, list[FactRoleDetail]] = {}
        for role in roles:
            roles_by_fact.setdefault(role.fact_uuid, []).append(role)

        return roles_by_fact

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
        community_results = await detector.build_communities(group_id, resolution)
        if not community_results:
            logger.info("No communities found to persist")
            return []

        await self.driver.delete_communities_by_group(group_id)
        for result in community_results:
            await self.driver.save_community_node(result.community)
            await self.driver.save_community_members(
                result.community.uuid, result.member_uuids, group_id
            )

        communities = [result.community for result in community_results]
        logger.info(f"Built {len(communities)} communities")
        return communities

    async def invalidate_stale_edges(
        self,
        *,
        group_id: str = "default",
        cutoff: datetime,
    ) -> int:
        """Invalidate edges whose last supporting episode is older than cutoff."""
        if cutoff is None:
            return 0

        results = await self.driver.execute_query(
            """
            MATCH ()-[r:RELATES_TO]->()
            WHERE r.group_id = $group_id AND r.invalid_at IS NULL
            WITH r
            OPTIONAL MATCH (e:Episodic)
            WHERE e.uuid IN coalesce(r.episodes, [])
            WITH r, max(e.created_at) AS last_seen
            WHERE last_seen IS NOT NULL AND last_seen < $cutoff
            SET r.invalid_at = $cutoff
            RETURN count(r) AS updated
            """,
            group_id=group_id,
            cutoff=cutoff,
        )

        updated = int(results[0]["updated"]) if results else 0
        logger.info("Invalidated {} stale edges for group {}", updated, group_id)
        return updated

    async def invalidate_stale_facts(
        self,
        *,
        group_id: str = "default",
        cutoff: datetime,
    ) -> int:
        """Invalidate facts whose last supporting episode is older than cutoff."""
        if cutoff is None:
            return 0

        results = await self.driver.execute_query(
            """
            MATCH (f:Fact)
            WHERE f.group_id = $group_id AND f.invalid_at IS NULL
            WITH f
            OPTIONAL MATCH (e:Episodic)
            WHERE e.uuid IN coalesce(f.episodes, [])
            WITH f, max(e.created_at) AS last_seen
            WHERE last_seen IS NOT NULL AND last_seen < $cutoff
            SET f.invalid_at = $cutoff
            RETURN count(f) AS updated
            """,
            group_id=group_id,
            cutoff=cutoff,
        )

        updated = int(results[0]["updated"]) if results else 0
        logger.info("Invalidated {} stale facts for group {}", updated, group_id)
        return updated

    async def invalidate_low_quality_facts(
        self,
        *,
        group_id: str = "default",
        cutoff: datetime,
        quality_threshold: float = 0.1,
        min_retrievals: int = 5,
    ) -> int:
        """Invalidate facts with poor retrieval quality after cutoff."""
        if cutoff is None:
            return 0

        now = datetime.now(UTC)
        results = await self.driver.execute_query(
            """
            MATCH (f:Fact)
            WHERE f.group_id = $group_id
              AND f.invalid_at IS NULL
              AND f.created_at < $cutoff
            WITH f,
                 coalesce(f.retrieval_count, 0) AS retrievals,
                 coalesce(f.citation_count, 0) AS citations
            WHERE retrievals >= $min_retrievals
            WITH f, retrievals, citations,
                 CASE WHEN retrievals = 0 THEN 0
                      ELSE toFloat(citations) / retrievals
                 END AS quality
            WHERE quality < $quality_threshold
            SET f.invalid_at = $now
            RETURN count(f) AS updated
            """,
            group_id=group_id,
            cutoff=cutoff,
            min_retrievals=min_retrievals,
            quality_threshold=quality_threshold,
            now=now,
        )

        updated = int(results[0]["updated"]) if results else 0
        logger.info("Invalidated {} low-quality facts for group {}", updated, group_id)
        return updated

    async def merge_duplicate_entities(
        self,
        *,
        group_id: str = "default",
        limit: int = 50,
    ) -> int:
        """Merge entity nodes that share the same normalized name."""
        records = await self.driver.execute_query(
            """
            MATCH (n:Entity)
            WHERE n.group_id = $group_id
            WITH toLower(n.name) AS norm, collect(n.uuid) AS uuids
            WHERE size(uuids) > 1
            RETURN norm, uuids
            LIMIT $limit
            """,
            group_id=group_id,
            limit=limit,
        )

        def _parse_date(value: object) -> datetime:
            if isinstance(value, datetime):
                return value
            if isinstance(value, str):
                text = value.strip()
                if text.endswith("Z"):
                    text = text.replace("Z", "+00:00")
                try:
                    return datetime.fromisoformat(text)
                except Exception:
                    return datetime.min.replace(tzinfo=UTC)
            return datetime.min.replace(tzinfo=UTC)

        merged = 0
        for record in records:
            uuids = record.get("uuids") or []
            nodes = []
            for uuid in uuids:
                node = await self.driver.get_entity_by_uuid(uuid)
                if node:
                    nodes.append(node)
            if len(nodes) < 2:
                continue

            nodes.sort(
                key=lambda n: (
                    -(n.mention_count or 0),
                    _parse_date(n.created_at),
                )
            )
            primary = nodes[0]

            for duplicate in nodes[1:]:
                if set(primary.labels) != set(duplicate.labels):
                    continue
                conflict = False
                for key, value in (duplicate.attributes or {}).items():
                    if key in primary.attributes and primary.attributes[key] != value:
                        conflict = True
                        break
                if conflict:
                    continue

                aliases = set(primary.aliases or [])
                aliases.update(duplicate.aliases or [])
                if duplicate.name:
                    aliases.add(duplicate.name)
                if primary.name in aliases:
                    aliases.remove(primary.name)
                primary.aliases = sorted(aliases)

                if not primary.summary and duplicate.summary:
                    primary.summary = duplicate.summary

                for key, value in (duplicate.attributes or {}).items():
                    if key not in primary.attributes:
                        primary.attributes[key] = value

                primary.mention_count = (primary.mention_count or 0) + (
                    duplicate.mention_count or 0
                )
                primary.retrieval_count = (primary.retrieval_count or 0) + (
                    duplicate.retrieval_count or 0
                )
                primary.citation_count = (primary.citation_count or 0) + (
                    duplicate.citation_count or 0
                )
                if primary.retrieval_count:
                    primary.retrieval_quality = (
                        primary.citation_count / primary.retrieval_count
                    )
                if duplicate.last_mentioned:
                    if not primary.last_mentioned or duplicate.last_mentioned > primary.last_mentioned:
                        primary.last_mentioned = duplicate.last_mentioned
                if duplicate.created_at and duplicate.created_at < primary.created_at:
                    primary.created_at = duplicate.created_at

                primary.labels = sorted(set(primary.labels) | set(duplicate.labels))

                await self.driver.save_entity_node(primary)
                await self.driver.merge_entity_nodes(primary.uuid, duplicate.uuid)
                merged += 1

        if merged:
            logger.info("Merged {} duplicate entity nodes for group {}", merged, group_id)
        return merged

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

    async def add_fact(
        self,
        fact: str,
        *,
        group_id: str = "default",
        source: str | None = None,
        tags: list[str] | None = None,
        valid_at: datetime | None = None,
        invalid_at: datetime | None = None,
        attributes: dict[str, Any] | None = None,
        archival: bool = False,
    ) -> tuple[FactNode, bool]:
        """Manually add a fact node without entity extraction."""
        fact_text = fact.strip()
        if not fact_text:
            raise ValueError("Fact text cannot be empty")

        merged_attributes = dict(attributes or {})
        if archival:
            merged_attributes["archival"] = True

        def _merge_list_attr(
            attrs: dict[str, Any],
            key: str,
            values: list[str] | None,
        ) -> None:
            if not values:
                return
            existing = attrs.get(key)
            if existing is None:
                merged = []
            elif isinstance(existing, list):
                merged = list(existing)
            else:
                merged = [existing]
            for value in values:
                if value and value not in merged:
                    merged.append(value)
            if merged:
                attrs[key] = merged

        if source:
            _merge_list_attr(merged_attributes, "sources", [source])
        _merge_list_attr(merged_attributes, "tags", tags)

        existing_fact = await self.driver.get_fact_by_text(fact_text, group_id)
        created = existing_fact is None

        if existing_fact:
            fact_node = existing_fact
            fact_node.attributes = dict(fact_node.attributes or {})
            for key, value in merged_attributes.items():
                if key in ("sources", "tags"):
                    values = value if isinstance(value, list) else [value]
                    _merge_list_attr(fact_node.attributes, key, values)
                    continue
                if key not in fact_node.attributes:
                    fact_node.attributes[key] = value
            if archival:
                fact_node.attributes["archival"] = True
            if valid_at is not None and fact_node.valid_at is None:
                fact_node.valid_at = valid_at
            if invalid_at is not None and fact_node.invalid_at is None:
                fact_node.invalid_at = invalid_at
        else:
            fact_node = FactNode(
                name=fact_text,
                fact=fact_text,
                group_id=group_id,
                attributes=merged_attributes,
                valid_at=valid_at,
                invalid_at=invalid_at,
                episodes=[],
            )

        if fact_node.fact_embedding is None:
            fact_node.fact_embedding = await self.embedder.create(fact_text.replace("\n", " "))

        await self.driver.save_fact_node(fact_node)
        return fact_node, created

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

    async def get_facts_at_time(
        self,
        timestamp: datetime,
        group_id: str = "default",
        limit: int = 100,
    ) -> list[FactNode]:
        """Get fact nodes that were valid at a specific point in time."""
        return await self.driver.get_facts_at_time(timestamp, group_id, limit)

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
        if result:
            return result[0]["deleted"]
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

    async def _generate_conversation_id(
        self,
        current_timestamp: datetime,
        source_description: str,
        group_id: str,
    ) -> str:
        """Generate conversation ID with idle detection.

        Creates new conversation boundaries when messages are separated by
        more than idle_threshold_minutes.

        Args:
            current_timestamp: Timestamp of current episode
            source_description: Source description to match (e.g., Discord channel ID)
            group_id: Graph partition

        Returns:
            Conversation ID to use (either reused or new)
        """
        from datetime import timedelta

        # Query for most recent episode with same source
        query = """
        MATCH (e:Episode)
        WHERE e.source_description = $source_description
          AND e.group_id = $group_id
        RETURN e.conversation_id AS conversation_id,
               e.valid_at AS valid_at
        ORDER BY e.valid_at DESC
        LIMIT 1
        """

        result = await self.driver.execute_query(
            query,
            source_description=source_description,
            group_id=group_id,
        )

        if result:
            last_conversation_id = result[0]["conversation_id"]
            last_valid_at_str = result[0]["valid_at"]

            if last_valid_at_str:
                last_valid_at = datetime.fromisoformat(last_valid_at_str)
                time_gap = current_timestamp - last_valid_at

                # Reuse conversation_id if within idle threshold
                if time_gap <= timedelta(minutes=self.idle_threshold_minutes):
                    logger.debug(
                        f"Reusing conversation_id '{last_conversation_id}' "
                        f"(gap: {time_gap.total_seconds() / 60:.1f}m)"
                    )
                    return last_conversation_id

        # Generate new conversation ID (ISO date + source)
        new_conversation_id = f"{current_timestamp.date().isoformat()}_{source_description}"
        logger.debug(f"Created new conversation_id: {new_conversation_id}")
        return new_conversation_id
