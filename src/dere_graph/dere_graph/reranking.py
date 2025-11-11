"""Advanced search reranking strategies for dere_graph."""

from __future__ import annotations

import numpy as np
from loguru import logger

from dere_graph.models import EntityEdge, EntityNode


def mmr_rerank(
    items: list[EntityNode] | list[EntityEdge],
    query_embedding: list[float],
    lambda_param: float = 0.5,
    limit: int = 10,
) -> list[EntityNode] | list[EntityEdge]:
    """Maximal Marginal Relevance reranking for diversity.

    Balances relevance to query with diversity among results.

    Args:
        items: List of nodes or edges to rerank
        query_embedding: Query embedding vector
        lambda_param: Trade-off parameter (1=pure relevance, 0=pure diversity)
        limit: Number of items to return

    Returns:
        Reranked list of items
    """
    if not items or limit == 0:
        return []

    # Extract embeddings
    embeddings = []
    for item in items:
        if isinstance(item, EntityNode):
            emb = item.name_embedding
        elif isinstance(item, EntityEdge):
            emb = item.fact_embedding
        else:
            emb = None

        if emb is None:
            # Can't rerank items without embeddings
            logger.warning("MMR reranking skipped - items missing embeddings")
            return items[:limit]

        embeddings.append(np.array(emb))

    query_vec = np.array(query_embedding)

    # Calculate relevance scores (cosine similarity with query)
    relevance_scores = []
    for emb in embeddings:
        similarity = np.dot(query_vec, emb) / (np.linalg.norm(query_vec) * np.linalg.norm(emb))
        relevance_scores.append(float(similarity))

    # MMR algorithm
    selected_indices = []
    remaining_indices = list(range(len(items)))

    for _ in range(min(limit, len(items))):
        if not remaining_indices:
            break

        # Calculate MMR score for each remaining item
        mmr_scores = []
        for idx in remaining_indices:
            relevance = relevance_scores[idx]

            # Calculate max similarity to already selected items
            if selected_indices:
                similarities = []
                for selected_idx in selected_indices:
                    sim = np.dot(embeddings[idx], embeddings[selected_idx]) / (
                        np.linalg.norm(embeddings[idx]) * np.linalg.norm(embeddings[selected_idx])
                    )
                    similarities.append(float(sim))
                max_similarity = max(similarities)
            else:
                max_similarity = 0.0

            # MMR formula: λ * relevance - (1 - λ) * max_similarity
            mmr_score = lambda_param * relevance - (1 - lambda_param) * max_similarity
            mmr_scores.append((idx, mmr_score))

        # Select item with highest MMR score
        best_idx, best_score = max(mmr_scores, key=lambda x: x[1])
        selected_indices.append(best_idx)
        remaining_indices.remove(best_idx)

    reranked = [items[idx] for idx in selected_indices]

    logger.debug(f"MMR reranked {len(items)} items to {len(reranked)} (lambda={lambda_param})")
    return reranked


def reciprocal_rank_fusion(
    result_lists: list[list[str]],
    rank_constant: int = 60,
) -> list[tuple[str, float]]:
    """Combine multiple ranked lists using Reciprocal Rank Fusion.

    Args:
        result_lists: List of ranked UUID lists
        rank_constant: Constant for RRF formula (default 60)

    Returns:
        List of (uuid, score) tuples sorted by score descending
    """
    scores: dict[str, float] = {}

    for result_list in result_lists:
        for rank, uuid in enumerate(result_list):
            # RRF formula: 1 / (rank + k)
            score = 1.0 / (rank + rank_constant)
            scores[uuid] = scores.get(uuid, 0.0) + score

    # Sort by score descending
    sorted_items = sorted(scores.items(), key=lambda x: x[1], reverse=True)

    logger.debug(f"RRF combined {len(result_lists)} lists into {len(sorted_items)} items")
    return sorted_items


def score_by_recency(
    items: list[EntityNode] | list[EntityEdge],
    decay_factor: float = 0.1,
) -> list[tuple[EntityNode | EntityEdge, float]]:
    """Score items by recency (newer = higher score).

    Args:
        items: List of nodes or edges
        decay_factor: How quickly scores decay with time (higher = faster decay)

    Returns:
        List of (item, score) tuples
    """
    if not items:
        return []

    # Find newest timestamp for normalization
    timestamps = [item.created_at.timestamp() for item in items]
    max_timestamp = max(timestamps)
    min_timestamp = min(timestamps)
    time_range = max_timestamp - min_timestamp

    if time_range == 0:
        # All items have same timestamp
        return [(item, 1.0) for item in items]

    scored = []
    for item in items:
        # Normalize timestamp to 0-1 range
        normalized_time = (item.created_at.timestamp() - min_timestamp) / time_range

        # Apply exponential decay (newer = higher score)
        recency_score = np.exp(-decay_factor * (1.0 - normalized_time))

        scored.append((item, float(recency_score)))

    logger.debug(f"Scored {len(items)} items by recency (decay={decay_factor})")
    return scored


def score_by_episode_mentions(
    items: list[EntityNode],
    alpha: float = 0.5,
) -> list[tuple[EntityNode, float]]:
    """Score entities by how frequently they've been mentioned across episodes.

    Frequency-based reranking that prioritizes entities mentioned more often,
    making frequently referenced entities more accessible during retrieval.

    Args:
        items: List of entity nodes to score
        alpha: Scaling factor for mention_count (higher = stronger boost for frequent entities)

    Returns:
        List of (item, score) tuples sorted by score descending
    """
    if not items:
        return []

    # Find max mention count for normalization
    mention_counts = [item.mention_count for item in items]
    max_mentions = max(mention_counts)

    if max_mentions == 0:
        # No mentions tracked, return uniform scores
        return [(item, 1.0) for item in items]

    scored = []
    for item in items:
        # Normalize mention count to 0-1 range
        normalized_mentions = item.mention_count / max_mentions

        # Apply scaling factor
        episode_mention_score = alpha * normalized_mentions + (1 - alpha)

        scored.append((item, float(episode_mention_score)))

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    logger.debug(
        f"Scored {len(items)} entities by episode mentions "
        f"(alpha={alpha}, max_mentions={max_mentions})"
    )
    return scored


def combine_scores(
    items: list[EntityNode] | list[EntityEdge],
    score_dict_list: list[dict[str, float]],
    weights: list[float] | None = None,
) -> list[EntityNode] | list[EntityEdge]:
    """Combine multiple scoring strategies with weights.

    Args:
        items: List of items to rank
        score_dict_list: List of dictionaries mapping UUID to score
        weights: List of weights for each scoring strategy (default: equal weights)

    Returns:
        Reranked list of items
    """
    if not items or not score_dict_list:
        return items

    if weights is None:
        weights = [1.0 / len(score_dict_list)] * len(score_dict_list)

    if len(weights) != len(score_dict_list):
        raise ValueError("Number of weights must match number of score dictionaries")

    # Calculate combined scores
    combined_scores = {}
    for item in items:
        uuid = item.uuid
        score = 0.0

        for score_dict, weight in zip(score_dict_list, weights):
            score += weight * score_dict.get(uuid, 0.0)

        combined_scores[uuid] = score

    # Sort by combined score
    sorted_items = sorted(items, key=lambda x: combined_scores[x.uuid], reverse=True)

    logger.debug(f"Combined {len(score_dict_list)} scoring strategies with weights {weights}")
    return sorted_items


def score_by_retrospective_quality(
    items: list[EntityNode],
    alpha: float = 0.5,
    min_retrievals: int = 3,
) -> list[tuple[EntityNode, float]]:
    """Score entities by their past retrieval quality (attribution success rate).

    Lightweight retrospective reflection that boosts entities with proven
    usefulness based on citation_count / retrieval_count ratio.

    Args:
        items: List of entity nodes to score
        alpha: Scaling factor for retrieval quality (higher = stronger boost for high-quality entities)
        min_retrievals: Minimum retrieval count before applying quality boost (confidence threshold)

    Returns:
        List of (item, score) tuples sorted by score descending
    """
    if not items:
        return []

    scored = []
    for item in items:
        # Apply quality boost only if entity has sufficient retrieval history
        if item.retrieval_count >= min_retrievals:
            # Use tracked retrieval_quality (citation_count / retrieval_count)
            quality_score = alpha * item.retrieval_quality + (1 - alpha)
        else:
            # Neutral score for entities without sufficient history
            quality_score = 1.0

        scored.append((item, float(quality_score)))

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    logger.debug(
        f"Scored {len(items)} entities by retrospective quality "
        f"(alpha={alpha}, min_retrievals={min_retrievals})"
    )
    return scored
