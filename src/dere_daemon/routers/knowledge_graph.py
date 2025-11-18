"""Knowledge graph endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request
from loguru import logger

router = APIRouter(prefix="/kg", tags=["knowledge_graph"])


@router.get("/entity/{entity_name}")
async def get_entity_info(entity_name: str, user_id: str | None = None, request: Request = None):
    """Get information about an entity from the knowledge graph"""
    app_state = request.app.state

    if not app_state.dere_graph:
        return {"error": "Knowledge graph not available"}, 503

    try:
        # Search for the entity
        results = await app_state.dere_graph.search(
            query=entity_name,
            group_id=user_id or "default",
            limit=10,
        )

        # Find exact matches in nodes
        entity_nodes = [n for n in results.nodes if entity_name.lower() in n.name.lower()]

        if not entity_nodes:
            return {"entity": entity_name, "found": False, "nodes": [], "edges": []}

        # Get the primary entity node
        primary_node = entity_nodes[0]

        # Get related entities via BFS
        related_results = await app_state.dere_graph.bfs_search_nodes(
            origin_uuids=[primary_node.uuid],
            group_id=user_id or "default",
            max_depth=1,
            limit=20,
        )

        return {
            "entity": entity_name,
            "found": True,
            "primary_node": {
                "uuid": primary_node.uuid,
                "name": primary_node.name,
                "labels": primary_node.labels,
                "created_at": primary_node.created_at.isoformat()
                if primary_node.created_at
                else None,
            },
            "related_nodes": [
                {
                    "uuid": n.uuid,
                    "name": n.name,
                    "labels": n.labels,
                }
                for n in related_results.nodes
                if n.uuid != primary_node.uuid
            ],
            "relationships": [
                {
                    "uuid": e.uuid,
                    "fact": e.fact,
                    "source": e.source_node_uuid,
                    "target": e.target_node_uuid,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in related_results.edges
            ],
        }
    except Exception as e:
        logger.error(f"Entity info retrieval failed: {e}")
        return {"error": str(e)}, 500


@router.get("/entity/{entity_name}/related")
async def get_related_entities(
    entity_name: str, user_id: str | None = None, limit: int = 20, request: Request = None
):
    """Get entities related to the given entity via knowledge graph"""
    app_state = request.app.state

    if not app_state.dere_graph:
        return {"error": "Knowledge graph not available"}, 503

    try:
        # Search for the entity
        search_results = await app_state.dere_graph.search(
            query=entity_name,
            group_id=user_id or "default",
            limit=1,
        )

        if not search_results.nodes:
            return {"entity": entity_name, "found": False, "related": []}

        primary_node = search_results.nodes[0]

        # Get related entities via BFS
        related_results = await app_state.dere_graph.bfs_search_nodes(
            origin_uuids=[primary_node.uuid],
            group_id=user_id or "default",
            max_depth=2,
            limit=limit,
        )

        return {
            "entity": entity_name,
            "found": True,
            "related": [
                {
                    "name": n.name,
                    "labels": n.labels,
                    "uuid": n.uuid,
                }
                for n in related_results.nodes
                if n.uuid != primary_node.uuid
            ],
        }
    except Exception as e:
        logger.error(f"Related entities retrieval failed: {e}")
        return {"error": str(e)}, 500
