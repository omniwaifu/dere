from __future__ import annotations

from datetime import UTC, datetime

from loguru import logger
from pydantic import BaseModel

from dere_graph.driver import FalkorDriver
from dere_graph.embeddings import OpenAIEmbedder
from dere_graph.llm_client import ClaudeClient
from dere_graph.models import (
    EntityEdge,
    EntityNode,
    EpisodeType,
    EpisodicEdge,
    EpisodicNode,
    FactNode,
    FactRoleEdge,
    FactRoleDetail,
    apply_edge_schema,
    apply_entity_schema,
    validate_edge_types,
    validate_entity_types,
)
from dere_graph.prompts import (
    EdgeDateUpdates,
    EdgeDuplicate,
    FactDuplicate,
    EntityAttributeUpdates,
    EntitySummaries,
    ExtractedEdges,
    ExtractedFacts,
    ExtractedEntities,
    NodeResolutions,
    dedupe_edges,
    dedupe_entities,
    extract_edge_dates_batch,
    extract_edges,
    dedupe_facts,
    extract_facts,
    extract_entities_text,
    hydrate_entity_attributes,
    summarize_entities,
)


async def add_episode(
    driver: FalkorDriver,
    llm_client: ClaudeClient,
    embedder: OpenAIEmbedder,
    episode: EpisodicNode,
    previous_episodes: list[EpisodicNode] | None = None,
    postgres_driver=None,
    enable_reflection: bool = True,
    enable_attribute_hydration: bool = False,
    enable_edge_date_refinement: bool = False,
    entity_types: dict[str, type[BaseModel]] | None = None,
    excluded_entity_types: list[str] | None = None,
    edge_types: dict[str, type[BaseModel]] | None = None,
    excluded_edge_types: list[str] | None = None,
) -> tuple[list[EntityNode], list[EntityEdge], list[FactNode], list[FactRoleEdge]]:
    """Main ingestion pipeline for adding an episode to the graph.

    Returns:
        tuple: (new_nodes, new_edges, fact_nodes, fact_role_edges) created during ingestion
    """
    if entity_types:
        validate_entity_types(entity_types)
    if edge_types:
        validate_edge_types(edge_types)

    if previous_episodes is None:
        # Fetch recent episodes for context in entity deduplication
        previous_episodes = await driver.get_recent_episodes(episode.group_id, limit=5)

    # 1. Save episode to graph DB
    await driver.save_episodic_node(episode)
    logger.info(f"Saved episode: {episode.uuid}")

    # 2. Extract entities
    extracted_nodes = await extract_nodes(
        llm_client,
        episode,
        previous_episodes,
        enable_reflection,
        entity_types=entity_types,
        excluded_entity_types=excluded_entity_types,
    )
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

    if enable_attribute_hydration:
        await hydrate_node_attributes(
            llm_client,
            episode,
            resolved_nodes,
            previous_episodes or [],
            entity_types=entity_types,
        )

    if entity_types:
        for node in resolved_nodes:
            try:
                apply_entity_schema(node, entity_types)
            except Exception as e:
                logger.warning(f"[EntityExtraction] Entity schema validation skipped: {e}")

    # 4. Extract relationships between entities
    entity_edges = await extract_entity_edges(
        llm_client,
        episode,
        resolved_nodes,
        previous_episodes,
        edge_types=edge_types,
        excluded_edge_types=excluded_edge_types,
    )

    # 5. Deduplicate edges
    deduped_edges = await deduplicate_edges_batch(
        driver,
        llm_client,
        entity_edges,
    )

    if enable_edge_date_refinement and deduped_edges:
        await refine_edge_dates_batch(
            llm_client,
            episode,
            deduped_edges,
            previous_episodes or [],
        )

    if edge_types:
        for edge in deduped_edges:
            try:
                apply_edge_schema(edge, edge_types)
            except Exception as e:
                logger.warning(f"[EdgeExtraction] Edge schema validation skipped: {e}")

    # 6. Extract hyper-edge facts (n-ary facts with roles)
    fact_nodes, fact_role_edges = await extract_fact_nodes(
        driver,
        llm_client,
        episode,
        resolved_nodes,
        previous_episodes,
    )
    if fact_nodes:
        fact_nodes, fact_role_edges = await deduplicate_fact_nodes(
            driver,
            llm_client,
            episode,
            fact_nodes,
            fact_role_edges,
        )

    # 7. Generate embeddings for nodes, edges, and facts
    # Find nodes that need embeddings (either new or existing without embeddings)
    nodes_needing_embeddings = [node for node in resolved_nodes if node.name_embedding is None]
    if nodes_needing_embeddings:
        await generate_node_embeddings(embedder, nodes_needing_embeddings)

    # Determine which are truly new nodes (not deduplicated to existing)
    new_node_uuids = {k for k, v in uuid_map.items() if k == v}
    new_nodes = [node for node in resolved_nodes if node.uuid in new_node_uuids]

    if deduped_edges:
        await generate_edge_embeddings(embedder, deduped_edges)

    facts_needing_embeddings = [fact for fact in fact_nodes if fact.fact_embedding is None]
    if facts_needing_embeddings:
        await generate_fact_embeddings(embedder, facts_needing_embeddings)

    # 8. Save to FalkorDB and Postgres
    await save_nodes_and_edges(
        driver,
        new_nodes,
        deduped_edges,
        episode,
        resolved_nodes,
        postgres_driver,
        fact_nodes=fact_nodes,
        fact_role_edges=fact_role_edges,
    )

    logger.info(
        "Ingestion complete: {} new nodes, {} edges, {} facts",
        len(new_nodes),
        len(deduped_edges),
        len(fact_nodes),
    )

    # Return the created nodes and edges
    return new_nodes, deduped_edges, fact_nodes, fact_role_edges


async def extract_nodes(
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    previous_episodes: list[EpisodicNode] | None = None,
    enable_reflection: bool = True,
    entity_types: dict[str, type[BaseModel]] | None = None,
    excluded_entity_types: list[str] | None = None,
) -> list[EntityNode]:
    """Extract entity nodes from episode content with optional reflection validation."""
    def ensure_speaker_first(nodes: list[EntityNode]) -> list[EntityNode]:
        """Ensure the speaker entity exists and is the first node (Graphiti-style)."""
        speaker_name = (episode.speaker_name or "").strip()
        if not speaker_name:
            return nodes

        speaker_id = (episode.speaker_id or "").strip()

        # Prefer an extracted node matching the speaker name.
        speaker_idx = next(
            (i for i, node in enumerate(nodes) if node.name.strip().lower() == speaker_name.lower()),
            None,
        )
        if speaker_idx is not None:
            speaker_node = nodes.pop(speaker_idx)
        else:
            speaker_node = EntityNode(
                name=speaker_name,
                group_id=episode.group_id,
                labels=["User"],
                summary="",
                attributes={},
                aliases=[],
            )

        speaker_node.attributes.setdefault("is_speaker", True)
        if speaker_id:
            speaker_node.attributes.setdefault("user_id", speaker_id)
        if not speaker_node.labels:
            speaker_node.labels = ["User"]

        return [speaker_node, *nodes]

    # Initial extraction
    prev_episode_strings = [ep.content for ep in (previous_episodes or [])][-4:]
    episode_content = episode.content
    custom_prompt = ""
    if episode.source == EpisodeType.json:
        import json

        try:
            parsed = json.loads(episode.content)
            episode_content = json.dumps(parsed, indent=2, ensure_ascii=False, sort_keys=True)
        except Exception:
            episode_content = episode.content

        custom_prompt = f"""
This episode source is JSON from: {episode.source_description}

Treat CURRENT_MESSAGE as a JSON payload, not a conversation.
- Extract entities representing meaningful objects, identifiers, resources, people, orgs, repos, files, tasks, and durable concepts.
- Do NOT create entities for trivial keys, single primitive values, timestamps, or purely structural JSON fields.
"""
    elif episode.source == EpisodeType.code:
        custom_prompt = f"""
This episode source is CODE from: {episode.source_description}

Treat CURRENT_MESSAGE as source code, not a conversation.
- Extract entities like repositories/projects, file/module names, symbols (classes/functions), libraries/frameworks, error types/messages, and key domain concepts.
- Avoid extracting every variable or local identifier unless it is clearly important/durable (e.g., public API, config keys).
"""
    elif episode.source == EpisodeType.doc:
        custom_prompt = f"""
This episode source is DOCUMENTATION from: {episode.source_description}

Treat CURRENT_MESSAGE as documentation/notes.
- Extract entities like products, libraries, commands, APIs, configuration keys, concepts, and durable decisions.
- Avoid extracting generic words that don't add retrieval value.
"""

    messages = extract_entities_text(
        episode_content,
        previous_episodes=prev_episode_strings,
        custom_prompt=custom_prompt,
        speaker_id=episode.speaker_id,
        speaker_name=episode.speaker_name,
        personality=episode.personality,
        entity_types=list(entity_types.keys()) if entity_types else None,
        excluded_entity_types=excluded_entity_types,
    )

    response = await llm_client.generate_response(messages, ExtractedEntities)

    logger.debug("[EntityExtraction] === INITIAL EXTRACTION ===")
    extracted_nodes = []
    allowed_type_names = set(entity_types.keys()) if entity_types else None
    for entity in response.extracted_entities:
        if not entity.name.strip():
            continue

        entity_type = entity.entity_type.strip() if entity.entity_type else None

        node = EntityNode(
            name=entity.name,
            group_id=episode.group_id,
            labels=([entity_type] if entity_type else []),
            summary="",
            attributes=entity.attributes,
            aliases=entity.aliases,
        )

        if allowed_type_names and node.labels and node.labels[0] not in allowed_type_names:
            logger.debug(
                f"[EntityExtraction] Dropping unknown entity_type '{node.labels[0]}' for entity '{node.name}'"
            )
            node.labels = []

        if entity_types:
            try:
                apply_entity_schema(node, entity_types)
            except Exception as e:
                logger.warning(f"[EntityExtraction] Entity schema validation skipped: {e}")

        extracted_nodes.append(node)

        # Log each extracted entity
        logger.debug(
            f"[EntityExtraction] - {entity.name} "
            f"(type: {entity.entity_type or 'untyped'}, "
            f"aliases: {entity.aliases}, "
            f"attrs: {list(entity.attributes.keys()) if entity.attributes else []})"
        )

    logger.debug(f"[EntityExtraction] Extracted {len(extracted_nodes)} entities (initial pass)")

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

        logger.debug("[EntityExtraction] === REFLECTION VALIDATION ===")

        # Process validation results
        # 1. Remove hallucinated entities
        if validation.hallucinated_entities:
            logger.debug(
                f"[EntityExtraction] Hallucinations detected: {validation.hallucinated_entities}"
            )
            extracted_nodes = [
                node
                for node in extracted_nodes
                if node.name not in validation.hallucinated_entities
            ]
            for hallucination in validation.hallucinated_entities:
                logger.debug(f"[EntityExtraction] ✗ Removed hallucination: {hallucination}")

        # 2. Add missed entities
        if validation.missed_entities:
            logger.debug(f"[EntityExtraction] Missed entities detected: {len(validation.missed_entities)}")
            for missed in validation.missed_entities:
                node = EntityNode(
                    name=missed.name,
                    group_id=episode.group_id,
                    labels=[],
                    summary=missed.summary,
                    attributes={},
                    aliases=[],
                )
                extracted_nodes.append(node)
                logger.debug(
                    f"[EntityExtraction] ✓ Added missed entity: {missed.name} - {missed.summary}"
                )

        # 3. Apply refinements
        if validation.refinements:
            logger.debug(f"[EntityExtraction] Refinements to apply: {len(validation.refinements)}")
            for refinement in validation.refinements:
                for node in extracted_nodes:
                    if node.name == refinement.original_name:
                        if refinement.refined_name:
                            logger.debug(
                                f"[EntityExtraction] ↻ Renamed: {refinement.original_name} → {refinement.refined_name}"
                            )
                            node.name = refinement.refined_name
                        if refinement.refined_summary:
                            logger.debug(
                                f"[EntityExtraction] ↻ Updated summary: {node.name}"
                            )
                            node.summary = refinement.refined_summary
                        break

    extracted_nodes = ensure_speaker_first(extracted_nodes)

    # Generate/update concise entity summaries (improves dedupe + retrieval).
    try:
        entities_payload = [
            {
                "id": i,
                "name": node.name,
                "labels": node.labels,
                "attributes": node.attributes,
                "aliases": node.aliases,
                "summary": node.summary,
            }
            for i, node in enumerate(extracted_nodes)
        ]
        summary_messages = summarize_entities(prev_episode_strings, episode.content, entities_payload)
        summary_response = await llm_client.generate_response(summary_messages, EntitySummaries)
        summaries_by_id = {s.id: s.summary.strip() for s in summary_response.entity_summaries}
        for i, node in enumerate(extracted_nodes):
            summary = summaries_by_id.get(i, "")
            if summary:
                node.summary = summary
    except Exception as e:
        logger.warning(f"[EntityExtraction] Summary generation failed: {e}")

    logger.debug(f"Final: {len(extracted_nodes)} entities after reflection")
    return extracted_nodes


def _entity_type_schemas_for_prompt(
    entity_types: dict[str, type[BaseModel]] | None,
) -> dict[str, dict[str, str]] | None:
    if not entity_types:
        return None
    schemas: dict[str, dict[str, str]] = {}
    for type_name, schema in entity_types.items():
        fields: dict[str, str] = {}
        for field_name, field in schema.model_fields.items():
            fields[field_name] = field.description or ""
        schemas[type_name] = fields
    return schemas


async def hydrate_node_attributes(
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    nodes: list[EntityNode],
    previous_episodes: list[EpisodicNode],
    *,
    entity_types: dict[str, type[BaseModel]] | None = None,
) -> None:
    """Second-pass node attribute extraction/normalization."""
    if not nodes:
        return

    prev_episode_strings = [ep.content for ep in previous_episodes][-4:]
    entities_payload = [
        {
            "id": i,
            "name": node.name,
            "labels": node.labels,
            "summary": node.summary,
            "attributes": node.attributes,
            "aliases": node.aliases,
        }
        for i, node in enumerate(nodes)
    ]

    messages = hydrate_entity_attributes(
        prev_episode_strings,
        episode.content,
        entities_payload,
        entity_type_schemas=_entity_type_schemas_for_prompt(entity_types),
    )

    try:
        response = await llm_client.generate_response(messages, EntityAttributeUpdates)
    except Exception as e:
        logger.warning(f"[EntityExtraction] Attribute hydration failed: {e}")
        return

    updates_by_id = {u.id: (u.attributes or {}) for u in response.entity_attributes}
    protected_keys = {"is_speaker", "user_id"}

    updated_nodes = 0
    for idx, node in enumerate(nodes):
        incoming = updates_by_id.get(idx)
        if not isinstance(incoming, dict) or not incoming:
            continue

        changed = False
        for key, value in incoming.items():
            if key in protected_keys and key in node.attributes:
                continue
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            if isinstance(value, (list, dict)) and not value:
                continue
            if node.attributes.get(key) != value:
                node.attributes[key] = value
                changed = True

        if changed:
            updated_nodes += 1

    logger.debug(f"[EntityExtraction] Hydrated attributes for {updated_nodes}/{len(nodes)} nodes")


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

    logger.debug("[EntityExtraction] === DEDUPLICATION ===")

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

            # Propagate summary if the existing node doesn't have one yet.
            incoming_summary = extracted_node.summary.strip() if extracted_node.summary else ""
            if incoming_summary and not (resolved_node.summary or "").strip():
                resolved_node.summary = incoming_summary

            logger.debug(
                f"[EntityExtraction] ⊕ Merged duplicate: {extracted_node.name} → "
                f"existing {resolved_node.name} (mentions: {resolved_node.mention_count})"
            )

            if extracted_node.labels and not resolved_node.labels:
                resolved_node.labels = extracted_node.labels
        else:
            # It's new - initialize with mention_count=1
            resolved_node = extracted_node
            resolved_node.mention_count = 1
            uuid_map[extracted_node.uuid] = extracted_node.uuid

            logger.debug(f"[EntityExtraction] ✓ New entity: {extracted_node.name}")

        # Apply canonical name from the resolution step.
        canonical_name = resolution.name.strip() if resolution.name else ""
        if canonical_name and canonical_name != resolved_node.name:
            logger.debug(
                f"[EntityExtraction] ↻ Canonicalized name: {resolved_node.name} → {canonical_name}"
            )
            resolved_node.name = canonical_name

        resolved_nodes.append(resolved_node)

    duplicates_count = len([v for k, v in uuid_map.items() if k != v])
    logger.debug(
        f"[EntityExtraction] Resolved {len(resolved_nodes)} nodes: "
        f"{duplicates_count} duplicates merged, "
        f"{len(resolved_nodes) - duplicates_count} new"
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
    edge_types: dict[str, type[BaseModel]] | None = None,
    excluded_edge_types: list[str] | None = None,
) -> list[EntityEdge]:
    """Extract relationships between entities."""
    if len(nodes) < 2:
        logger.debug("Not enough entities to extract relationships")
        return []

    nodes_context = [
        {"id": i, "name": node.name, "entity_types": node.labels} for i, node in enumerate(nodes)
    ]

    episode_content = episode.content
    custom_prompt = ""
    if episode.source == EpisodeType.json:
        import json

        try:
            parsed = json.loads(episode.content)
            episode_content = json.dumps(parsed, indent=2, ensure_ascii=False, sort_keys=True)
        except Exception:
            episode_content = episode.content

        custom_prompt = f"""
This episode source is JSON from: {episode.source_description}
Only extract facts that represent durable relationships between entities in the JSON (ownership, membership, association).
Avoid creating edges for purely structural JSON adjacency or transient telemetry fields.
"""
    elif episode.source == EpisodeType.code:
        custom_prompt = f"""
This episode source is CODE from: {episode.source_description}
Prefer code-aware relation_type values when appropriate (e.g., DEFINES, IMPORTS, CALLS, DEPENDS_ON, USES, LOCATED_IN).
Only extract facts that are clearly supported by the code and involve two distinct ENTITIES.
"""
    elif episode.source == EpisodeType.doc:
        custom_prompt = f"""
This episode source is DOCUMENTATION from: {episode.source_description}
Prefer doc-aware relation_type values when appropriate (e.g., DESCRIBES, DOCUMENTS, REQUIRES, CONFIGURES, USES).
Only extract facts that are clearly supported by the text and involve two distinct ENTITIES.
"""

    messages = extract_edges(
        episode_content,
        [ep.content for ep in previous_episodes],
        nodes_context,
        episode.valid_at.isoformat(),
        custom_prompt=custom_prompt,
        edge_types=list(edge_types.keys()) if edge_types else None,
        excluded_edge_types=excluded_edge_types,
    )

    response = await llm_client.generate_response(messages, ExtractedEdges)

    edges = []
    allowed_edge_type_names = set(edge_types.keys()) if edge_types else None
    excluded_edge_type_names = set(excluded_edge_types or [])
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

        relation_type = (edge_data.relation_type or "").strip() or "DEFAULT"
        if relation_type in excluded_edge_type_names:
            relation_type = "DEFAULT"
        if allowed_edge_type_names and relation_type not in allowed_edge_type_names:
            relation_type = "DEFAULT"

        edge = EntityEdge(
            source_node_uuid=nodes[source_idx].uuid,
            target_node_uuid=nodes[target_idx].uuid,
            name=relation_type,
            fact=edge_data.fact,
            group_id=episode.group_id,
            valid_at=valid_at,
            invalid_at=invalid_at,
            episodes=[episode.uuid],
            strength=edge_data.strength,
            attributes=edge_data.attributes or {},
        )
        edges.append(edge)

    logger.debug(f"Extracted {len(edges)} entity edges")
    return edges


async def extract_fact_nodes(
    driver: FalkorDriver,
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    nodes: list[EntityNode],
    previous_episodes: list[EpisodicNode],
) -> tuple[list[FactNode], list[FactRoleEdge]]:
    """Extract n-ary facts with roles between entities."""
    if len(nodes) < 2:
        logger.debug("Not enough entities to extract hyper-edge facts")
        return [], []

    nodes_context = [
        {"id": i, "name": node.name, "entity_types": node.labels} for i, node in enumerate(nodes)
    ]

    episode_content = episode.content
    custom_prompt = ""
    if episode.source == EpisodeType.json:
        import json

        try:
            parsed = json.loads(episode.content)
            episode_content = json.dumps(parsed, indent=2, ensure_ascii=False, sort_keys=True)
        except Exception:
            episode_content = episode.content

        custom_prompt = f"""
This episode source is JSON from: {episode.source_description}
Extract only durable, semantically meaningful facts (ownership, membership, assignments, configuration).
Avoid transient telemetry or structural adjacency in JSON.
"""
    elif episode.source == EpisodeType.code:
        custom_prompt = f"""
This episode source is CODE from: {episode.source_description}
Extract only durable code facts (ownership, definitions, dependencies, incidents, decisions).
Avoid transient runtime details or purely local variables.
"""
    elif episode.source == EpisodeType.doc:
        custom_prompt = f"""
This episode source is DOCUMENTATION from: {episode.source_description}
Extract only durable facts (decisions, requirements, constraints, roles, responsibilities).
Avoid purely narrative or speculative statements.
"""

    messages = extract_facts(
        episode_content,
        [ep.content for ep in previous_episodes],
        nodes_context,
        episode.valid_at.isoformat(),
        custom_prompt=custom_prompt,
    )

    try:
        response = await llm_client.generate_response(messages, ExtractedFacts)
    except Exception as e:
        logger.warning(f"[FactExtraction] Hyper-edge extraction failed: {e}")
        return [], []

    resolved_facts: list[FactNode] = []
    fact_roles: list[FactRoleEdge] = []
    seen_fact_uuids: set[str] = set()

    for fact_data in response.facts:
        fact_text = (fact_data.fact or "").strip()
        if not fact_text:
            continue

        role_entries: list[tuple[str, str, str | None]] = []
        seen_roles: set[tuple[str, str]] = set()
        entity_uuids: set[str] = set()

        for role in fact_data.roles:
            if role.entity_id is None or role.entity_id < 0 or role.entity_id >= len(nodes):
                continue
            role_name = (role.role or "").strip()
            if not role_name:
                continue
            entity_uuid = nodes[role.entity_id].uuid
            role_key = (entity_uuid, role_name)
            if role_key in seen_roles:
                continue
            seen_roles.add(role_key)
            entity_uuids.add(entity_uuid)
            role_entries.append((entity_uuid, role_name, role.role_description))

        if len(entity_uuids) < 2:
            continue

        fact_attributes = dict(fact_data.attributes or {})
        fact_type = (fact_data.fact_type or "").strip()
        if fact_type and fact_type.upper() != "DEFAULT":
            fact_attributes.setdefault("fact_type", fact_type)

        valid_at = _parse_edge_date(fact_data.valid_at)
        invalid_at = _parse_edge_date(fact_data.invalid_at)

        fact_node = FactNode(
            name=fact_text,
            fact=fact_text,
            group_id=episode.group_id,
            attributes=fact_attributes,
            episodes=[episode.uuid],
            valid_at=valid_at,
            invalid_at=invalid_at,
        )

        existing_fact = await driver.get_fact_by_text(fact_text, episode.group_id)
        if existing_fact:
            if episode.uuid not in existing_fact.episodes:
                existing_fact.episodes.append(episode.uuid)
            if existing_fact.valid_at is None and valid_at is not None:
                existing_fact.valid_at = valid_at
            if existing_fact.invalid_at is None and invalid_at is not None:
                existing_fact.invalid_at = invalid_at
            for key, value in fact_attributes.items():
                if key not in existing_fact.attributes:
                    existing_fact.attributes[key] = value
            fact_node = existing_fact

        if fact_node.uuid not in seen_fact_uuids:
            resolved_facts.append(fact_node)
            seen_fact_uuids.add(fact_node.uuid)

        for entity_uuid, role_name, role_description in role_entries:
            fact_roles.append(
                FactRoleEdge(
                    source_node_uuid=fact_node.uuid,
                    target_node_uuid=entity_uuid,
                    group_id=episode.group_id,
                    role=role_name,
                    role_description=role_description,
                )
            )

    logger.debug(f"[FactExtraction] Extracted {len(resolved_facts)} fact nodes")
    return resolved_facts, fact_roles


async def deduplicate_fact_nodes(
    driver: FalkorDriver,
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    facts: list[FactNode],
    fact_roles: list[FactRoleEdge],
) -> tuple[list[FactNode], list[FactRoleEdge]]:
    """Deduplicate fact nodes and invalidate contradicted facts."""
    if not facts:
        return [], []

    roles_by_fact: dict[str, list[FactRoleEdge]] = {}
    for role_edge in fact_roles:
        roles_by_fact.setdefault(role_edge.source_node_uuid, []).append(role_edge)

    deduped_facts: list[FactNode] = []
    deduped_roles: list[FactRoleEdge] = []
    seen_fact_uuids: set[str] = set()

    for fact in facts:
        roles = roles_by_fact.get(fact.uuid, [])
        entity_uuids = list({role.target_node_uuid for role in roles})
        if not entity_uuids:
            if fact.uuid not in seen_fact_uuids:
                deduped_facts.append(fact)
                seen_fact_uuids.add(fact.uuid)
            deduped_roles.extend(roles)
            continue

        candidate_facts = await driver.get_facts_by_entities(
            entity_uuids=entity_uuids,
            group_id=episode.group_id,
            limit=5,
        )
        candidate_facts = [c for c in candidate_facts if c.uuid != fact.uuid]

        if not candidate_facts:
            if fact.uuid not in seen_fact_uuids:
                deduped_facts.append(fact)
                seen_fact_uuids.add(fact.uuid)
            deduped_roles.extend(roles)
            continue

        candidate_roles = await driver.get_fact_roles(
            [candidate.uuid for candidate in candidate_facts],
            episode.group_id,
        )
        roles_by_candidate: dict[str, list[FactRoleDetail]] = {}
        for role in candidate_roles:
            roles_by_candidate.setdefault(role.fact_uuid, []).append(role)

        entity_names: dict[str, str] = {}
        for entity_uuid in entity_uuids:
            entity = await driver.get_entity_by_uuid(entity_uuid)
            entity_names[entity_uuid] = entity.name if entity else entity_uuid

        new_fact_payload = {
            "fact": fact.fact,
            "roles": [
                {
                    "role": role.role,
                    "entity": entity_names.get(role.target_node_uuid, role.target_node_uuid),
                }
                for role in roles
            ],
        }
        existing_facts_payload = []
        for idx, candidate in enumerate(candidate_facts):
            existing_facts_payload.append(
                {
                    "idx": idx,
                    "fact": candidate.fact,
                    "roles": [
                        {
                            "role": role.role,
                            "entity_name": role.entity_name,
                        }
                        for role in roles_by_candidate.get(candidate.uuid, [])
                    ],
                }
            )

        try:
            response = await llm_client.generate_response(
                dedupe_facts(new_fact_payload, existing_facts_payload),
                FactDuplicate,
            )
        except Exception as e:
            logger.warning("[FactExtraction] Fact dedupe skipped: {}", e)
            response = FactDuplicate()

        if response.contradicted_facts:
            for idx in response.contradicted_facts:
                if 0 <= idx < len(candidate_facts):
                    await driver.invalidate_fact(
                        candidate_facts[idx].uuid,
                        episode.valid_at,
                    )

        if response.duplicate_facts:
            duplicate_idx = response.duplicate_facts[0]
            if 0 <= duplicate_idx < len(candidate_facts):
                existing = candidate_facts[duplicate_idx]
                if episode.uuid not in existing.episodes:
                    existing.episodes.append(episode.uuid)
                if existing.valid_at is None and fact.valid_at is not None:
                    existing.valid_at = fact.valid_at
                if existing.invalid_at is None and fact.invalid_at is not None:
                    existing.invalid_at = fact.invalid_at
                for key, value in fact.attributes.items():
                    if key not in existing.attributes:
                        existing.attributes[key] = value
                fact = existing

        for role_edge in roles:
            role_edge.source_node_uuid = fact.uuid
            deduped_roles.append(role_edge)

        if fact.uuid not in seen_fact_uuids:
            deduped_facts.append(fact)
            seen_fact_uuids.add(fact.uuid)

    logger.debug(
        "[FactExtraction] Deduplicated facts to {} unique nodes", len(deduped_facts)
    )
    return deduped_facts, deduped_roles


def _parse_edge_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


async def refine_edge_dates_batch(
    llm_client: ClaudeClient,
    episode: EpisodicNode,
    edges: list[EntityEdge],
    previous_episodes: list[EpisodicNode],
) -> None:
    """Optional second-pass edge datetime extraction.

    Only fills missing valid_at/invalid_at fields and does not override existing values.
    """
    if not edges:
        return

    edges_to_refine: list[dict[str, object]] = []
    id_to_edge: dict[int, EntityEdge] = {}
    for idx, edge in enumerate(edges):
        if edge.valid_at is not None and edge.invalid_at is not None:
            continue
        id_to_edge[idx] = edge
        edges_to_refine.append(
            {
                "id": idx,
                "relation_type": edge.name,
                "fact": edge.fact,
                "valid_at": edge.valid_at.isoformat() if edge.valid_at else None,
                "invalid_at": edge.invalid_at.isoformat() if edge.invalid_at else None,
            }
        )

    if not edges_to_refine:
        return

    prev_episode_strings = [ep.content for ep in previous_episodes][-4:]
    messages = extract_edge_dates_batch(
        prev_episode_strings,
        episode.content,
        edges_to_refine,
        episode.valid_at.isoformat(),
    )

    try:
        response = await llm_client.generate_response(messages, EdgeDateUpdates)
    except Exception as e:
        logger.warning(f"[EdgeExtraction] Edge date refinement failed: {e}")
        return

    updates_by_id = {u.id: u for u in response.edge_dates}
    updated_edges = 0
    for idx, edge in id_to_edge.items():
        update = updates_by_id.get(idx)
        if not update:
            continue

        changed = False
        if edge.valid_at is None and update.valid_at:
            parsed = _parse_edge_date(update.valid_at)
            if parsed is not None:
                edge.valid_at = parsed
                changed = True
        if edge.invalid_at is None and update.invalid_at:
            parsed = _parse_edge_date(update.invalid_at)
            if parsed is not None:
                edge.invalid_at = parsed
                changed = True

        if changed:
            updated_edges += 1

    logger.debug(
        f"[EdgeExtraction] Refined dates for {updated_edges}/{len(edges_to_refine)} edges"
    )


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


async def generate_fact_embeddings(
    embedder: OpenAIEmbedder,
    facts: list[FactNode],
) -> None:
    """Generate embeddings for fact nodes."""
    if not facts:
        return

    texts = [fact.fact.replace("\n", " ") for fact in facts]
    embeddings = await embedder.create_batch(texts)

    for fact, embedding in zip(facts, embeddings):
        fact.fact_embedding = embedding

    logger.debug(f"Generated embeddings for {len(facts)} fact nodes")


async def save_nodes_and_edges(
    driver: FalkorDriver,
    new_nodes: list[EntityNode],
    edges: list[EntityEdge],
    episode: EpisodicNode,
    all_nodes: list[EntityNode],
    postgres_driver=None,
    fact_nodes: list[FactNode] | None = None,
    fact_role_edges: list[FactRoleEdge] | None = None,
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

    # Save fact nodes and roles
    if fact_nodes:
        for fact in fact_nodes:
            await driver.save_fact_node(fact)

    if fact_role_edges:
        for fact_role in fact_role_edges:
            await driver.save_fact_role_edge(fact_role)

    # Save episodic edges (episode -> entities mentioned)
    for node in all_nodes:
        episodic_edge = EpisodicEdge(
            source_node_uuid=episode.uuid,
            target_node_uuid=node.uuid,
            group_id=episode.group_id,
        )
        await driver.save_episodic_edge(episodic_edge)

    # Persist bidirectional episode ↔ fact index (episode.entity_edges / episode.fact_nodes)
    episode.entity_edges = await driver.get_edge_uuids_for_episode(episode.uuid, episode.group_id)
    if fact_nodes is not None:
        episode.fact_nodes = await driver.get_fact_uuids_for_episode(
            episode.uuid, episode.group_id
        )
    await driver.save_episodic_node(episode)

    logger.debug(
        "Saved {} nodes (with embeddings), {} entity edges, {} fact nodes, {} episodic edges",
        len(nodes_with_embeddings),
        len(edges),
        len(fact_nodes or []),
        len(all_nodes),
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
