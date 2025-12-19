"""Graph traversal utilities for BFS and distance-based operations."""

from __future__ import annotations

from loguru import logger

from dere_graph.driver import FalkorDriver
from dere_graph.models import EntityEdge, EntityNode


async def node_bfs_search(
    driver: FalkorDriver,
    origin_uuids: list[str],
    group_id: str,
    max_depth: int = 3,
    limit: int = 100,
) -> list[EntityNode]:
    """Breadth-first search starting from origin nodes.

    Args:
        driver: FalkorDB driver
        origin_uuids: Starting node UUIDs
        group_id: Graph partition
        max_depth: Maximum traversal depth
        limit: Maximum number of nodes to return

    Returns:
        List of EntityNode objects found via BFS
    """
    if not origin_uuids:
        return []

    query = """
    MATCH path = (origin:Entity)-[:RELATES_TO*1..{max_depth}]-(n:Entity)
    WHERE origin.uuid IN $origin_uuids
      AND origin.group_id = $group_id
      AND n.group_id = $group_id
    WITH DISTINCT n, length(path) as distance
    ORDER BY distance
    LIMIT $limit
    RETURN n
    """

    query = query.format(max_depth=max_depth)

    records = await driver.execute_query(
        query,
        origin_uuids=origin_uuids,
        group_id=group_id,
        limit=limit,
    )

    nodes = [driver._dict_to_entity_node(record["n"]) for record in records]

    logger.debug(f"BFS found {len(nodes)} nodes from {len(origin_uuids)} origins")
    return nodes


async def edge_bfs_search(
    driver: FalkorDriver,
    origin_uuids: list[str],
    group_id: str,
    max_depth: int = 3,
    limit: int = 100,
) -> list[EntityEdge]:
    """Breadth-first search for edges starting from origin nodes.

    Args:
        driver: FalkorDB driver
        origin_uuids: Starting node UUIDs
        group_id: Graph partition
        max_depth: Maximum traversal depth
        limit: Maximum number of edges to return

    Returns:
        List of EntityEdge objects found via BFS
    """
    if not origin_uuids:
        return []

    query = """
    MATCH path = (origin:Entity)-[:RELATES_TO*1..{max_depth}]-(n:Entity)
    WHERE origin.uuid IN $origin_uuids
      AND origin.group_id = $group_id
      AND n.group_id = $group_id
    UNWIND relationships(path) as r
    WITH DISTINCT r, startNode(r) as source, endNode(r) as target
    WHERE r.group_id = $group_id
      AND r.invalid_at IS NULL
    RETURN r AS edge, source.uuid AS source_uuid, target.uuid AS target_uuid
    LIMIT $limit
    """

    query = query.format(max_depth=max_depth)

    records = await driver.execute_query(
        query,
        origin_uuids=origin_uuids,
        group_id=group_id,
        limit=limit,
    )

    edges = [
        driver._dict_to_entity_edge(record["edge"], record["source_uuid"], record["target_uuid"])
        for record in records
    ]

    logger.debug(f"BFS found {len(edges)} edges from {len(origin_uuids)} origins")
    return edges


async def calculate_node_distances(
    driver: FalkorDriver,
    center_uuid: str,
    node_uuids: list[str],
    group_id: str,
    max_depth: int = 3,
) -> dict[str, int]:
    """Calculate shortest path distance from center node to each node.

    Args:
        driver: FalkorDB driver
        center_uuid: Center node UUID
        node_uuids: Target node UUIDs to calculate distance to
        group_id: Graph partition
        max_depth: Maximum path length to consider

    Returns:
        Dictionary mapping node UUID to distance (nodes not reachable are omitted)
    """
    if not node_uuids:
        return {}

    query = """
    MATCH (center:Entity {uuid: $center_uuid})
    WHERE center.group_id = $group_id
    UNWIND $node_uuids as target_uuid
    MATCH path = shortestPath((center)-[:RELATES_TO*1..{max_depth}]-(target:Entity {uuid: target_uuid}))
    WHERE target.group_id = $group_id
    RETURN target.uuid as uuid, length(path) as distance
    """

    query = query.format(max_depth=max_depth)

    records = await driver.execute_query(
        query,
        center_uuid=center_uuid,
        node_uuids=node_uuids,
        group_id=group_id,
    )

    distances = {}
    for record in records:
        distances[record["uuid"]] = record["distance"]

    return distances


def node_distance_reranker(
    nodes: list[EntityNode],
    center_uuid: str,
    distances: dict[str, int],
    distance_weight: float = 0.5,
) -> list[EntityNode]:
    """Rerank nodes based on distance from center node.

    Nodes closer to the center node are ranked higher.

    Args:
        nodes: List of nodes to rerank
        center_uuid: Center node UUID
        distances: Dictionary of node UUID -> distance
        distance_weight: Weight for distance scoring (0-1)

    Returns:
        Reranked list of nodes
    """
    if not distances or distance_weight == 0:
        return nodes

    # Calculate max distance for normalization
    max_distance = max(distances.values()) if distances else 1

    def score_node(node: EntityNode) -> float:
        """Score node based on distance (closer = higher score)."""
        if node.uuid == center_uuid:
            return 1.0

        distance = distances.get(node.uuid)
        if distance is None:
            # Node not reachable, give lowest score
            return 0.0

        # Normalize distance (0 = closest, 1 = farthest)
        normalized_distance = distance / max_distance

        # Invert so closer = higher score
        proximity_score = 1.0 - normalized_distance

        # Apply weight (can blend with other scores)
        return distance_weight * proximity_score

    # Sort by score descending
    scored_nodes = [(node, score_node(node)) for node in nodes]
    scored_nodes.sort(key=lambda x: x[1], reverse=True)

    reranked = [node for node, score in scored_nodes]

    logger.debug(f"Reranked {len(nodes)} nodes by distance from {center_uuid}")
    return reranked
