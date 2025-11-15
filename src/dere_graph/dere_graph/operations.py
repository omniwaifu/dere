from __future__ import annotations

from datetime import UTC, datetime

from loguru import logger

from dere_graph.driver import FalkorDriver
from dere_graph.embeddings import OpenAIEmbedder
from dere_graph.llm_client import ClaudeClient
from dere_graph.models import EntityEdge, EntityNode, EpisodicEdge, EpisodicNode
from dere_graph.prompts import (
    EdgeDuplicate,
    ExtractedEdges,
    ExtractedEntities,
    NodeResolutions,
    dedupe_edges,
    dedupe_entities,
    extract_edges,
    extract_entities_text,
)


async def add_episode(
    driver: FalkorDriver,
    llm_client: ClaudeClient,
    embedder: OpenAIEmbedder,
    episode: EpisodicNode,
    previous_episodes: list[EpisodicNode] | None = None,
    postgres_driver=None,
    enable_reflection: bool = True,
) -> tuple[list[EntityNode], list[EntityEdge]]:
    """Main ingestion pipeline for adding an episode to the graph.

    Returns:
        tuple: (new_nodes, new_edges) created during ingestion
    """
    if previous_episodes is None:
        # Fetch recent episodes for context in entity deduplication
        previous_episodes = await driver.get_recent_episodes(episode.group_id, limit=5)

    # 1. Save episode to Neo4j
    await driver.save_episodic_node(episode)
    logger.info(f"Saved episode: {episode.uuid}")

    # 2. Extract entities
    extracted_nodes = await extract_nodes(llm_client, episode, previous_episodes, enable_reflection)
    if not extracted_nodes:
        logger.info("No entities extracted")
        return [], []

    # 3. Deduplicate entities
    resolved_nodes, uuid_map = await deduplicate_nodes(
        driver,
        llm_client,
        embedder,
        extracted_nodes,
        episode,
        previous_episodes,
    )

    # 4. Extract relationships between entities
    entity_edges = await extract_entity_edges(
        llm_client,
        episode,
        resolved_nodes,
        previous_episodes,
    )

    # 5. Deduplicate edges
    deduped_edges = await deduplicate_edges_batch(
        driver,
        llm_client,
        entity_edges,
    )

    # 6. Generate embeddings for nodes and edges
    # Find nodes that need embeddings (either new or existing without embeddings)
    nodes_needing_embeddings = [node for node in resolved_nodes if node.name_embedding is None]
    if nodes_needing_embeddings:
        await generate_node_embeddings(embedder, nodes_needing_embeddings)

    # Determine which are truly new nodes (not deduplicated to existing)
    new_node_uuids = {k for k, v in uuid_map.items() if k == v}
    new_nodes = [node for node in resolved_nodes if node.uuid in new_node_uuids]

    if deduped_edges:
        await generate_edge_embeddings(embedder, deduped_edges)

    # 7. Save to FalkorDB and Postgres
    await save_nodes_and_edges(
        driver, new_nodes, deduped_edges, episode, resolved_nodes, postgres_driver
    )

    logger.info(f"Ingestion complete: {len(new_nodes)} new nodes, {len(deduped_edges)} edges")

    # Return the created nodes and edges
    return new_nodes, deduped_edges


async def extract_nodes(
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    previous_episodes: list[EpisodicNode] | None = None,
    enable_reflection: bool = True,
) -> list[EntityNode]:
    """Extract entity nodes from episode content with optional reflection validation."""
    # Initial extraction
    messages = extract_entities_text(
        episode.content,
        speaker_id=episode.speaker_id,
        speaker_name=episode.speaker_name,
        personality=episode.personality,
    )

    response = await llm_client.generate_response(messages, ExtractedEntities)

    extracted_nodes = []
    for entity in response.extracted_entities:
        if not entity.name.strip():
            continue

        node = EntityNode(
            name=entity.name,
            group_id=episode.group_id,
            labels=["Entity"] + ([entity.entity_type] if entity.entity_type else []),
            summary="",
            attributes=entity.attributes,
            aliases=entity.aliases,
        )
        extracted_nodes.append(node)

    logger.debug(f"Extracted {len(extracted_nodes)} entities (initial pass)")

    # Reflection validation pass
    if enable_reflection and extracted_nodes and previous_episodes:
        from dere_graph.prompts import EntityValidation, validate_extracted_entities

        # Convert nodes to dict format for prompt
        entity_dicts = [
            {"name": node.name, "summary": node.summary or "No summary"} for node in extracted_nodes
        ]

        # Get previous episode content strings
        prev_episode_strings = [ep.content for ep in previous_episodes]

        reflection_messages = validate_extracted_entities(
            entity_dicts,
            episode.content,
            prev_episode_strings,
        )

        validation = await llm_client.generate_response(reflection_messages, EntityValidation)

        # Process validation results
        # 1. Remove hallucinated entities
        if validation.hallucinated_entities:
            extracted_nodes = [
                node
                for node in extracted_nodes
                if node.name not in validation.hallucinated_entities
            ]
            logger.debug(f"Removed {len(validation.hallucinated_entities)} hallucinated entities")

        # 2. Add missed entities
        if validation.missed_entities:
            for missed in validation.missed_entities:
                node = EntityNode(
                    name=missed.name,
                    group_id=episode.group_id,
                    labels=["Entity"],
                    summary=missed.summary,
                    attributes={},
                    aliases=[],
                )
                extracted_nodes.append(node)
            logger.debug(f"Added {len(validation.missed_entities)} missed entities")

        # 3. Apply refinements
        if validation.refinements:
            for refinement in validation.refinements:
                for node in extracted_nodes:
                    if node.name == refinement.original_name:
                        if refinement.refined_name:
                            node.name = refinement.refined_name
                        if refinement.refined_summary:
                            node.summary = refinement.refined_summary
                        break
            logger.debug(f"Applied {len(validation.refinements)} entity refinements")

    logger.debug(f"Final: {len(extracted_nodes)} entities after reflection")
    return extracted_nodes


async def deduplicate_nodes(
    driver: FalkorDriver,
    llm_client: ClaudeClient,
    embedder: OpenAIEmbedder,
    extracted_nodes: list[EntityNode],
    episode: EpisodicNode,
    previous_episodes: list[EpisodicNode],
) -> tuple[list[EntityNode], dict[str, str]]:
    """Deduplicate extracted nodes against existing nodes in the database."""
    # Search for existing similar nodes
    existing_candidates = await search_similar_nodes(driver, embedder, extracted_nodes)

    if not existing_candidates:
        return extracted_nodes, {node.uuid: node.uuid for node in extracted_nodes}

    # Get episodes that mention the candidate entities (entity-relevant context)
    candidate_uuids = [node.uuid for node in existing_candidates]
    relevant_episodes = await driver.get_episodes_for_entities(
        entity_uuids=candidate_uuids, group_id=episode.group_id, limit=10
    )

    # Fallback to previous episodes if no entity-relevant episodes found
    context_episodes = relevant_episodes if relevant_episodes else previous_episodes

    # Use LLM to determine duplicates
    extracted_contexts = [
        {"id": i, "name": node.name, "entity_type": node.labels, "attributes": node.attributes}
        for i, node in enumerate(extracted_nodes)
    ]

    existing_contexts = [
        {
            "idx": i,
            "name": node.name,
            "entity_types": node.labels,
            "summary": node.summary,
            "attributes": node.attributes,
        }
        for i, node in enumerate(existing_candidates)
    ]

    messages = dedupe_entities(
        extracted_contexts,
        existing_contexts,
        episode.content,
        [ep.content for ep in context_episodes],
    )

    response = await llm_client.generate_response(messages, NodeResolutions)

    # Build resolution map
    resolved_nodes = []
    uuid_map = {}

    for resolution in response.entity_resolutions:
        extracted_node = extracted_nodes[resolution.id]

        if resolution.duplicate_idx >= 0 and resolution.duplicate_idx < len(existing_candidates):
            # It's a duplicate - use existing node and increment mention_count
            resolved_node = existing_candidates[resolution.duplicate_idx]
            resolved_node.mention_count = (resolved_node.mention_count or 1) + 1
            uuid_map[extracted_node.uuid] = resolved_node.uuid
        else:
            # It's new - initialize with mention_count=1
            resolved_node = extracted_node
            resolved_node.mention_count = 1
            uuid_map[extracted_node.uuid] = extracted_node.uuid

        resolved_nodes.append(resolved_node)

    logger.debug(
        f"Resolved {len(resolved_nodes)} nodes, {len([v for k, v in uuid_map.items() if k != v])} duplicates found"
    )
    return resolved_nodes, uuid_map


async def search_similar_nodes(
    driver: FalkorDriver,
    embedder: OpenAIEmbedder,
    nodes: list[EntityNode],
) -> list[EntityNode]:
    """Search for existing nodes similar to extracted nodes using hybrid search."""
    from dere_graph.search import hybrid_node_search

    candidates = []
    seen_uuids = set()

    for node in nodes:
        # Search for similar nodes by name using hybrid search
        similar_nodes = await hybrid_node_search(
            driver,
            embedder,
            node.name,
            node.group_id,
            limit=5,
        )

        # Add unique candidates
        for similar_node in similar_nodes:
            if similar_node.uuid not in seen_uuids:
                candidates.append(similar_node)
                seen_uuids.add(similar_node.uuid)

    return candidates


async def extract_entity_edges(
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    nodes: list[EntityNode],
    previous_episodes: list[EpisodicNode],
) -> list[EntityEdge]:
    """Extract relationships between entities."""
    if len(nodes) < 2:
        logger.debug("Not enough entities to extract relationships")
        return []

    nodes_context = [
        {"id": i, "name": node.name, "entity_types": node.labels} for i, node in enumerate(nodes)
    ]

    messages = extract_edges(
        episode.content,
        [ep.content for ep in previous_episodes],
        nodes_context,
        episode.valid_at.isoformat(),
    )

    response = await llm_client.generate_response(messages, ExtractedEdges)

    edges = []
    for edge_data in response.edges:
        if not edge_data.fact.strip():
            continue

        source_idx = edge_data.source_entity_id
        target_idx = edge_data.target_entity_id

        if not (0 <= source_idx < len(nodes) and 0 <= target_idx < len(nodes)):
            logger.warning(f"Invalid entity IDs in edge: {source_idx}, {target_idx}")
            continue

        if source_idx == target_idx:
            logger.warning("Self-referencing edge, skipping")
            continue

        # Parse dates
        valid_at = None
        invalid_at = None
        if edge_data.valid_at:
            try:
                valid_at = datetime.fromisoformat(edge_data.valid_at.replace("Z", "+00:00"))
            except Exception as e:
                logger.warning(f"Failed to parse valid_at: {e}")

        if edge_data.invalid_at:
            try:
                invalid_at = datetime.fromisoformat(edge_data.invalid_at.replace("Z", "+00:00"))
            except Exception as e:
                logger.warning(f"Failed to parse invalid_at: {e}")

        edge = EntityEdge(
            source_node_uuid=nodes[source_idx].uuid,
            target_node_uuid=nodes[target_idx].uuid,
            name=edge_data.relation_type,
            fact=edge_data.fact,
            group_id=episode.group_id,
            valid_at=valid_at,
            invalid_at=invalid_at,
            episodes=[episode.uuid],
            strength=edge_data.strength,
        )
        edges.append(edge)

    logger.debug(f"Extracted {len(edges)} entity edges")
    return edges


async def deduplicate_edges_batch(
    driver: FalkorDriver,
    llm_client: ClaudeClient,
    edges: list[EntityEdge],
) -> list[EntityEdge]:
    """Deduplicate edges against existing edges in database."""
    if not edges:
        return []

    deduped_edges = []

    for edge in edges:
        # Get existing edges between these two nodes
        existing_edges = await driver.get_existing_edges(
            edge.source_node_uuid,
            edge.target_node_uuid,
            edge.group_id,
        )

        if not existing_edges:
            # No existing edges, add as new
            deduped_edges.append(edge)
            continue

        # Split existing edges into active and potential invalidation candidates
        active_edges = [e for e in existing_edges if e.invalid_at is None]
        invalidation_candidates = [e for e in existing_edges if e.invalid_at is None]

        # Prepare edge data for LLM
        new_edge_data = {
            "relation_type": edge.name,
            "fact": edge.fact,
            "valid_at": edge.valid_at.isoformat() if edge.valid_at else None,
            "invalid_at": edge.invalid_at.isoformat() if edge.invalid_at else None,
        }

        existing_edges_data = [
            {
                "idx": i,
                "relation_type": e.name,
                "fact": e.fact,
                "valid_at": e.valid_at.isoformat() if e.valid_at else None,
                "invalid_at": e.invalid_at.isoformat() if e.invalid_at else None,
            }
            for i, e in enumerate(active_edges)
        ]

        invalidation_candidates_data = [
            {
                "idx": i,
                "relation_type": e.name,
                "fact": e.fact,
                "valid_at": e.valid_at.isoformat() if e.valid_at else None,
            }
            for i, e in enumerate(invalidation_candidates)
        ]

        # Call LLM to detect duplicates and contradictions
        messages = dedupe_edges(
            new_edge_data,
            existing_edges_data,
            invalidation_candidates_data,
        )

        response = await llm_client.generate_response(messages, EdgeDuplicate)

        # Handle contradictions - invalidate contradicted edges
        if response.contradicted_facts:
            for idx in response.contradicted_facts:
                if 0 <= idx < len(invalidation_candidates):
                    contradicted_edge = invalidation_candidates[idx]
                    await driver.invalidate_edge(
                        contradicted_edge.uuid,
                        edge.valid_at or datetime.now(UTC),
                    )
                    logger.info(
                        f"Invalidated edge {contradicted_edge.uuid} due to contradiction with new edge"
                    )

        # Handle duplicates - merge with existing edge
        if response.duplicate_facts:
            # Find the first duplicate to merge with
            duplicate_idx = response.duplicate_facts[0]
            if 0 <= duplicate_idx < len(active_edges):
                existing_edge = active_edges[duplicate_idx]
                # Add current episode to existing edge's episodes
                if edge.episodes and edge.episodes[0] not in existing_edge.episodes:
                    existing_edge.episodes.append(edge.episodes[0])
                    # Update the edge in database
                    await driver.save_entity_edge(existing_edge)
                    logger.debug(f"Merged edge with existing edge {existing_edge.uuid}")
                continue  # Don't add as new edge

        # Not a duplicate, add as new edge
        deduped_edges.append(edge)

    logger.debug(f"Deduplicated {len(edges)} edges to {len(deduped_edges)} new edges")
    return deduped_edges


async def generate_node_embeddings(
    embedder: OpenAIEmbedder,
    nodes: list[EntityNode],
) -> None:
    """Generate embeddings for entity nodes."""
    if not nodes:
        return

    names = [node.name.replace("\n", " ") for node in nodes]
    embeddings = await embedder.create_batch(names)

    for node, embedding in zip(nodes, embeddings):
        node.name_embedding = embedding

    logger.debug(f"Generated embeddings for {len(nodes)} nodes")


async def generate_edge_embeddings(
    embedder: OpenAIEmbedder,
    edges: list[EntityEdge],
) -> None:
    """Generate embeddings for entity edges."""
    if not edges:
        return

    facts = [edge.fact.replace("\n", " ") for edge in edges]
    embeddings = await embedder.create_batch(facts)

    for edge, embedding in zip(edges, embeddings):
        edge.fact_embedding = embedding

    logger.debug(f"Generated embeddings for {len(edges)} edges")


async def save_nodes_and_edges(
    driver: FalkorDriver,
    new_nodes: list[EntityNode],
    edges: list[EntityEdge],
    episode: EpisodicNode,
    all_nodes: list[EntityNode],
    postgres_driver=None,
) -> None:
    """Save nodes and edges to FalkorDB and optionally sync to Postgres."""
    # Save/update all nodes that have embeddings (new or deduplicated with fresh embeddings)
    nodes_with_embeddings = [node for node in all_nodes if node.name_embedding is not None]
    for node in nodes_with_embeddings:
        # Update last_mentioned timestamp
        node.last_mentioned = episode.created_at
        await driver.save_entity_node(node)

        # Sync to Postgres if enabled
        if postgres_driver:
            await postgres_driver.save_entity_attributes(
                entity=node,
                last_discussed_at=episode.valid_at,
            )

    # Save entity edges
    for edge in edges:
        await driver.save_entity_edge(edge)

    # Save episodic edges (episode -> entities mentioned)
    for node in all_nodes:
        episodic_edge = EpisodicEdge(
            source_node_uuid=episode.uuid,
            target_node_uuid=node.uuid,
            group_id=episode.group_id,
        )
        await driver.save_episodic_edge(episodic_edge)

    logger.debug(
        f"Saved {len(nodes_with_embeddings)} nodes (with embeddings), {len(edges)} entity edges, {len(all_nodes)} episodic edges"
    )


async def track_entity_retrieval(
    driver: FalkorDriver,
    entity_uuids: list[str],
) -> None:
    """Track that entities were retrieved in a search.

    Increments retrieval_count for retrospective quality tracking.

    Args:
        driver: FalkorDB driver instance
        entity_uuids: List of entity UUIDs that were retrieved
    """
    for uuid in entity_uuids:
        entity = await driver.get_entity_by_uuid(uuid)
        if entity:
            entity.retrieval_count += 1
            await driver.save_entity_node(entity)

    logger.debug(f"Tracked retrieval for {len(entity_uuids)} entities")


async def track_entity_citation(
    driver: FalkorDriver,
    entity_uuids: list[str],
) -> None:
    """Track that entities were cited/used in a response.

    Increments citation_count and updates retrieval_quality for
    retrospective quality tracking.

    Args:
        driver: FalkorDB driver instance
        entity_uuids: List of entity UUIDs that were cited in the response
    """
    for uuid in entity_uuids:
        entity = await driver.get_entity_by_uuid(uuid)
        if entity:
            entity.citation_count += 1

            # Update retrieval quality (success rate)
            if entity.retrieval_count > 0:
                entity.retrieval_quality = entity.citation_count / entity.retrieval_count

            await driver.save_entity_node(entity)

    logger.debug(f"Tracked citation for {len(entity_uuids)} entities")
