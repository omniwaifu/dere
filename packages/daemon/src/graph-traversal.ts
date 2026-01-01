import { queryGraph } from "./graph-helpers.js";
import type { EntityEdge, EntityNode } from "./graph-types.js";

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

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

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseEntityRecord(record: Record<string, unknown>): EntityNode {
  const labels = toStringArray(record.labels).filter((label) => label !== "Entity");
  const attributes: Record<string, unknown> =
    record.attributes && typeof record.attributes === "object"
      ? { ...(record.attributes as Record<string, unknown>) }
      : {};

  const reserved = [
    "uuid",
    "name",
    "group_id",
    "name_embedding",
    "summary",
    "created_at",
    "expired_at",
    "aliases",
    "last_mentioned",
    "mention_count",
    "retrieval_count",
    "citation_count",
    "retrieval_quality",
  ];
  for (const key of reserved) {
    delete attributes[key];
  }

  return {
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    group_id: String(record.group_id ?? "default"),
    labels,
    created_at: parseDate(record.created_at) ?? new Date(),
    expired_at: parseDate(record.expired_at),
    name_embedding: Array.isArray(record.name_embedding)
      ? (record.name_embedding as number[])
      : null,
    summary: typeof record.summary === "string" ? record.summary : "",
    attributes,
    aliases: toStringArray(record.aliases),
    last_mentioned: parseDate(record.last_mentioned),
    mention_count: parseNumber(record.mention_count, 1),
    retrieval_count: parseNumber(record.retrieval_count, 0),
    citation_count: parseNumber(record.citation_count, 0),
    retrieval_quality: parseNumber(record.retrieval_quality, 1),
  };
}

function parseEdgeRecord(record: Record<string, unknown>): EntityEdge {
  const attributes: Record<string, unknown> =
    record.attributes && typeof record.attributes === "object"
      ? { ...(record.attributes as Record<string, unknown>) }
      : {};

  const reserved = [
    "uuid",
    "name",
    "fact",
    "fact_embedding",
    "episodes",
    "created_at",
    "expired_at",
    "valid_at",
    "invalid_at",
    "strength",
    "group_id",
  ];
  for (const key of reserved) {
    delete attributes[key];
  }

  return {
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    group_id: String(record.group_id ?? "default"),
    source_node_uuid: String(record.source_uuid ?? ""),
    target_node_uuid: String(record.target_uuid ?? ""),
    fact: String(record.fact ?? ""),
    fact_embedding: Array.isArray(record.fact_embedding)
      ? (record.fact_embedding as number[])
      : null,
    episodes: toStringArray(record.episodes),
    created_at: parseDate(record.created_at) ?? new Date(),
    expired_at: parseDate(record.expired_at),
    valid_at: parseDate(record.valid_at),
    invalid_at: parseDate(record.invalid_at),
    strength:
      record.strength === null || record.strength === undefined
        ? null
        : parseNumber(record.strength, 0),
    attributes,
  };
}

export async function nodeBfsSearch(
  originUuids: string[],
  groupId: string,
  maxDepth = 3,
  limit = 100,
): Promise<EntityNode[]> {
  if (originUuids.length === 0) {
    return [];
  }

  const records = await queryGraph(
    `
      MATCH path = (origin:Entity)-[:RELATES_TO*1..${maxDepth}]-(n:Entity)
      WHERE origin.uuid IN $origin_uuids
        AND origin.group_id = $group_id
        AND n.group_id = $group_id
      WITH DISTINCT n, length(path) as distance
      ORDER BY distance
      LIMIT $limit
      RETURN n.uuid AS uuid,
             n.name AS name,
             n.group_id AS group_id,
             n.name_embedding AS name_embedding,
             n.summary AS summary,
             n.created_at AS created_at,
             n.expired_at AS expired_at,
             n.aliases AS aliases,
             n.last_mentioned AS last_mentioned,
             n.mention_count AS mention_count,
             n.retrieval_count AS retrieval_count,
             n.citation_count AS citation_count,
             n.retrieval_quality AS retrieval_quality,
             labels(n) AS labels,
             properties(n) AS attributes
    `,
    { origin_uuids: originUuids, group_id: groupId, limit },
  );

  return records.map((record) => parseEntityRecord(record));
}

export async function edgeBfsSearch(
  originUuids: string[],
  groupId: string,
  maxDepth = 3,
  limit = 100,
): Promise<EntityEdge[]> {
  if (originUuids.length === 0) {
    return [];
  }

  const records = await queryGraph(
    `
      MATCH path = (origin:Entity)-[:RELATES_TO*1..${maxDepth}]-(n:Entity)
      WHERE origin.uuid IN $origin_uuids
        AND origin.group_id = $group_id
        AND n.group_id = $group_id
      UNWIND relationships(path) AS r
      WITH DISTINCT r, startNode(r) AS source, endNode(r) AS target
      WHERE r.group_id = $group_id
        AND r.invalid_at IS NULL
      RETURN r.uuid AS uuid,
             r.name AS name,
             r.fact AS fact,
             r.fact_embedding AS fact_embedding,
             r.episodes AS episodes,
             r.created_at AS created_at,
             r.expired_at AS expired_at,
             r.valid_at AS valid_at,
             r.invalid_at AS invalid_at,
             r.strength AS strength,
             r.group_id AS group_id,
             source.uuid AS source_uuid,
             target.uuid AS target_uuid,
             properties(r) AS attributes
      LIMIT $limit
    `,
    { origin_uuids: originUuids, group_id: groupId, limit },
  );

  return records.map((record) => parseEdgeRecord(record));
}

export async function calculateNodeDistances(
  centerUuid: string,
  nodeUuids: string[],
  groupId: string,
  maxDepth = 3,
): Promise<Record<string, number>> {
  if (nodeUuids.length === 0) {
    return {};
  }

  const records = await queryGraph(
    `
      MATCH (center:Entity {uuid: $center_uuid})
      WHERE center.group_id = $group_id
      UNWIND $node_uuids AS target_uuid
      MATCH path = shortestPath((center)-[:RELATES_TO*1..${maxDepth}]-(target:Entity {uuid: target_uuid}))
      WHERE target.group_id = $group_id
      RETURN target.uuid AS uuid, length(path) AS distance
    `,
    { center_uuid: centerUuid, node_uuids: nodeUuids, group_id: groupId },
  );

  const distances: Record<string, number> = {};
  for (const record of records) {
    const uuid = String(record.uuid ?? "");
    if (!uuid) {
      continue;
    }
    distances[uuid] = parseNumber(record.distance, 0);
  }

  return distances;
}

export function nodeDistanceRerank(
  nodes: EntityNode[],
  centerUuid: string,
  distances: Record<string, number>,
  distanceWeight = 0.5,
): EntityNode[] {
  if (!distanceWeight || Object.keys(distances).length === 0) {
    return nodes;
  }

  const maxDistance = Math.max(...Object.values(distances));

  const scored = nodes.map((node) => {
    if (node.uuid === centerUuid) {
      return { node, score: 1.0 };
    }
    const distance = distances[node.uuid];
    if (distance === undefined) {
      return { node, score: 0.0 };
    }
    const normalized = maxDistance > 0 ? distance / maxDistance : 0;
    const proximityScore = 1.0 - normalized;
    return { node, score: distanceWeight * proximityScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.node);
}
