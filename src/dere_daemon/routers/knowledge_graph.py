"""Knowledge graph endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Request
from loguru import logger
from pydantic import BaseModel


# Response Models
class EntitySummary(BaseModel):
    """Summary of a knowledge graph entity."""

    uuid: str
    name: str
    labels: list[str]
    summary: str
    mention_count: int
    retrieval_quality: float
    last_mentioned: str | None
    created_at: str


class EdgeSummary(BaseModel):
    """Summary of a knowledge graph edge/fact."""

    uuid: str
    source_uuid: str
    source_name: str
    target_uuid: str
    target_name: str
    relation: str
    fact: str
    strength: float | None
    valid_at: str | None
    invalid_at: str | None
    created_at: str


class FactRoleSummary(BaseModel):
    """Role binding for a fact node."""

    entity_uuid: str
    entity_name: str
    role: str
    role_description: str | None = None


class FactSummary(BaseModel):
    """Summary of a hyper-edge fact node."""

    uuid: str
    fact: str
    roles: list[FactRoleSummary]
    attributes: dict[str, Any] | None = None
    valid_at: str | None
    invalid_at: str | None
    created_at: str


class EntityListResponse(BaseModel):
    """Paginated list of entities."""

    entities: list[EntitySummary]
    total: int
    offset: int
    limit: int


class SearchResultsResponse(BaseModel):
    """Search results with entities and edges."""

    entities: list[EntitySummary]
    edges: list[EdgeSummary]
    facts: list[FactSummary]
    query: str


class TimelineFact(BaseModel):
    """A fact with temporal status."""

    edge: EdgeSummary
    temporal_status: str  # "valid", "expired", "future"


class FactsTimelineResponse(BaseModel):
    """Timeline of facts."""

    facts: list[TimelineFact]
    total: int
    offset: int


class FactSearchResponse(BaseModel):
    """Search results for fact nodes."""

    facts: list[FactSummary]
    query: str


class TopEntity(BaseModel):
    """Entity with ranking metrics."""

    uuid: str
    name: str
    labels: list[str]
    mention_count: int
    retrieval_quality: float


class TopFactRole(BaseModel):
    """Role summary for fact stats."""

    role: str
    count: int


class TopFactEntity(BaseModel):
    """Entity summary for fact stats."""

    uuid: str
    name: str
    labels: list[str]
    count: int


class KGStatsResponse(BaseModel):
    """Knowledge graph statistics."""

    total_entities: int
    total_facts: int
    total_edges: int
    total_communities: int
    top_mentioned: list[TopEntity]
    top_quality: list[TopEntity]
    top_fact_roles: list[TopFactRole]
    top_fact_entities: list[TopFactEntity]
    label_distribution: dict[str, int]


class CommunityInfo(BaseModel):
    """Community cluster information."""

    name: str
    summary: str
    member_count: int


class CommunitiesResponse(BaseModel):
    """List of communities."""

    communities: list[CommunityInfo]


class LabelsResponse(BaseModel):
    """Available entity labels."""

    labels: list[str]


router = APIRouter(prefix="/kg", tags=["knowledge_graph"])


def _entity_to_summary(node) -> EntitySummary:
    """Convert EntityNode to EntitySummary."""
    return EntitySummary(
        uuid=node.uuid,
        name=node.name,
        labels=node.labels,
        summary=node.summary or "",
        mention_count=node.mention_count,
        retrieval_quality=node.retrieval_quality,
        last_mentioned=node.last_mentioned.isoformat() if node.last_mentioned else None,
        created_at=node.created_at.isoformat() if node.created_at else "",
    )


def _edge_to_summary(edge, source_name: str = "", target_name: str = "") -> EdgeSummary:
    """Convert EntityEdge to EdgeSummary."""
    return EdgeSummary(
        uuid=edge.uuid,
        source_uuid=edge.source_node_uuid,
        source_name=source_name,
        target_uuid=edge.target_node_uuid,
        target_name=target_name,
        relation=edge.name,
        fact=edge.fact,
        strength=edge.strength,
        valid_at=edge.valid_at.isoformat() if edge.valid_at else None,
        invalid_at=edge.invalid_at.isoformat() if edge.invalid_at else None,
        created_at=edge.created_at.isoformat() if edge.created_at else "",
    )


def _fact_to_summary(fact, roles: list[FactRoleSummary]) -> FactSummary:
    """Convert FactNode + roles to FactSummary."""
    attributes = fact.attributes if hasattr(fact, "attributes") else None
    return FactSummary(
        uuid=fact.uuid,
        fact=fact.fact,
        roles=roles,
        attributes=attributes,
        valid_at=fact.valid_at.isoformat() if fact.valid_at else None,
        invalid_at=fact.invalid_at.isoformat() if fact.invalid_at else None,
        created_at=fact.created_at.isoformat() if fact.created_at else "",
    )

@router.get("/stats", response_model=KGStatsResponse)
async def get_kg_stats(request: Request, user_id: str | None = None):
    """Get knowledge graph statistics."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return KGStatsResponse(
            total_entities=0,
            total_facts=0,
            total_edges=0,
            total_communities=0,
            top_mentioned=[],
            top_quality=[],
            top_fact_roles=[],
            top_fact_entities=[],
            label_distribution={},
        )

    try:
        driver = app_state.dere_graph.driver

        # Count entities
        entity_count_result = await driver.execute_query(
            "MATCH (n:Entity {group_id: $group_id}) RETURN count(n) as count",
            group_id=group_id,
        )
        total_entities = entity_count_result[0]["count"] if entity_count_result else 0

        # Count fact nodes
        fact_count_result = await driver.execute_query(
            "MATCH (f:Fact {group_id: $group_id}) RETURN count(f) as count",
            group_id=group_id,
        )
        total_facts = fact_count_result[0]["count"] if fact_count_result else 0

        # Count edges
        edge_count_result = await driver.execute_query(
            "MATCH ()-[r:RELATES_TO {group_id: $group_id}]->() RETURN count(r) as count",
            group_id=group_id,
        )
        total_edges = edge_count_result[0]["count"] if edge_count_result else 0

        # Get top mentioned entities
        top_mentioned_result = await driver.execute_query(
            """
            MATCH (n:Entity {group_id: $group_id})
            RETURN n
            ORDER BY n.mention_count DESC
            LIMIT 5
            """,
            group_id=group_id,
        )
        top_mentioned = [
            TopEntity(
                uuid=r["n"]["uuid"],
                name=r["n"]["name"],
                labels=r["n"].get("labels", []),
                mention_count=r["n"].get("mention_count", 1),
                retrieval_quality=r["n"].get("retrieval_quality", 1.0),
            )
            for r in top_mentioned_result
        ]

        # Get top quality entities (with at least some retrievals)
        top_quality_result = await driver.execute_query(
            """
            MATCH (n:Entity {group_id: $group_id})
            WHERE n.retrieval_count > 0
            RETURN n
            ORDER BY n.retrieval_quality DESC, n.citation_count DESC
            LIMIT 5
            """,
            group_id=group_id,
        )
        top_quality = [
            TopEntity(
                uuid=r["n"]["uuid"],
                name=r["n"]["name"],
                labels=r["n"].get("labels", []),
                mention_count=r["n"].get("mention_count", 1),
                retrieval_quality=r["n"].get("retrieval_quality", 1.0),
            )
            for r in top_quality_result
        ]

        # Top fact roles
        top_role_result = await driver.execute_query(
            """
            MATCH (f:Fact {group_id: $group_id})-[r:HAS_ROLE]->()
            WHERE r.role IS NOT NULL
            RETURN r.role AS role, count(*) AS count
            ORDER BY count DESC
            LIMIT 5
            """,
            group_id=group_id,
        )
        top_fact_roles = [
            TopFactRole(role=r["role"], count=r["count"]) for r in top_role_result
        ]

        # Top entities referenced by fact roles
        top_fact_entities_result = await driver.execute_query(
            """
            MATCH (f:Fact {group_id: $group_id})-[r:HAS_ROLE]->(e:Entity {group_id: $group_id})
            RETURN e.uuid AS uuid, e.name AS name, e.labels AS labels, count(*) AS count
            ORDER BY count DESC
            LIMIT 5
            """,
            group_id=group_id,
        )
        top_fact_entities = [
            TopFactEntity(
                uuid=r["uuid"],
                name=r["name"],
                labels=r.get("labels", []),
                count=r["count"],
            )
            for r in top_fact_entities_result
        ]

        # Get label distribution
        label_result = await driver.execute_query(
            """
            MATCH (n:Entity {group_id: $group_id})
            UNWIND n.labels AS label
            RETURN label, count(*) as count
            ORDER BY count DESC
            """,
            group_id=group_id,
        )
        label_distribution = {r["label"]: r["count"] for r in label_result}

        # Count communities (if available)
        total_communities = 0
        try:
            community_count_result = await driver.execute_query(
                "MATCH (c:Community {group_id: $group_id}) RETURN count(c) as count",
                group_id=group_id,
            )
            total_communities = (
                community_count_result[0]["count"] if community_count_result else 0
            )
        except Exception:
            pass  # Communities may not exist yet

        return KGStatsResponse(
            total_entities=total_entities,
            total_facts=total_facts,
            total_edges=total_edges,
            total_communities=total_communities,
            top_mentioned=top_mentioned,
            top_quality=top_quality,
            top_fact_roles=top_fact_roles,
            top_fact_entities=top_fact_entities,
            label_distribution=label_distribution,
        )
    except Exception as e:
        logger.error(f"KG stats retrieval failed: {e}")
        return KGStatsResponse(
            total_entities=0,
            total_facts=0,
            total_edges=0,
            total_communities=0,
            top_mentioned=[],
            top_quality=[],
            top_fact_roles=[],
            top_fact_entities=[],
            label_distribution={},
        )


@router.get("/labels", response_model=LabelsResponse)
async def get_entity_labels(request: Request, user_id: str | None = None):
    """Get all unique entity labels for filtering."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return LabelsResponse(labels=[])

    try:
        driver = app_state.dere_graph.driver
        result = await driver.execute_query(
            """
            MATCH (n:Entity {group_id: $group_id})
            UNWIND n.labels AS label
            RETURN DISTINCT label
            ORDER BY label
            """,
            group_id=group_id,
        )
        labels = [r["label"] for r in result]
        return LabelsResponse(labels=labels)
    except Exception as e:
        logger.error(f"Labels retrieval failed: {e}")
        return LabelsResponse(labels=[])


@router.get("/entities", response_model=EntityListResponse)
async def list_entities(
    request: Request,
    user_id: str | None = None,
    labels: list[str] | None = Query(None),
    sort_by: str = "mention_count",
    sort_order: str = "desc",
    limit: int = 50,
    offset: int = 0,
):
    """List entities with filtering and pagination."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return EntityListResponse(entities=[], total=0, offset=offset, limit=limit)

    try:
        driver = app_state.dere_graph.driver

        # Build query with optional label filter
        label_filter = ""
        if labels:
            label_filter = "AND ANY(l IN n.labels WHERE l IN $labels)"

        # Validate sort_by
        valid_sorts = ["mention_count", "retrieval_quality", "last_mentioned", "created_at", "name"]
        if sort_by not in valid_sorts:
            sort_by = "mention_count"

        order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"

        # Count total
        count_query = f"""
            MATCH (n:Entity {{group_id: $group_id}})
            WHERE true {label_filter}
            RETURN count(n) as total
        """
        count_result = await driver.execute_query(
            count_query, group_id=group_id, labels=labels or []
        )
        total = count_result[0]["total"] if count_result else 0

        # Fetch entities
        query = f"""
            MATCH (n:Entity {{group_id: $group_id}})
            WHERE true {label_filter}
            RETURN n
            ORDER BY n.{sort_by} {order_dir}
            SKIP $offset
            LIMIT $limit
        """
        result = await driver.execute_query(
            query, group_id=group_id, labels=labels or [], offset=offset, limit=limit
        )

        entities = []
        for r in result:
            node_data = r["n"]
            entities.append(
                EntitySummary(
                    uuid=node_data["uuid"],
                    name=node_data["name"],
                    labels=node_data.get("labels", []),
                    summary=node_data.get("summary", ""),
                    mention_count=node_data.get("mention_count", 1),
                    retrieval_quality=node_data.get("retrieval_quality", 1.0),
                    last_mentioned=node_data.get("last_mentioned"),
                    created_at=node_data.get("created_at", ""),
                )
            )

        return EntityListResponse(
            entities=entities, total=total, offset=offset, limit=limit
        )
    except Exception as e:
        logger.error(f"Entity listing failed: {e}")
        return EntityListResponse(entities=[], total=0, offset=offset, limit=limit)


@router.get("/search", response_model=SearchResultsResponse)
async def search_knowledge(
    request: Request,
    query: str,
    user_id: str | None = None,
    limit: int = 20,
    include_edges: bool = True,
    include_facts: bool = True,
    include_fact_roles: bool = True,
    rerank_method: str | None = None,
    labels: list[str] | None = Query(None),
):
    """Search knowledge graph with context (entities and their relationships)."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return SearchResultsResponse(entities=[], edges=[], facts=[], query=query)

    try:
        # Use dere_graph search
        results = await app_state.dere_graph.search(
            query=query,
            group_id=group_id,
            limit=limit,
        )

        # Filter by labels if provided
        nodes = results.nodes
        if labels:
            nodes = [n for n in nodes if any(lbl in n.labels for lbl in labels)]

        entities = [_entity_to_summary(n) for n in nodes]

        # Build name lookup for edges
        name_lookup = {n.uuid: n.name for n in nodes}

        edges = []
        if include_edges and results.edges:
            for e in results.edges:
                edges.append(
                    _edge_to_summary(
                        e,
                        source_name=name_lookup.get(e.source_node_uuid, ""),
                        target_name=name_lookup.get(e.target_node_uuid, ""),
                    )
                )

        facts = []
        if include_facts and results.facts:
            roles_lookup = {}
            if include_fact_roles:
                roles_lookup = await app_state.dere_graph.get_fact_roles(
                    results.facts,
                    group_id=group_id,
                )

            for fact in results.facts:
                role_entries = roles_lookup.get(fact.uuid, [])
                roles = [
                    FactRoleSummary(
                        entity_uuid=role.entity_uuid,
                        entity_name=role.entity_name,
                        role=role.role,
                        role_description=role.role_description,
                    )
                    for role in role_entries
                ]
                facts.append(_fact_to_summary(fact, roles))

        return SearchResultsResponse(entities=entities, edges=edges, facts=facts, query=query)
    except Exception as e:
        logger.error(f"Knowledge search failed: {e}")
        return SearchResultsResponse(entities=[], edges=[], facts=[], query=query)


@router.get("/facts/search", response_model=FactSearchResponse)
async def search_facts(
    request: Request,
    query: str,
    user_id: str | None = None,
    limit: int = 20,
    include_roles: bool = True,
):
    """Search fact nodes only."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return FactSearchResponse(facts=[], query=query)

    try:
        results = await app_state.dere_graph.search(
            query=query,
            group_id=group_id,
            limit=limit,
        )

        roles_lookup = {}
        if include_roles and results.facts:
            roles_lookup = await app_state.dere_graph.get_fact_roles(
                results.facts,
                group_id=group_id,
            )

        facts = []
        for fact in results.facts:
            role_entries = roles_lookup.get(fact.uuid, [])
            roles = [
                FactRoleSummary(
                    entity_uuid=role.entity_uuid,
                    entity_name=role.entity_name,
                    role=role.role,
                    role_description=role.role_description,
                )
                for role in role_entries
            ]
            facts.append(_fact_to_summary(fact, roles))

        return FactSearchResponse(facts=facts, query=query)
    except Exception as e:
        logger.error(f"Fact search failed: {e}")
        return FactSearchResponse(facts=[], query=query)


@router.get("/facts/at_time", response_model=FactSearchResponse)
async def facts_at_time(
    request: Request,
    timestamp: datetime,
    user_id: str | None = None,
    limit: int = 100,
    include_roles: bool = True,
):
    """Get facts valid at a specific time."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return FactSearchResponse(facts=[], query="")

    try:
        facts = await app_state.dere_graph.get_facts_at_time(
            timestamp=timestamp,
            group_id=group_id,
            limit=limit,
        )

        roles_lookup = {}
        if include_roles and facts:
            roles_lookup = await app_state.dere_graph.get_fact_roles(
                facts,
                group_id=group_id,
            )

        summaries = []
        for fact in facts:
            role_entries = roles_lookup.get(fact.uuid, [])
            roles = [
                FactRoleSummary(
                    entity_uuid=role.entity_uuid,
                    entity_name=role.entity_name,
                    role=role.role,
                    role_description=role.role_description,
                )
                for role in role_entries
            ]
            summaries.append(_fact_to_summary(fact, roles))

        return FactSearchResponse(facts=summaries, query="")
    except Exception as e:
        logger.error(f"Fact at_time lookup failed: {e}")
        return FactSearchResponse(facts=[], query="")


@router.get("/facts/timeline", response_model=FactsTimelineResponse)
async def get_facts_timeline(
    request: Request,
    user_id: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    entity_uuid: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    """Get chronological timeline of facts/edges."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return FactsTimelineResponse(facts=[], total=0, offset=offset)

    try:
        driver = app_state.dere_graph.driver
        now = datetime.utcnow()

        # Build filters
        filters = []
        params = {"group_id": group_id, "offset": offset, "limit": limit}

        if start_date:
            filters.append("r.created_at >= $start_date")
            params["start_date"] = start_date.isoformat()
        if end_date:
            filters.append("r.created_at <= $end_date")
            params["end_date"] = end_date.isoformat()
        if entity_uuid:
            filters.append("(src.uuid = $entity_uuid OR tgt.uuid = $entity_uuid)")
            params["entity_uuid"] = entity_uuid

        where_clause = " AND ".join(filters) if filters else "true"

        # Count total
        count_query = f"""
            MATCH (src:Entity)-[r:RELATES_TO {{group_id: $group_id}}]->(tgt:Entity)
            WHERE {where_clause}
            RETURN count(r) as total
        """
        count_result = await driver.execute_query(count_query, **params)
        total = count_result[0]["total"] if count_result else 0

        # Fetch edges with source/target names
        query = f"""
            MATCH (src:Entity)-[r:RELATES_TO {{group_id: $group_id}}]->(tgt:Entity)
            WHERE {where_clause}
            RETURN r, src.uuid as source_uuid, src.name as source_name,
                   tgt.uuid as target_uuid, tgt.name as target_name
            ORDER BY r.created_at DESC
            SKIP $offset
            LIMIT $limit
        """
        result = await driver.execute_query(query, **params)

        facts = []
        for row in result:
            edge_data = row["r"]

            # Determine temporal status
            valid_at = edge_data.get("valid_at")
            invalid_at = edge_data.get("invalid_at")
            expired_at = edge_data.get("expired_at")

            if expired_at:
                temporal_status = "expired"
            elif invalid_at and datetime.fromisoformat(invalid_at) < now:
                temporal_status = "expired"
            elif valid_at and datetime.fromisoformat(valid_at) > now:
                temporal_status = "future"
            else:
                temporal_status = "valid"

            edge_summary = EdgeSummary(
                uuid=edge_data["uuid"],
                source_uuid=row["source_uuid"],
                source_name=row["source_name"],
                target_uuid=row["target_uuid"],
                target_name=row["target_name"],
                relation=edge_data.get("name", ""),
                fact=edge_data.get("fact", ""),
                strength=edge_data.get("strength"),
                valid_at=edge_data.get("valid_at"),
                invalid_at=edge_data.get("invalid_at"),
                created_at=edge_data.get("created_at", ""),
            )
            facts.append(TimelineFact(edge=edge_summary, temporal_status=temporal_status))

        return FactsTimelineResponse(facts=facts, total=total, offset=offset)
    except Exception as e:
        logger.error(f"Facts timeline retrieval failed: {e}")
        return FactsTimelineResponse(facts=[], total=0, offset=offset)


@router.get("/communities", response_model=CommunitiesResponse)
async def list_communities(
    request: Request, user_id: str | None = None, limit: int = 20
):
    """List entity communities/clusters."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return CommunitiesResponse(communities=[])

    try:
        driver = app_state.dere_graph.driver

        # Query communities with member counts
        result = await driver.execute_query(
            """
            MATCH (c:Community {group_id: $group_id})
            OPTIONAL MATCH (c)-[:HAS_MEMBER]->(e:Entity)
            RETURN c.name as name, c.summary as summary, count(e) as member_count
            ORDER BY member_count DESC
            LIMIT $limit
            """,
            group_id=group_id,
            limit=limit,
        )

        communities = [
            CommunityInfo(
                name=r["name"] or "",
                summary=r["summary"] or "",
                member_count=r["member_count"],
            )
            for r in result
        ]

        return CommunitiesResponse(communities=communities)
    except Exception as e:
        logger.error(f"Communities retrieval failed: {e}")
        return CommunitiesResponse(communities=[])


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
