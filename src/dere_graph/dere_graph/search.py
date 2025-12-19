from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import numpy as np
from loguru import logger

from dere_graph.driver import FalkorDriver
from dere_graph.embeddings import OpenAIEmbedder
from dere_graph.filters import SearchFilters, build_temporal_query_clause
from dere_graph.models import CommunityNode, EntityEdge, EntityNode


def parse_db_date(value: Any) -> datetime | None:
    """Parse datetime-ish values from FalkorDB records."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=UTC)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # `datetime.fromisoformat` doesn't reliably accept "Z".
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return datetime.fromisoformat(text)
    return None


def calculate_cosine_similarity(vector1: list[float], vector2: list[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    dot_product = np.dot(vector1, vector2)
    norm1 = np.linalg.norm(vector1)
    norm2 = np.linalg.norm(vector2)

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return float(dot_product / (norm1 * norm2))


def rrf(results: list[list[str]], rank_const: int = 60) -> tuple[list[str], list[float]]:
    """Reciprocal Rank Fusion - combine multiple ranked result lists."""
    scores: dict[str, float] = defaultdict(float)

    for result in results:
        for i, uuid in enumerate(result):
            scores[uuid] += 1.0 / (i + rank_const)

    scored_items = list(scores.items())
    scored_items.sort(reverse=True, key=lambda x: x[1])

    sorted_uuids = [item[0] for item in scored_items]
    sorted_scores = [item[1] for item in scored_items]

    return sorted_uuids, sorted_scores


def sanitize_lucene_query(query: str) -> str:
    """Sanitize query string for Lucene fulltext search."""
    special_chars = [
        "+",
        "-",
        "&&",
        "||",
        "!",
        "(",
        ")",
        "{",
        "}",
        "[",
        "]",
        "^",
        '"',
        "~",
        "*",
        "?",
        ":",
        "\\",
        "/",
    ]

    sanitized = query
    for char in special_chars:
        sanitized = sanitized.replace(char, f"\\{char}")

    return sanitized


async def hybrid_node_search(
    driver: FalkorDriver,
    embedder: OpenAIEmbedder,
    query: str,
    group_id: str,
    limit: int = 10,
    filters: SearchFilters | None = None,
    rerank_method: str | None = None,
    rerank_alpha: float = 0.5,
) -> list[EntityNode]:
    """Hybrid search combining BM25 fulltext and vector similarity with RRF fusion.

    Args:
        driver: FalkorDB driver
        embedder: Embedding model
        query: Search query
        group_id: Graph partition
        limit: Number of results to return
        filters: Temporal/attribute filters
        rerank_method: Optional reranking strategy ('episode_mentions', 'mmr', 'recency')
        rerank_alpha: Alpha parameter for reranking (0-1)

    Returns:
        List of entity nodes
    """
    # Skip vector search if query is empty (temporal-only queries)
    if not query or not query.strip():
        # Just use fulltext search (which handles empty queries)
        results = await fulltext_node_search(driver, query, group_id, limit, filters)
        return _apply_reranking(results, rerank_method, rerank_alpha, limit)

    # Generate query embedding
    query_vector = await embedder.create(query.replace("\n", " "))

    # BM25 fulltext search
    fulltext_results = await fulltext_node_search(driver, query, group_id, limit * 2, filters)
    fulltext_uuids = [node.uuid for node in fulltext_results]

    # Vector similarity search
    similarity_results = await vector_node_search(
        driver, query_vector, group_id, limit * 2, filters=filters
    )
    similarity_uuids = [node.uuid for node in similarity_results]

    # Combine with RRF
    combined_uuids, scores = rrf([fulltext_uuids, similarity_uuids])

    # Fetch nodes for top results (fetch more than limit if reranking)
    fetch_limit = limit * 2 if rerank_method else limit
    result_uuids = combined_uuids[:fetch_limit]
    result_nodes = []

    for uuid in result_uuids:
        node = await driver.get_entity_by_uuid(uuid)
        if node:
            result_nodes.append(node)

    # Apply reranking if requested
    result_nodes = _apply_reranking(result_nodes, rerank_method, rerank_alpha, limit)

    logger.debug(
        f"Hybrid search returned {len(result_nodes)} nodes for query: {query} "
        f"(rerank={rerank_method})"
    )
    return result_nodes


def _apply_reranking(
    nodes: list[EntityNode],
    rerank_method: str | None,
    rerank_alpha: float,
    limit: int,
) -> list[EntityNode]:
    """Apply reranking strategy to search results."""
    if not rerank_method or not nodes:
        return nodes[:limit]

    if rerank_method == "episode_mentions":
        from dere_graph.reranking import score_by_episode_mentions

        scored = score_by_episode_mentions(nodes, alpha=rerank_alpha)
        return [node for node, _score in scored[:limit]]

    elif rerank_method == "recency":
        from dere_graph.reranking import score_by_recency

        scored = score_by_recency(nodes, decay_factor=rerank_alpha)
        return [node for node, _score in scored[:limit]]

    elif rerank_method == "retrospective":
        from dere_graph.reranking import score_by_retrospective_quality

        scored = score_by_retrospective_quality(nodes, alpha=rerank_alpha)
        return [node for node, _score in scored[:limit]]

    elif rerank_method == "mmr":
        # MMR requires query embedding - not implemented in this helper
        logger.warning("MMR reranking not supported in _apply_reranking helper")
        return nodes[:limit]

    else:
        logger.warning(f"Unknown rerank method: {rerank_method}")
        return nodes[:limit]


async def fulltext_node_search(
    driver: FalkorDriver,
    query: str,
    group_id: str,
    limit: int = 10,
    filters: SearchFilters | None = None,
) -> list[EntityNode]:
    """BM25 fulltext search on node names and summaries."""
    # Build filter clause
    filter_clause, filter_params = build_temporal_query_clause(filters, "node", None)

    # Handle empty queries - use direct MATCH instead of fulltext index
    if not query or not query.strip():
        # Build WHERE conditions
        where_parts = ["node.group_id = $group_id"]
        if filter_clause:
            conditions = filter_clause.replace("WHERE ", "")
            where_parts.append(conditions)

        where_clause = "WHERE " + " AND ".join(where_parts)

        cypher = f"""
        MATCH (node:Entity)
        {where_clause}
        RETURN node.uuid AS uuid,
               node.name AS name,
               node.group_id AS group_id,
               node.name_embedding AS name_embedding,
               node.summary AS summary,
               node.created_at AS created_at,
               labels(node) AS labels,
               node AS attributes,
               1.0 AS score
        ORDER BY node.created_at DESC
        LIMIT $limit
        """

        records = await driver.execute_query(
            cypher,
            group_id=group_id,
            limit=limit,
            **filter_params,
        )
    else:
        # Normal fulltext search
        sanitized_query = sanitize_lucene_query(query)

        # Add filter conditions to WHERE clause
        where_parts = ["node.group_id = $group_id"]
        if filter_clause:
            # Extract conditions from WHERE clause
            conditions = filter_clause.replace("WHERE ", "")
            where_parts.append(conditions)

        where_clause = "WHERE " + " AND ".join(where_parts)

        cypher = f"""
        CALL db.idx.fulltext.queryNodes("node_name_and_summary", $query)
        YIELD node, score
        {where_clause}
        RETURN node.uuid AS uuid,
               node.name AS name,
               node.group_id AS group_id,
               node.name_embedding AS name_embedding,
               node.summary AS summary,
               node.created_at AS created_at,
               labels(node) AS labels,
               node AS attributes,
               score
        ORDER BY score DESC
        LIMIT $limit
        """

        records = await driver.execute_query(
            cypher,
            query=sanitized_query,
            group_id=group_id,
            limit=limit,
            **filter_params,
        )

    nodes = []
    for record in records:
        # Extract attributes from Node object
        node_obj = record["attributes"]
        attributes = dict(node_obj.properties)

        # Pull out standard/reserved fields so `attributes` remains domain-specific.
        aliases = attributes.pop("aliases", []) or []
        last_mentioned = parse_db_date(attributes.pop("last_mentioned", None))
        expired_at = parse_db_date(attributes.pop("expired_at", None))
        mention_count = attributes.pop("mention_count", 1) or 1
        retrieval_count = attributes.pop("retrieval_count", 0) or 0
        citation_count = attributes.pop("citation_count", 0) or 0
        retrieval_quality = attributes.pop("retrieval_quality", 1.0) or 1.0

        for key in ["uuid", "name", "group_id", "name_embedding", "summary", "created_at"]:
            attributes.pop(key, None)

        node = EntityNode(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            name_embedding=record["name_embedding"],
            summary=record["summary"],
            created_at=parse_db_date(record["created_at"]),
            expired_at=expired_at,
            aliases=aliases,
            last_mentioned=last_mentioned,
            mention_count=int(mention_count),
            retrieval_count=int(retrieval_count),
            citation_count=int(citation_count),
            retrieval_quality=float(retrieval_quality),
            labels=[label for label in record["labels"] if label != "Entity"],
            attributes=attributes,
        )
        nodes.append(node)

    logger.debug(f"Fulltext search found {len(nodes)} nodes")
    return nodes


async def fulltext_community_search(
    driver: FalkorDriver,
    query: str,
    group_id: str,
    limit: int = 10,
) -> list[CommunityNode]:
    """BM25 fulltext search on community names and summaries."""
    if not query or not query.strip():
        return []

    sanitized_query = sanitize_lucene_query(query)

    cypher = """
    CALL db.idx.fulltext.queryNodes("community_name_and_summary", $query)
    YIELD node, score
    WHERE node.group_id = $group_id
    RETURN node.uuid AS uuid,
           node.name AS name,
           node.group_id AS group_id,
           node.name_embedding AS name_embedding,
           node.summary AS summary,
           node.created_at AS created_at,
           labels(node) AS labels,
           score
    ORDER BY score DESC
    LIMIT $limit
    """

    records = await driver.execute_query(
        cypher,
        query=sanitized_query,
        group_id=group_id,
        limit=limit,
    )

    communities = []
    for record in records:
        community = CommunityNode(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            name_embedding=record.get("name_embedding"),
            summary=record.get("summary") or "",
            created_at=parse_db_date(record.get("created_at")),
            labels=[label for label in record["labels"] if label != "Community"],
        )
        communities.append(community)

    logger.debug(f"Fulltext search found {len(communities)} communities")
    return communities


async def vector_node_search(
    driver: FalkorDriver,
    query_vector: list[float],
    group_id: str,
    limit: int = 10,
    min_score: float = 0.5,
    filters: SearchFilters | None = None,
) -> list[EntityNode]:
    """Vector similarity search on node name embeddings."""
    # Build filter conditions
    filter_clause, filter_params = build_temporal_query_clause(filters, "n", None)

    # Extract just the conditions (remove WHERE)
    filter_conditions = filter_clause.replace("WHERE ", "") if filter_clause else ""

    # Build WHERE clause combining base conditions and filters
    where_parts = [
        "n.group_id = $group_id",
        "n.name_embedding IS NOT NULL",
    ]
    if filter_conditions:
        where_parts.append(filter_conditions)

    where_clause = "WHERE " + " AND ".join(where_parts)

    cypher = f"""
    MATCH (n:Entity)
    {where_clause}
    WITH n, (2 - vec.cosineDistance(n.name_embedding, vecf32($search_vector)))/2 AS score
    WHERE score >= $min_score
    RETURN n.uuid AS uuid,
           n.name AS name,
           n.group_id AS group_id,
           n.name_embedding AS name_embedding,
           n.summary AS summary,
           n.created_at AS created_at,
           labels(n) AS labels,
           n AS attributes,
           score
    ORDER BY score DESC
    LIMIT $limit
    """

    records = await driver.execute_query(
        cypher,
        search_vector=query_vector,
        group_id=group_id,
        min_score=min_score,
        limit=limit,
        **filter_params,
    )

    nodes = []
    for record in records:
        # Extract attributes from Node object
        node_obj = record["attributes"]
        attributes = dict(node_obj.properties)

        aliases = attributes.pop("aliases", []) or []
        last_mentioned = parse_db_date(attributes.pop("last_mentioned", None))
        expired_at = parse_db_date(attributes.pop("expired_at", None))
        mention_count = attributes.pop("mention_count", 1) or 1
        retrieval_count = attributes.pop("retrieval_count", 0) or 0
        citation_count = attributes.pop("citation_count", 0) or 0
        retrieval_quality = attributes.pop("retrieval_quality", 1.0) or 1.0

        for key in ["uuid", "name", "group_id", "name_embedding", "summary", "created_at"]:
            attributes.pop(key, None)

        node = EntityNode(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            name_embedding=record["name_embedding"],
            summary=record["summary"],
            created_at=parse_db_date(record["created_at"]),
            expired_at=expired_at,
            aliases=aliases,
            last_mentioned=last_mentioned,
            mention_count=int(mention_count),
            retrieval_count=int(retrieval_count),
            citation_count=int(citation_count),
            retrieval_quality=float(retrieval_quality),
            labels=[label for label in record["labels"] if label != "Entity"],
            attributes=attributes,
        )
        nodes.append(node)

    logger.debug(f"Vector search found {len(nodes)} nodes")
    return nodes


async def hybrid_edge_search(
    driver: FalkorDriver,
    embedder: OpenAIEmbedder,
    query: str,
    group_id: str,
    limit: int = 10,
    filters: SearchFilters | None = None,
) -> list[EntityEdge]:
    """Hybrid search for edges combining BM25 and vector similarity."""
    # Skip vector search if query is empty (temporal-only queries)
    if not query or not query.strip():
        return await fulltext_edge_search(driver, query, group_id, limit, filters)

    # Generate query embedding
    query_vector = await embedder.create(query.replace("\n", " "))

    # BM25 fulltext search on edge facts
    fulltext_results = await fulltext_edge_search(driver, query, group_id, limit * 2, filters)
    fulltext_uuids = [edge.uuid for edge in fulltext_results]

    # Vector similarity search on fact embeddings
    similarity_results = await vector_edge_search(
        driver, query_vector, group_id, limit * 2, filters=filters
    )
    similarity_uuids = [edge.uuid for edge in similarity_results]

    # Combine with RRF
    combined_uuids, scores = rrf([fulltext_uuids, similarity_uuids])

    # Return top results
    result_uuids = set(combined_uuids[:limit])
    result_edges = [
        edge for edge in (fulltext_results + similarity_results) if edge.uuid in result_uuids
    ]

    # Deduplicate by uuid
    seen = set()
    unique_edges = []
    for edge in result_edges:
        if edge.uuid not in seen:
            seen.add(edge.uuid)
            unique_edges.append(edge)

    logger.debug(f"Hybrid edge search returned {len(unique_edges)} edges")
    return unique_edges[:limit]


async def fulltext_edge_search(
    driver: FalkorDriver,
    query: str,
    group_id: str,
    limit: int = 10,
    filters: SearchFilters | None = None,
) -> list[EntityEdge]:
    """BM25 fulltext search on edge facts."""
    # Build filter clause
    filter_clause, filter_params = build_temporal_query_clause(
        filters, "relationship", "relationship"
    )

    # Build WHERE conditions
    where_parts = [
        "relationship.group_id = $group_id",
        "relationship.invalid_at IS NULL",
    ]
    if filter_clause:
        conditions = filter_clause.replace("WHERE ", "")
        where_parts.append(conditions)

    where_clause = "WHERE " + " AND ".join(where_parts)

    # Handle empty queries - use direct MATCH instead of fulltext index
    if not query or not query.strip():
        cypher = f"""
        MATCH ()-[relationship:RELATES_TO]->()
        {where_clause}
        RETURN relationship.uuid AS uuid,
               relationship.name AS name,
               relationship.group_id AS group_id,
               relationship.fact AS fact,
               relationship.fact_embedding AS fact_embedding,
               relationship.episodes AS episodes,
               relationship.created_at AS created_at,
               relationship.expired_at AS expired_at,
               relationship.valid_at AS valid_at,
               relationship.invalid_at AS invalid_at,
               startNode(relationship).uuid AS source_uuid,
               endNode(relationship).uuid AS target_uuid,
               relationship AS attributes,
               1.0 AS score
        ORDER BY relationship.created_at DESC
        LIMIT $limit
        """

        records = await driver.execute_query(
            cypher,
            group_id=group_id,
            limit=limit,
            **filter_params,
        )
    else:
        # Normal fulltext search
        sanitized_query = sanitize_lucene_query(query)

        cypher = f"""
        CALL db.idx.fulltext.queryRelationships("edge_name_and_fact", $query)
        YIELD relationship, score
        {where_clause}
        RETURN relationship.uuid AS uuid,
               relationship.name AS name,
               relationship.group_id AS group_id,
               relationship.fact AS fact,
               relationship.fact_embedding AS fact_embedding,
               relationship.episodes AS episodes,
               relationship.created_at AS created_at,
               relationship.expired_at AS expired_at,
               relationship.valid_at AS valid_at,
               relationship.invalid_at AS invalid_at,
               startNode(relationship).uuid AS source_uuid,
               endNode(relationship).uuid AS target_uuid,
               relationship AS attributes,
               score
        ORDER BY score DESC
        LIMIT $limit
        """

        records = await driver.execute_query(
            cypher,
            query=sanitized_query,
            group_id=group_id,
            limit=limit,
            **filter_params,
        )

    edges = []
    for record in records:
        # Extract attributes from Edge object
        edge_obj = record["attributes"]
        attributes = dict(edge_obj.properties)

        strength = attributes.pop("strength", None)

        # Remove standard fields from attributes
        for key in [
            "uuid",
            "name",
            "group_id",
            "fact",
            "fact_embedding",
            "episodes",
            "created_at",
            "expired_at",
            "valid_at",
            "invalid_at",
        ]:
            attributes.pop(key, None)

        edge = EntityEdge(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            source_node_uuid=record["source_uuid"],
            target_node_uuid=record["target_uuid"],
            fact=record["fact"],
            fact_embedding=record["fact_embedding"],
            episodes=record["episodes"] or [],
            created_at=parse_db_date(record["created_at"]) or datetime.now(UTC),
            expired_at=parse_db_date(record["expired_at"]),
            valid_at=parse_db_date(record["valid_at"]),
            invalid_at=parse_db_date(record["invalid_at"]),
            strength=float(strength) if strength is not None else None,
            attributes=attributes,
        )
        edges.append(edge)

    logger.debug(f"Fulltext edge search found {len(edges)} edges")
    return edges


async def vector_edge_search(
    driver: FalkorDriver,
    query_vector: list[float],
    group_id: str,
    limit: int = 10,
    min_score: float = 0.5,
    filters: SearchFilters | None = None,
) -> list[EntityEdge]:
    """Vector similarity search on edge fact embeddings."""
    # Build filter conditions
    filter_clause, filter_params = build_temporal_query_clause(filters, "e", "e")

    # Build WHERE conditions
    where_parts = [
        "e.group_id = $group_id",
        "e.fact_embedding IS NOT NULL",
        "e.invalid_at IS NULL",
    ]
    if filter_clause:
        conditions = filter_clause.replace("WHERE ", "")
        where_parts.append(conditions)

    where_clause = "WHERE " + " AND ".join(where_parts)

    cypher = f"""
    MATCH ()-[e:RELATES_TO]->()
    {where_clause}
    WITH e, (2 - vec.cosineDistance(e.fact_embedding, vecf32($search_vector)))/2 AS score,
         startNode(e) AS source, endNode(e) AS target
    WHERE score >= $min_score
    RETURN e.uuid AS uuid,
           e.name AS name,
           e.group_id AS group_id,
           e.fact AS fact,
           e.fact_embedding AS fact_embedding,
           e.episodes AS episodes,
           e.created_at AS created_at,
           e.expired_at AS expired_at,
           e.valid_at AS valid_at,
           e.invalid_at AS invalid_at,
           source.uuid AS source_uuid,
           target.uuid AS target_uuid,
           e AS attributes,
           score
    ORDER BY score DESC
    LIMIT $limit
    """

    records = await driver.execute_query(
        cypher,
        search_vector=query_vector,
        group_id=group_id,
        min_score=min_score,
        limit=limit,
        **filter_params,
    )

    edges = []
    for record in records:
        # Extract attributes from Edge object
        edge_obj = record["attributes"]
        attributes = dict(edge_obj.properties)

        strength = attributes.pop("strength", None)
        # Remove standard fields from attributes
        for key in [
            "uuid",
            "name",
            "group_id",
            "fact",
            "fact_embedding",
            "episodes",
            "created_at",
            "expired_at",
            "valid_at",
            "invalid_at",
        ]:
            attributes.pop(key, None)

        edge = EntityEdge(
            uuid=record["uuid"],
            name=record["name"],
            group_id=record["group_id"],
            source_node_uuid=record["source_uuid"],
            target_node_uuid=record["target_uuid"],
            fact=record["fact"],
            fact_embedding=record["fact_embedding"],
            episodes=record["episodes"] or [],
            created_at=parse_db_date(record["created_at"]) or datetime.now(UTC),
            expired_at=parse_db_date(record["expired_at"]),
            valid_at=parse_db_date(record["valid_at"]),
            invalid_at=parse_db_date(record["invalid_at"]),
            strength=float(strength) if strength is not None else None,
            attributes=attributes,
        )
        edges.append(edge)

    logger.debug(f"Vector edge search found {len(edges)} edges")
    return edges
