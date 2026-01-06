/**
 * Planning Layer Queries
 *
 * Graph-native queries that justify FalkorDB over pgvector:
 * - Gap detection: entities mentioned but unexplored
 * - Citation traversal: confidence chains for facts
 * - Community-aware routing: leverage community structure
 */

import { queryGraph } from "./graph-helpers.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface UnexploredEntity {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];
  /** How many times this entity is referenced by others */
  inbound_count: number;
  /** When this entity was last mentioned */
  last_mentioned: Date | null;
}

export interface CitationChainNode {
  uuid: string;
  fact: string;
  depth: number;
  source_entity: string;
  target_entity: string;
  episodes: string[];
  created_at: Date;
}

// -----------------------------------------------------------------------------
// Gap Detection
// -----------------------------------------------------------------------------

/**
 * Find entities that are mentioned (appear as targets in relationships)
 * but unexplored (have no outgoing relationships).
 *
 * These are knowledge gaps - we know things relate TO them, but we don't
 * know what THEY relate to.
 */
export async function findUnexploredEntities(
  groupId: string,
  options: {
    /** Minimum inbound references to consider (default: 1) */
    minInbound?: number;
    /** Maximum results (default: 50) */
    limit?: number;
    /** Exclude entities with non-empty summaries (default: false) */
    excludeWithSummary?: boolean;
  } = {},
): Promise<UnexploredEntity[]> {
  const minInbound = options.minInbound ?? 1;
  const limit = options.limit ?? 50;
  const excludeWithSummary = options.excludeWithSummary ?? false;

  const summaryFilter = excludeWithSummary
    ? "AND (n.summary IS NULL OR n.summary = '')"
    : "";

  const records = await queryGraph(
    `
      MATCH (n:Entity)
      WHERE n.group_id = $group_id
        AND n.expired_at IS NULL
        ${summaryFilter}
      OPTIONAL MATCH (other)-[inbound:RELATES_TO]->(n)
      WHERE inbound.invalid_at IS NULL
        AND inbound.group_id = $group_id
      OPTIONAL MATCH (n)-[outbound:RELATES_TO]->(any)
      WHERE outbound.invalid_at IS NULL
        AND outbound.group_id = $group_id
      WITH n,
           count(DISTINCT inbound) AS inbound_count,
           count(DISTINCT outbound) AS outbound_count
      WHERE inbound_count >= $min_inbound
        AND outbound_count = 0
      RETURN n.uuid AS uuid,
             n.name AS name,
             n.summary AS summary,
             labels(n) AS labels,
             inbound_count,
             n.last_mentioned AS last_mentioned
      ORDER BY inbound_count DESC
      LIMIT $limit
    `,
    { group_id: groupId, min_inbound: minInbound, limit },
  );

  return records.map((record) => ({
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    summary: String(record.summary ?? ""),
    labels: Array.isArray(record.labels)
      ? (record.labels as string[]).filter((l) => l !== "Entity")
      : [],
    inbound_count: Number(record.inbound_count ?? 0),
    last_mentioned: parseDate(record.last_mentioned),
  }));
}

/**
 * Find entities that have been mentioned many times but have low
 * exploration depth (few outgoing relationships relative to inbound).
 *
 * Ratio-based gap detection for more nuanced prioritization.
 */
export async function findUnderexploredEntities(
  groupId: string,
  options: {
    /** Minimum total edges to consider (default: 3) */
    minEdges?: number;
    /** Maximum outbound/inbound ratio to be considered underexplored (default: 0.3) */
    maxRatio?: number;
    /** Maximum results (default: 50) */
    limit?: number;
  } = {},
): Promise<
  Array<
    UnexploredEntity & {
      outbound_count: number;
      exploration_ratio: number;
    }
  >
> {
  const minEdges = options.minEdges ?? 3;
  const maxRatio = options.maxRatio ?? 0.3;
  const limit = options.limit ?? 50;

  const records = await queryGraph(
    `
      MATCH (n:Entity)
      WHERE n.group_id = $group_id
        AND n.expired_at IS NULL
      OPTIONAL MATCH (other)-[inbound:RELATES_TO]->(n)
      WHERE inbound.invalid_at IS NULL
        AND inbound.group_id = $group_id
      OPTIONAL MATCH (n)-[outbound:RELATES_TO]->(any)
      WHERE outbound.invalid_at IS NULL
        AND outbound.group_id = $group_id
      WITH n,
           count(DISTINCT inbound) AS inbound_count,
           count(DISTINCT outbound) AS outbound_count
      WHERE inbound_count + outbound_count >= $min_edges
        AND inbound_count > 0
      WITH n, inbound_count, outbound_count,
           toFloat(outbound_count) / inbound_count AS ratio
      WHERE ratio <= $max_ratio
      RETURN n.uuid AS uuid,
             n.name AS name,
             n.summary AS summary,
             labels(n) AS labels,
             inbound_count,
             outbound_count,
             ratio AS exploration_ratio,
             n.last_mentioned AS last_mentioned
      ORDER BY inbound_count DESC, ratio ASC
      LIMIT $limit
    `,
    { group_id: groupId, min_edges: minEdges, max_ratio: maxRatio, limit },
  );

  return records.map((record) => ({
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    summary: String(record.summary ?? ""),
    labels: Array.isArray(record.labels)
      ? (record.labels as string[]).filter((l) => l !== "Entity")
      : [],
    inbound_count: Number(record.inbound_count ?? 0),
    outbound_count: Number(record.outbound_count ?? 0),
    exploration_ratio: Number(record.exploration_ratio ?? 0),
    last_mentioned: parseDate(record.last_mentioned),
  }));
}

// -----------------------------------------------------------------------------
// Citation Traversal
// -----------------------------------------------------------------------------

/**
 * Get the citation/provenance chain for a fact.
 *
 * Traces: fact → episode → related facts from same episode → their episodes
 * This builds a confidence chain showing how knowledge is interconnected.
 */
export async function getCitationChain(
  factUuid: string,
  groupId: string,
  options: {
    /** Maximum depth to traverse (default: 3) */
    maxDepth?: number;
    /** Maximum results (default: 50) */
    limit?: number;
  } = {},
): Promise<CitationChainNode[]> {
  const maxDepth = options.maxDepth ?? 3;
  const limit = options.limit ?? 50;

  // Traverse from fact through episodes to related facts
  const records = await queryGraph(
    `
      MATCH (origin)-[r:RELATES_TO]-()
      WHERE r.uuid = $fact_uuid
        AND r.group_id = $group_id
        AND r.invalid_at IS NULL
      WITH r AS origin_edge
      MATCH path = (source:Entity)-[chain:RELATES_TO*1..${maxDepth}]-(target:Entity)
      WHERE any(edge IN chain WHERE
        edge.group_id = $group_id
        AND edge.invalid_at IS NULL
        AND size([ep IN edge.episodes WHERE ep IN origin_edge.episodes]) > 0
      )
      UNWIND range(0, size(chain)-1) AS idx
      WITH chain[idx] AS edge,
           CASE WHEN idx = 0 THEN startNode(chain[0]) ELSE endNode(chain[idx-1]) END AS src,
           endNode(chain[idx]) AS tgt,
           idx + 1 AS depth
      RETURN DISTINCT edge.uuid AS uuid,
             edge.fact AS fact,
             depth,
             src.name AS source_entity,
             tgt.name AS target_entity,
             edge.episodes AS episodes,
             edge.created_at AS created_at
      ORDER BY depth ASC
      LIMIT $limit
    `,
    { fact_uuid: factUuid, group_id: groupId, limit },
  );

  return records.map((record) => ({
    uuid: String(record.uuid ?? ""),
    fact: String(record.fact ?? ""),
    depth: Number(record.depth ?? 0),
    source_entity: String(record.source_entity ?? ""),
    target_entity: String(record.target_entity ?? ""),
    episodes: Array.isArray(record.episodes) ? (record.episodes as string[]) : [],
    created_at: parseDate(record.created_at) ?? new Date(),
  }));
}

/**
 * Find facts that share episodes with a given fact.
 *
 * Simpler co-occurrence query - facts learned at the same time are related.
 */
export async function findCoOccurringFacts(
  factUuid: string,
  groupId: string,
  options: {
    /** Maximum results (default: 20) */
    limit?: number;
  } = {},
): Promise<
  Array<{
    uuid: string;
    fact: string;
    source_entity: string;
    target_entity: string;
    shared_episodes: number;
  }>
> {
  const limit = options.limit ?? 20;

  const records = await queryGraph(
    `
      MATCH ()-[origin:RELATES_TO]-()
      WHERE origin.uuid = $fact_uuid
        AND origin.group_id = $group_id
      WITH origin.episodes AS origin_episodes
      MATCH (src:Entity)-[r:RELATES_TO]->(tgt:Entity)
      WHERE r.group_id = $group_id
        AND r.uuid <> $fact_uuid
        AND r.invalid_at IS NULL
        AND size([ep IN r.episodes WHERE ep IN origin_episodes]) > 0
      WITH r, src, tgt,
           size([ep IN r.episodes WHERE ep IN origin_episodes]) AS shared
      RETURN r.uuid AS uuid,
             r.fact AS fact,
             src.name AS source_entity,
             tgt.name AS target_entity,
             shared AS shared_episodes
      ORDER BY shared DESC
      LIMIT $limit
    `,
    { fact_uuid: factUuid, group_id: groupId, limit },
  );

  return records.map((record) => ({
    uuid: String(record.uuid ?? ""),
    fact: String(record.fact ?? ""),
    source_entity: String(record.source_entity ?? ""),
    target_entity: String(record.target_entity ?? ""),
    shared_episodes: Number(record.shared_episodes ?? 0),
  }));
}

// -----------------------------------------------------------------------------
// Community-Aware Queries
// -----------------------------------------------------------------------------

/**
 * Find unexplored entities within a specific community.
 *
 * Useful for focused exploration - "what don't we know about this topic cluster?"
 */
export async function findUnexploredInCommunity(
  communityUuid: string,
  groupId: string,
  options: {
    /** Maximum results (default: 20) */
    limit?: number;
  } = {},
): Promise<UnexploredEntity[]> {
  const limit = options.limit ?? 20;

  const records = await queryGraph(
    `
      MATCH (c:Community {uuid: $community_uuid})-[:HAS_MEMBER]->(n:Entity)
      WHERE c.group_id = $group_id
        AND n.expired_at IS NULL
      OPTIONAL MATCH (other)-[inbound:RELATES_TO]->(n)
      WHERE inbound.invalid_at IS NULL
        AND inbound.group_id = $group_id
      OPTIONAL MATCH (n)-[outbound:RELATES_TO]->(any)
      WHERE outbound.invalid_at IS NULL
        AND outbound.group_id = $group_id
      WITH n,
           count(DISTINCT inbound) AS inbound_count,
           count(DISTINCT outbound) AS outbound_count
      WHERE outbound_count = 0
      RETURN n.uuid AS uuid,
             n.name AS name,
             n.summary AS summary,
             labels(n) AS labels,
             inbound_count,
             n.last_mentioned AS last_mentioned
      ORDER BY inbound_count DESC
      LIMIT $limit
    `,
    { community_uuid: communityUuid, group_id: groupId, limit },
  );

  return records.map((record) => ({
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    summary: String(record.summary ?? ""),
    labels: Array.isArray(record.labels)
      ? (record.labels as string[]).filter((l) => l !== "Entity")
      : [],
    inbound_count: Number(record.inbound_count ?? 0),
    last_mentioned: parseDate(record.last_mentioned),
  }));
}

/**
 * Get communities ordered by exploration gaps.
 *
 * Communities with the most unexplored members should be prioritized.
 */
export async function getCommunityExplorationStats(
  groupId: string,
  options: {
    /** Maximum results (default: 20) */
    limit?: number;
  } = {},
): Promise<
  Array<{
    uuid: string;
    name: string;
    summary: string;
    member_count: number;
    unexplored_count: number;
    exploration_ratio: number;
  }>
> {
  const limit = options.limit ?? 20;

  const records = await queryGraph(
    `
      MATCH (c:Community)-[:HAS_MEMBER]->(n:Entity)
      WHERE c.group_id = $group_id
        AND n.expired_at IS NULL
      OPTIONAL MATCH (n)-[outbound:RELATES_TO]->(any)
      WHERE outbound.invalid_at IS NULL
        AND outbound.group_id = $group_id
      WITH c, n, count(outbound) AS out_count
      WITH c,
           count(n) AS member_count,
           sum(CASE WHEN out_count = 0 THEN 1 ELSE 0 END) AS unexplored_count
      WHERE member_count > 0
      WITH c, member_count, unexplored_count,
           toFloat(member_count - unexplored_count) / member_count AS exploration_ratio
      RETURN c.uuid AS uuid,
             c.name AS name,
             c.summary AS summary,
             member_count,
             unexplored_count,
             exploration_ratio
      ORDER BY unexplored_count DESC, exploration_ratio ASC
      LIMIT $limit
    `,
    { group_id: groupId, limit },
  );

  return records.map((record) => ({
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    summary: String(record.summary ?? ""),
    member_count: Number(record.member_count ?? 0),
    unexplored_count: Number(record.unexplored_count ?? 0),
    exploration_ratio: Number(record.exploration_ratio ?? 0),
  }));
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  return null;
}
