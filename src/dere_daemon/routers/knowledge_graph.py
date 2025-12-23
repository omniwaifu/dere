"""Knowledge graph endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from loguru import logger
from pydantic import BaseModel

from dere_graph.filters import SearchFilters


# Response Models
def _node_props(node: Any) -> dict[str, Any]:
    """Normalize FalkorDB node objects to plain dicts."""
    if node is None:
        return {}
    if isinstance(node, dict):
        return node
    props = dict(getattr(node, "properties", {}) or {})
    labels = getattr(node, "labels", None)
    if labels is not None:
        props.setdefault("labels", list(labels))
    return props


def _edge_props(edge: Any) -> dict[str, Any]:
    """Normalize FalkorDB edge objects to plain dicts."""
    if edge is None:
        return {}
    if isinstance(edge, dict):
        return edge
    return dict(getattr(edge, "properties", {}) or {})

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
    """A timeline entry for edges or hyper-edge facts."""

    kind: str  # "edge" | "fact"
    edge: EdgeSummary | None = None
    fact: FactSummary | None = None
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


class ArchivalFactInsertRequest(BaseModel):
    """Request payload for inserting archival facts."""

    fact: str
    source: str | None = None
    tags: list[str] | None = None
    valid_at: datetime | None = None
    invalid_at: datetime | None = None


class ArchivalFactInsertResponse(BaseModel):
    """Response payload for inserted archival facts."""

    created: bool
    fact: FactSummary


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


def _normalize_dt(value: datetime) -> datetime:
    """Normalize datetimes to timezone-aware UTC for comparisons."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _fact_in_range(
    fact,
    start_date: datetime | None,
    end_date: datetime | None,
) -> bool:
    if not start_date and not end_date:
        return True

    candidate = fact.valid_at or fact.created_at
    if not candidate:
        return False

    candidate = _normalize_dt(candidate)
    if start_date and candidate < start_date:
        return False
    if end_date and candidate > end_date:
        return False
    return True

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
        top_mentioned = []
        for row in top_mentioned_result:
            node_data = _node_props(row.get("n"))
            if not node_data:
                continue
            top_mentioned.append(
                TopEntity(
                    uuid=node_data.get("uuid", ""),
                    name=node_data.get("name", ""),
                    labels=node_data.get("labels", []),
                    mention_count=node_data.get("mention_count", 1),
                    retrieval_quality=node_data.get("retrieval_quality", 1.0),
                )
            )

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
        top_quality = []
        for row in top_quality_result:
            node_data = _node_props(row.get("n"))
            if not node_data:
                continue
            top_quality.append(
                TopEntity(
                    uuid=node_data.get("uuid", ""),
                    name=node_data.get("name", ""),
                    labels=node_data.get("labels", []),
                    mention_count=node_data.get("mention_count", 1),
                    retrieval_quality=node_data.get("retrieval_quality", 1.0),
                )
            )

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
            node_data = _node_props(r.get("n"))
            if not node_data:
                continue
            entities.append(
                EntitySummary(
                    uuid=node_data.get("uuid", ""),
                    name=node_data.get("name", ""),
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
    include_expired: bool = False,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    archival_only: bool = False,
):
    """Search fact nodes only."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        return FactSearchResponse(facts=[], query=query)

    try:
        filters = None
        if archival_only:
            filters = SearchFilters(node_attributes={"archival": True})

        fetch_limit = limit
        if start_date or end_date:
            fetch_limit = max(limit * 3, limit)

        results = await app_state.dere_graph.search_facts(
            query=query,
            group_id=group_id,
            limit=fetch_limit,
            filters=filters,
            include_expired=include_expired,
        )

        roles_lookup = {}
        if include_roles and results:
            roles_lookup = await app_state.dere_graph.get_fact_roles(
                results,
                group_id=group_id,
            )

        facts = []
        start_dt = _normalize_dt(start_date) if start_date else None
        end_dt = _normalize_dt(end_date) if end_date else None

        for fact in results:
            if not _fact_in_range(fact, start_dt, end_dt):
                continue
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
            if len(facts) >= limit:
                break

        return FactSearchResponse(facts=facts, query=query)
    except Exception as e:
        logger.error(f"Fact search failed: {e}")
        return FactSearchResponse(facts=[], query=query)


@router.post("/facts/archival", response_model=ArchivalFactInsertResponse)
async def insert_archival_fact(
    request: Request,
    payload: ArchivalFactInsertRequest,
    user_id: str | None = None,
):
    """Insert a fact node for archival memory."""
    app_state = request.app.state
    group_id = user_id or "default"

    if not app_state.dere_graph:
        raise HTTPException(status_code=503, detail="dere_graph not available")

    fact_text = payload.fact.strip() if payload.fact else ""
    if not fact_text:
        raise HTTPException(status_code=400, detail="Fact text cannot be empty")

    source = payload.source.strip() if payload.source else None
    tags = None
    if payload.tags:
        tags = [tag.strip() for tag in payload.tags if tag and tag.strip()]

    try:
        fact_node, created = await app_state.dere_graph.add_fact(
            fact=fact_text,
            group_id=group_id,
            source=source,
            tags=tags,
            valid_at=payload.valid_at,
            invalid_at=payload.invalid_at,
            archival=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    summary = _fact_to_summary(fact_node, [])
    return ArchivalFactInsertResponse(created=created, fact=summary)


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
    include_facts: bool = True,
    include_fact_roles: bool = True,
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
        now = datetime.now(UTC)

        def _parse_dt(value):
            if isinstance(value, datetime):
                return _normalize_dt(value)
            if not value:
                return None
            try:
                return _normalize_dt(datetime.fromisoformat(value))
            except Exception:
                return None

        # Build filters
        edge_filters = []
        fact_filters = []
        params = {"group_id": group_id}

        if start_date:
            start_date = _normalize_dt(start_date)
            edge_filters.append("r.created_at >= $start_date")
            fact_filters.append("f.created_at >= $start_date")
            params["start_date"] = start_date.isoformat()
        if end_date:
            end_date = _normalize_dt(end_date)
            edge_filters.append("r.created_at <= $end_date")
            fact_filters.append("f.created_at <= $end_date")
            params["end_date"] = end_date.isoformat()
        if entity_uuid:
            edge_filters.append("(src.uuid = $entity_uuid OR tgt.uuid = $entity_uuid)")
            params["entity_uuid"] = entity_uuid

        edge_where = " AND ".join(edge_filters) if edge_filters else "true"
        fact_where = " AND ".join(fact_filters) if fact_filters else "true"

        # Count totals
        edge_count_query = f"""
            MATCH (src:Entity)-[r:RELATES_TO {{group_id: $group_id}}]->(tgt:Entity)
            WHERE {edge_where}
            RETURN count(r) as total
        """
        edge_count_result = await driver.execute_query(edge_count_query, **params)
        edge_total = edge_count_result[0]["total"] if edge_count_result else 0

        fact_total = 0
        if include_facts:
            fact_count_query = f"""
                MATCH (f:Fact {{group_id: $group_id}})
                WHERE {fact_where}
                RETURN count(f) as total
            """
            if entity_uuid:
                fact_count_query = f"""
                    MATCH (f:Fact {{group_id: $group_id}})-[:HAS_ROLE]->(e:Entity {{uuid: $entity_uuid}})
                    WHERE {fact_where}
                    RETURN count(DISTINCT f) as total
                """
            fact_count_result = await driver.execute_query(fact_count_query, **params)
            fact_total = fact_count_result[0]["total"] if fact_count_result else 0

        total = edge_total + fact_total
        limit_total = offset + limit
        params["limit_total"] = limit_total

        # Fetch edges with source/target names
        edge_query = f"""
            MATCH (src:Entity)-[r:RELATES_TO {{group_id: $group_id}}]->(tgt:Entity)
            WHERE {edge_where}
            RETURN r, src.uuid as source_uuid, src.name as source_name,
                   tgt.uuid as target_uuid, tgt.name as target_name
            ORDER BY r.created_at DESC
            LIMIT $limit_total
        """
        edge_rows = await driver.execute_query(edge_query, **params)

        timeline_entries = []
        for row in edge_rows:
            edge_data = _edge_props(row.get("r"))
            if not edge_data:
                continue

            # Determine temporal status
            valid_at = _parse_dt(edge_data.get("valid_at"))
            invalid_at = _parse_dt(edge_data.get("invalid_at"))
            expired_at = _parse_dt(edge_data.get("expired_at"))

            if expired_at:
                temporal_status = "expired"
            elif invalid_at and invalid_at < now:
                temporal_status = "expired"
            elif valid_at and valid_at > now:
                temporal_status = "future"
            else:
                temporal_status = "valid"

            edge_summary = EdgeSummary(
                uuid=edge_data.get("uuid", ""),
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
            entry_time = valid_at or _parse_dt(edge_data.get("created_at")) or now
            timeline_entries.append(
                {
                    "timestamp": entry_time,
                    "entry": TimelineFact(
                        kind="edge",
                        edge=edge_summary,
                        temporal_status=temporal_status,
                    ),
                }
            )

        if include_facts and limit_total > 0:
            if entity_uuid:
                fact_query = f"""
                    MATCH (f:Fact {{group_id: $group_id}})-[:HAS_ROLE]->(e:Entity {{uuid: $entity_uuid}})
                    WHERE {fact_where}
                    RETURN DISTINCT f AS fact
                    ORDER BY f.created_at DESC
                    LIMIT $limit_total
                """
            else:
                fact_query = f"""
                    MATCH (f:Fact {{group_id: $group_id}})
                    WHERE {fact_where}
                    RETURN f AS fact
                    ORDER BY f.created_at DESC
                    LIMIT $limit_total
                """
            fact_rows = await driver.execute_query(fact_query, **params)
            fact_nodes = [driver._dict_to_fact_node(row["fact"]) for row in fact_rows]

            roles_lookup = {}
            if include_fact_roles and fact_nodes:
                roles_lookup = await app_state.dere_graph.get_fact_roles(
                    fact_nodes,
                    group_id=group_id,
                )

            for fact in fact_nodes:
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

                valid_at = _parse_dt(fact.valid_at)
                invalid_at = _parse_dt(fact.invalid_at)
                expired_at = _parse_dt(fact.expired_at)
                if expired_at:
                    temporal_status = "expired"
                elif invalid_at and invalid_at < now:
                    temporal_status = "expired"
                elif valid_at and valid_at > now:
                    temporal_status = "future"
                else:
                    temporal_status = "valid"

                entry_time = valid_at or _parse_dt(fact.created_at) or now
                timeline_entries.append(
                    {
                        "timestamp": entry_time,
                        "entry": TimelineFact(
                            kind="fact",
                            fact=_fact_to_summary(fact, roles),
                            temporal_status=temporal_status,
                        ),
                    }
                )

        timeline_entries.sort(key=lambda item: item["timestamp"], reverse=True)
        page = timeline_entries[offset : offset + limit]
        timeline = [item["entry"] for item in page]

        return FactsTimelineResponse(facts=timeline, total=total, offset=offset)
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
