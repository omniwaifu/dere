"""FastMCP server for knowledge graph access.

Exposes tools for searching and querying the knowledge graph,
allowing the agent to recall stored information during conversations.
"""

from __future__ import annotations

from typing import Any

from fastmcp import FastMCP

from dere_shared.daemon_client import daemon_client

mcp = FastMCP("Knowledge Graph")


def _format_entity(entity: dict[str, Any]) -> str:
    """Format an entity for text output."""
    labels = ", ".join(entity.get("labels", []))
    summary = entity.get("summary", "")
    mentions = entity.get("mention_count", 0)

    parts = [f"**{entity['name']}**"]
    if labels:
        parts.append(f"[{labels}]")
    if summary:
        parts.append(f": {summary}")
    if mentions > 1:
        parts.append(f" (mentioned {mentions}x)")

    return "".join(parts)


def _format_fact(fact: dict[str, Any]) -> str:
    """Format a fact for text output."""
    fact_text = fact.get("fact", "")
    roles = fact.get("roles", [])

    if roles:
        role_parts = [f"{r['entity_name']} ({r['role']})" for r in roles]
        return f"{fact_text} [involves: {', '.join(role_parts)}]"
    return fact_text


def _format_edge(edge: dict[str, Any]) -> str:
    """Format an edge/relationship for text output."""
    source = edge.get("source_name", "?")
    target = edge.get("target_name", "?")
    relation = edge.get("relation", "relates to")
    fact = edge.get("fact", "")

    if fact:
        return f"{source} --[{relation}]--> {target}: {fact}"
    return f"{source} --[{relation}]--> {target}"


@mcp.tool()
async def search_knowledge(
    query: str,
    limit: int = 10,
    include_facts: bool = True,
    include_relationships: bool = True,
    labels: list[str] | None = None,
) -> str:
    """
    Search the knowledge graph for entities, facts, and relationships.

    Use this to recall information from memory, find connections between
    concepts, or explore what is known about a topic.

    Args:
        query: Search query (e.g., "project X", "Justin's preferences", "AT Protocol")
        limit: Maximum number of results per category (default 10)
        include_facts: Include fact nodes in results (default True)
        include_relationships: Include relationship edges in results (default True)
        labels: Filter entities by labels (e.g., ["Person", "Project"])

    Returns:
        Formatted search results with entities, facts, and relationships
    """
    params: dict[str, Any] = {
        "query": query,
        "limit": limit,
        "include_edges": include_relationships,
        "include_facts": include_facts,
        "include_fact_roles": True,
    }
    if labels:
        params["labels"] = labels

    async with daemon_client() as client:
        resp = await client.get("/kg/search", params=params)
        resp.raise_for_status()
        data = resp.json()

    entities = data.get("entities", [])
    facts = data.get("facts", [])
    edges = data.get("edges", [])

    if not entities and not facts and not edges:
        return f"No results found for '{query}'"

    parts = [f"## Knowledge Graph Results for '{query}'\n"]

    if entities:
        parts.append(f"### Entities ({len(entities)})")
        for e in entities:
            parts.append(f"- {_format_entity(e)}")
        parts.append("")

    if facts:
        parts.append(f"### Facts ({len(facts)})")
        for f in facts:
            parts.append(f"- {_format_fact(f)}")
        parts.append("")

    if edges:
        parts.append(f"### Relationships ({len(edges)})")
        for e in edges:
            parts.append(f"- {_format_edge(e)}")

    return "\n".join(parts)


@mcp.tool()
async def search_facts(
    query: str,
    limit: int = 20,
) -> str:
    """
    Search for specific facts in the knowledge graph.

    Facts are structured statements about relationships and events.
    Use this when you want to find specific claims or statements.

    Args:
        query: Search query for facts
        limit: Maximum number of facts to return (default 20)

    Returns:
        List of matching facts with their involved entities
    """
    async with daemon_client() as client:
        resp = await client.get(
            "/kg/facts/search",
            params={"query": query, "limit": limit, "include_roles": True},
        )
        resp.raise_for_status()
        data = resp.json()

    facts = data.get("facts", [])
    if not facts:
        return f"No facts found matching '{query}'"

    parts = [f"## Facts matching '{query}'\n"]
    for f in facts:
        parts.append(f"- {_format_fact(f)}")

    return "\n".join(parts)


@mcp.tool()
async def get_entity(
    name: str,
    include_related: bool = True,
) -> str:
    """
    Get detailed information about a specific entity.

    Use this to look up what is known about a person, project, concept,
    or any other entity in the knowledge graph.

    Args:
        name: Name of the entity to look up
        include_related: Include related entities (default True)

    Returns:
        Entity details and relationships
    """
    async with daemon_client() as client:
        resp = await client.get(f"/kg/entity/{name}")
        if resp.status_code == 404:
            return f"Entity '{name}' not found in knowledge graph"
        resp.raise_for_status()
        data = resp.json()

    if not data.get("found"):
        return f"Entity '{name}' not found in knowledge graph"

    primary = data.get("primary_node", {})
    related = data.get("related_nodes", [])
    relationships = data.get("relationships", [])

    parts = [f"## {primary.get('name', name)}"]

    labels = primary.get("labels", [])
    if labels:
        parts.append(f"**Type:** {', '.join(labels)}")

    if primary.get("created_at"):
        parts.append(f"**First seen:** {primary['created_at']}")

    parts.append("")

    if relationships:
        parts.append(f"### Relationships ({len(relationships)})")
        for r in relationships:
            parts.append(f"- {r.get('fact', 'Unknown relationship')}")
        parts.append("")

    if include_related and related:
        parts.append(f"### Related Entities ({len(related)})")
        for r in related:
            r_labels = ", ".join(r.get("labels", []))
            if r_labels:
                parts.append(f"- **{r['name']}** [{r_labels}]")
            else:
                parts.append(f"- **{r['name']}**")

    return "\n".join(parts)


@mcp.tool()
async def recall_context(
    around_date: str | None = None,
    limit: int = 20,
) -> str:
    """
    Recall facts and events from a specific time period.

    Use this to remember what was happening around a certain date,
    or to get a timeline of recent events if no date is specified.

    Args:
        around_date: ISO date string (e.g., "2025-12-15") or None for recent
        limit: Maximum number of timeline entries (default 20)

    Returns:
        Timeline of facts and events
    """
    params: dict[str, Any] = {"limit": limit}
    if around_date:
        params["start_date"] = around_date
        params["end_date"] = around_date

    async with daemon_client() as client:
        resp = await client.get("/kg/facts/timeline", params=params)
        resp.raise_for_status()
        data = resp.json()

    facts = data.get("facts", [])
    if not facts:
        if around_date:
            return f"No events found around {around_date}"
        return "No recent events in the knowledge graph"

    if around_date:
        parts = [f"## Events around {around_date}\n"]
    else:
        parts = ["## Recent Timeline\n"]

    for item in facts:
        kind = item.get("kind")
        status = item.get("temporal_status", "valid")
        status_indicator = "" if status == "valid" else f" [{status}]"

        if kind == "fact":
            fact_data = item.get("fact", {})
            parts.append(f"- {_format_fact(fact_data)}{status_indicator}")
        elif kind == "edge":
            edge_data = item.get("edge", {})
            parts.append(f"- {_format_edge(edge_data)}{status_indicator}")

    total = data.get("total", len(facts))
    if total > limit:
        parts.append(f"\n*Showing {limit} of {total} total entries*")

    return "\n".join(parts)


@mcp.tool()
async def get_knowledge_stats() -> str:
    """
    Get statistics about the knowledge graph.

    Returns counts of entities, facts, relationships, and top-mentioned items.
    Useful for understanding what's in memory.

    Returns:
        Knowledge graph statistics
    """
    async with daemon_client() as client:
        resp = await client.get("/kg/stats")
        resp.raise_for_status()
        data = resp.json()

    parts = ["## Knowledge Graph Statistics\n"]

    parts.append(f"- **Entities:** {data.get('total_entities', 0)}")
    parts.append(f"- **Facts:** {data.get('total_facts', 0)}")
    parts.append(f"- **Relationships:** {data.get('total_edges', 0)}")
    parts.append(f"- **Communities:** {data.get('total_communities', 0)}")
    parts.append("")

    top_mentioned = data.get("top_mentioned", [])
    if top_mentioned:
        parts.append("### Most Mentioned")
        for e in top_mentioned[:5]:
            parts.append(f"- {e['name']} ({e['mention_count']}x)")
        parts.append("")

    label_dist = data.get("label_distribution", {})
    if label_dist:
        parts.append("### Entity Types")
        for label, count in sorted(label_dist.items(), key=lambda x: -x[1])[:10]:
            parts.append(f"- {label}: {count}")

    return "\n".join(parts)


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
