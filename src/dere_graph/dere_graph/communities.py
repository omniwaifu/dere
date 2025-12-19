from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import numpy as np
from loguru import logger

from dere_graph.driver import FalkorDriver
from dere_graph.llm_client import ClaudeClient
from dere_graph.models import CommunityNode, EntityNode


@dataclass
class CommunityBuildResult:
    community: CommunityNode
    member_uuids: list[str]


def _build_community_name(members: list[EntityNode], fallback: str) -> str:
    names = sorted({member.name for member in members if member.name})
    if not names:
        return fallback
    return "Community: " + ", ".join(names[:3])


class CommunityDetector:
    """Detects communities in the entity graph using Leiden algorithm."""

    def __init__(self, driver: FalkorDriver, llm_client: ClaudeClient):
        self.driver = driver
        self.llm_client = llm_client

    async def build_communities(
        self,
        group_id: str,
        resolution: float = 1.0,
    ) -> list[CommunityBuildResult]:
        """Build communities using Leiden algorithm and summarize with LLM.

        Args:
            group_id: The group to build communities for
            resolution: Resolution parameter for Leiden (higher = more communities)

        Returns:
            List of CommunityBuildResult objects with summaries and member UUIDs
        """
        # Fetch all entities and edges for this group
        entities, edges = await self._fetch_graph_data(group_id)

        if len(entities) < 2:
            logger.info(f"Not enough entities ({len(entities)}) to form communities")
            return []

        # Build adjacency matrix
        entity_to_idx = {entity.uuid: i for i, entity in enumerate(entities)}
        adj_matrix = self._build_adjacency_matrix(entities, edges, entity_to_idx)

        # Run Leiden algorithm
        communities_dict = self._leiden_clustering(adj_matrix, resolution)

        # Group entities by community
        community_groups: dict[int, list[EntityNode]] = defaultdict(list)
        for entity_idx, community_id in communities_dict.items():
            entity = entities[entity_idx]
            community_groups[community_id].append(entity)

        logger.info(f"Detected {len(community_groups)} communities")

        # Create CommunityNode objects and generate summaries
        community_nodes: list[CommunityBuildResult] = []
        for community_id, members in community_groups.items():
            if len(members) < 2:
                continue  # Skip single-entity communities

            # Generate summary using LLM
            summary = await self._summarize_community(members, edges, entity_to_idx)
            name = _build_community_name(members, f"Community {community_id}")

            community_node = CommunityNode(
                name=name,
                group_id=group_id,
                summary=summary,
            )
            community_nodes.append(
                CommunityBuildResult(
                    community=community_node,
                    member_uuids=[member.uuid for member in members],
                )
            )

        logger.info(f"Created {len(community_nodes)} community nodes")
        return community_nodes

    async def _fetch_graph_data(self, group_id: str) -> tuple[list[EntityNode], list[dict]]:
        """Fetch all entities and edges for community detection."""
        # Fetch entities
        entity_records = await self.driver.execute_query(
            """
            MATCH (n:Entity {group_id: $group_id})
            WHERE n.name_embedding IS NOT NULL
            RETURN n.uuid AS uuid,
                   n.name AS name,
                   n.group_id AS group_id,
                   n.summary AS summary,
                   labels(n) AS labels
            """,
            group_id=group_id,
        )

        entities = [
            EntityNode(
                uuid=record["uuid"],
                name=record["name"],
                group_id=record["group_id"],
                summary=record["summary"] or "",
                labels=[label for label in record["labels"] if label != "Entity"],
            )
            for record in entity_records
        ]

        # Fetch edges
        edge_records = await self.driver.execute_query(
            """
            MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
            WHERE r.group_id = $group_id
              AND r.invalid_at IS NULL
            RETURN source.uuid AS source_uuid,
                   target.uuid AS target_uuid,
                   r.name AS relation_type,
                   r.fact AS fact
            """,
            group_id=group_id,
        )

        edges = [
            {
                "source_uuid": record["source_uuid"],
                "target_uuid": record["target_uuid"],
                "relation_type": record["relation_type"],
                "fact": record["fact"],
            }
            for record in edge_records
        ]

        return entities, edges

    def _build_adjacency_matrix(
        self,
        entities: list[EntityNode],
        edges: list[dict],
        entity_to_idx: dict[str, int],
    ) -> np.ndarray:
        """Build weighted adjacency matrix from entities and edges."""
        n = len(entities)
        adj_matrix = np.zeros((n, n), dtype=float)

        for edge in edges:
            source_idx = entity_to_idx.get(edge["source_uuid"])
            target_idx = entity_to_idx.get(edge["target_uuid"])

            if source_idx is not None and target_idx is not None:
                # Undirected graph - add weight to both directions
                adj_matrix[source_idx, target_idx] += 1.0
                adj_matrix[target_idx, source_idx] += 1.0

        return adj_matrix

    def _leiden_clustering(self, adj_matrix: np.ndarray, resolution: float = 1.0) -> dict[int, int]:
        """Simple Leiden-inspired clustering algorithm.

        This is a simplified version that uses a greedy modularity optimization approach.
        For production use, consider using the python-igraph + leidenalg libraries.
        """
        n = adj_matrix.shape[0]

        # Initialize each node in its own community
        communities = {i: i for i in range(n)}

        # Calculate total edge weight
        total_weight = np.sum(adj_matrix) / 2.0

        if total_weight == 0:
            return communities

        # Node degrees
        degrees = np.sum(adj_matrix, axis=1)

        # Greedy modularity optimization
        improved = True
        iterations = 0
        max_iterations = 100

        while improved and iterations < max_iterations:
            improved = False
            iterations += 1

            # For each node, try moving it to neighbor communities
            for node in range(n):
                current_community = communities[node]
                best_community = current_community
                best_delta = 0.0

                # Get neighboring nodes
                neighbors = np.where(adj_matrix[node] > 0)[0]

                # Try each neighbor's community
                neighbor_communities = {communities[neighbor] for neighbor in neighbors}

                for candidate_community in neighbor_communities:
                    if candidate_community == current_community:
                        continue

                    # Calculate modularity delta
                    delta = self._modularity_delta(
                        node,
                        current_community,
                        candidate_community,
                        communities,
                        adj_matrix,
                        degrees,
                        total_weight,
                        resolution,
                    )

                    if delta > best_delta:
                        best_delta = delta
                        best_community = candidate_community

                # Move node if improvement found
                if best_community != current_community:
                    communities[node] = best_community
                    improved = True

        # Renumber communities to be contiguous
        unique_communities = sorted(set(communities.values()))
        community_map = {old_id: new_id for new_id, old_id in enumerate(unique_communities)}
        communities = {node: community_map[comm] for node, comm in communities.items()}

        return communities

    def _modularity_delta(
        self,
        node: int,
        from_community: int,
        to_community: int,
        communities: dict[int, int],
        adj_matrix: np.ndarray,
        degrees: np.ndarray,
        total_weight: float,
        resolution: float,
    ) -> float:
        """Calculate the change in modularity from moving a node between communities."""
        # Weight of edges from node to nodes in target community
        to_community_weight = sum(
            adj_matrix[node, other]
            for other in range(len(communities))
            if communities[other] == to_community
        )

        # Weight of edges from node to nodes in current community
        from_community_weight = sum(
            adj_matrix[node, other]
            for other in range(len(communities))
            if communities[other] == from_community and other != node
        )

        # Modularity delta (simplified)
        delta = (to_community_weight - from_community_weight) / total_weight * resolution

        return delta

    async def _summarize_community(
        self,
        members: list[EntityNode],
        edges: list[dict],
        entity_to_idx: dict[str, int],
    ) -> str:
        """Generate a summary of the community using LLM."""
        from dere_graph.prompts import summarize_community

        # Get edges within this community
        member_uuids = {entity.uuid for entity in members}
        community_edges = [
            edge
            for edge in edges
            if edge["source_uuid"] in member_uuids and edge["target_uuid"] in member_uuids
        ]

        # Prepare data for LLM
        members_data = [
            {"name": entity.name, "labels": entity.labels, "summary": entity.summary}
            for entity in members
        ]

        edges_data = [
            {
                "source": edge["source_uuid"],
                "target": edge["target_uuid"],
                "relation": edge["relation_type"],
                "fact": edge["fact"],
            }
            for edge in community_edges
        ]

        messages = summarize_community(members_data, edges_data)

        response = await self.llm_client.generate_text_response(messages)
        return response.strip()
