import { queryGraph, toDate } from "./graph-helpers.js";
import { OpenAIEmbedder } from "./graph-embedder.js";
import { buildTemporalQueryClause, type SearchFilters } from "./graph-filters.js";
import { DEFAULT_DOMAIN_ROUTES, mergeFilters, selectDomainFilters } from "./graph-routing.js";
import {
  calculateNodeDistances,
  edgeBfsSearch,
  nodeBfsSearch,
  nodeDistanceRerank,
} from "./graph-traversal.js";
import type { EntityEdge, EntityNode, FactNode } from "./graph-types.js";

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
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
  const reserved = new Set([
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
  ]);
  const attributes: Record<string, unknown> =
    record.attributes && typeof record.attributes === "object"
      ? { ...(record.attributes as Record<string, unknown>) }
      : {};
  for (const key of reserved) {
    delete attributes[key];
  }

  return {
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    group_id: String(record.group_id ?? "default"),
    labels,
    created_at: toDate(record.created_at) ?? new Date(),
    expired_at: toDate(record.expired_at),
    name_embedding: Array.isArray(record.name_embedding)
      ? (record.name_embedding as number[])
      : null,
    summary: typeof record.summary === "string" ? record.summary : "",
    attributes,
    aliases: toStringArray(record.aliases),
    last_mentioned: toDate(record.last_mentioned),
    mention_count: parseNumber(record.mention_count, 1),
    retrieval_count: parseNumber(record.retrieval_count, 0),
    citation_count: parseNumber(record.citation_count, 0),
    retrieval_quality: parseNumber(record.retrieval_quality, 1),
  };
}

function parseEdgeRecord(record: Record<string, unknown>): EntityEdge {
  const reserved = new Set([
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
  ]);
  const attributes: Record<string, unknown> =
    record.attributes && typeof record.attributes === "object"
      ? { ...(record.attributes as Record<string, unknown>) }
      : {};
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
    created_at: toDate(record.created_at) ?? new Date(),
    expired_at: toDate(record.expired_at),
    valid_at: toDate(record.valid_at),
    invalid_at: toDate(record.invalid_at),
    strength:
      record.strength === null || record.strength === undefined
        ? null
        : parseNumber(record.strength, 0),
    attributes,
  };
}

function parseFactRecord(record: Record<string, unknown>): FactNode {
  const reserved = new Set([
    "uuid",
    "name",
    "fact",
    "group_id",
    "created_at",
    "expired_at",
    "fact_embedding",
    "episodes",
    "valid_at",
    "invalid_at",
    "supersedes",
    "superseded_by",
  ]);
  const attributes: Record<string, unknown> =
    record.attributes && typeof record.attributes === "object"
      ? { ...(record.attributes as Record<string, unknown>) }
      : {};
  for (const key of reserved) {
    delete attributes[key];
  }

  return {
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? record.fact ?? ""),
    group_id: String(record.group_id ?? "default"),
    labels: [],
    created_at: toDate(record.created_at) ?? new Date(),
    expired_at: toDate(record.expired_at),
    fact: String(record.fact ?? ""),
    fact_embedding: Array.isArray(record.fact_embedding)
      ? (record.fact_embedding as number[])
      : null,
    attributes,
    episodes: toStringArray(record.episodes),
    valid_at: toDate(record.valid_at),
    invalid_at: toDate(record.invalid_at),
    supersedes: toStringArray(record.supersedes),
    superseded_by: toStringArray(record.superseded_by),
  };
}

export function rrf(resultLists: string[][], rankConst = 60): string[] {
  const scores = new Map<string, number>();
  for (const result of resultLists) {
    result.forEach((uuid, idx) => {
      scores.set(uuid, (scores.get(uuid) ?? 0) + 1.0 / (idx + rankConst));
    });
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([uuid]) => uuid);
}

function mergeRankedItems<T extends { uuid: string }>(resultLists: T[][], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }
  const uuidLists = resultLists
    .filter((list) => list.length > 0)
    .map((list) => list.map((item) => item.uuid));
  if (uuidLists.length === 0) {
    return [];
  }
  const mergedUuids = rrf(uuidLists).slice(0, limit);
  const itemByUuid = new Map<string, T>();
  for (const list of resultLists) {
    for (const item of list) {
      if (!itemByUuid.has(item.uuid)) {
        itemByUuid.set(item.uuid, item);
      }
    }
  }
  return mergedUuids.map((uuid) => itemByUuid.get(uuid)).filter((item): item is T => Boolean(item));
}

export async function fulltextNodeSearch(
  query: string,
  groupId: string,
  limit: number,
  filters?: SearchFilters | null,
): Promise<EntityNode[]> {
  const q = query.trim().toLowerCase();
  const { clause, params } = buildTemporalQueryClause(filters, "node", null);

  const whereParts = ["node.group_id = $group_id"];
  if (q) {
    whereParts.push(
      "(toLower(node.name) CONTAINS $query OR toLower(node.summary) CONTAINS $query)",
    );
  }
  if (clause) {
    whereParts.push(clause.replace("WHERE ", ""));
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH (node:Entity)
      ${whereClause}
      RETURN node.uuid AS uuid,
             node.name AS name,
             node.group_id AS group_id,
             node.name_embedding AS name_embedding,
             node.summary AS summary,
             node.created_at AS created_at,
             node.expired_at AS expired_at,
             node.aliases AS aliases,
             node.last_mentioned AS last_mentioned,
             node.mention_count AS mention_count,
             node.retrieval_count AS retrieval_count,
             node.citation_count AS citation_count,
             node.retrieval_quality AS retrieval_quality,
             labels(node) AS labels,
             properties(node) AS attributes
      ORDER BY node.created_at DESC
      LIMIT $limit
    `,
    { group_id: groupId, query: q, limit, ...params },
  );

  return records.map((record) => parseEntityRecord(record));
}

export async function vectorNodeSearch(
  queryVector: number[],
  groupId: string,
  limit: number,
  filters?: SearchFilters | null,
  minScore = 0.5,
): Promise<EntityNode[]> {
  if (queryVector.length === 0) {
    return [];
  }
  const { clause, params } = buildTemporalQueryClause(filters, "node", null);
  const whereParts = ["node.group_id = $group_id", "node.name_embedding IS NOT NULL"];
  if (clause) {
    whereParts.push(clause.replace("WHERE ", ""));
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH (node:Entity)
      ${whereClause}
      WITH node, (2 - vec.cosineDistance(node.name_embedding, vecf32($search_vector))) / 2 AS score
      WHERE score >= $min_score
      RETURN node.uuid AS uuid,
             node.name AS name,
             node.group_id AS group_id,
             node.name_embedding AS name_embedding,
             node.summary AS summary,
             node.created_at AS created_at,
             node.expired_at AS expired_at,
             node.aliases AS aliases,
             node.last_mentioned AS last_mentioned,
             node.mention_count AS mention_count,
             node.retrieval_count AS retrieval_count,
             node.citation_count AS citation_count,
             node.retrieval_quality AS retrieval_quality,
             labels(node) AS labels,
             properties(node) AS attributes,
             score AS score
      ORDER BY score DESC
      LIMIT $limit
    `,
    { group_id: groupId, search_vector: queryVector, min_score: minScore, limit, ...params },
  );

  return records.map((record) => parseEntityRecord(record));
}

export async function hybridNodeSearch(options: {
  query: string;
  groupId: string;
  limit: number;
  filters?: SearchFilters | null;
  queryVector?: number[] | null;
}): Promise<EntityNode[]> {
  const trimmed = options.query.trim();
  if (!trimmed) {
    return fulltextNodeSearch("", options.groupId, options.limit, options.filters ?? null);
  }

  const fulltext = await fulltextNodeSearch(
    trimmed,
    options.groupId,
    options.limit * 2,
    options.filters ?? null,
  );
  const vector = options.queryVector
    ? await vectorNodeSearch(
        options.queryVector,
        options.groupId,
        options.limit * 2,
        options.filters ?? null,
      )
    : [];

  const mergedUuids = rrf([
    fulltext.map((node) => node.uuid),
    vector.map((node) => node.uuid),
  ]).slice(0, options.limit * 2);

  const nodeByUuid = new Map<string, EntityNode>();
  for (const node of [...fulltext, ...vector]) {
    nodeByUuid.set(node.uuid, node);
  }

  const merged = mergedUuids
    .map((uuid) => nodeByUuid.get(uuid))
    .filter((node): node is EntityNode => Boolean(node));

  return merged.slice(0, options.limit);
}

export async function searchSimilarNodes(
  nodes: EntityNode[],
  groupId: string,
  embed: (text: string) => Promise<number[]>,
): Promise<EntityNode[]> {
  const candidates: EntityNode[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const vector = await embed(node.name.replace(/\n/g, " "));
    const results = await hybridNodeSearch({
      query: node.name,
      groupId,
      limit: 5,
      queryVector: vector,
    });
    for (const result of results) {
      if (seen.has(result.uuid)) {
        continue;
      }
      seen.add(result.uuid);
      candidates.push(result);
    }
  }

  return candidates;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dot += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function mmrRerank<T>(
  items: T[],
  queryEmbedding: number[],
  lambdaParam: number,
  limit: number,
  getEmbedding: (item: T) => number[] | null,
): T[] {
  if (items.length === 0 || limit <= 0) {
    return [];
  }

  const embeddings = items.map((item) => getEmbedding(item));
  if (embeddings.some((embedding) => !embedding || embedding.length === 0)) {
    return items.slice(0, limit);
  }

  const queryVec = queryEmbedding;
  const relevanceScores = embeddings.map((embedding) =>
    cosineSimilarity(queryVec, embedding as number[]),
  );

  const selected: number[] = [];
  const remaining = new Set(items.map((_, idx) => idx));

  while (selected.length < Math.min(limit, items.length) && remaining.size > 0) {
    let bestIdx: number | null = null;
    let bestScore = -Infinity;

    for (const idx of remaining) {
      const relevance = relevanceScores[idx] ?? 0;
      let maxSimilarity = 0;
      if (selected.length > 0) {
        maxSimilarity = Math.max(
          ...selected.map((selIdx) =>
            cosineSimilarity(embeddings[idx] as number[], embeddings[selIdx] as number[]),
          ),
        );
      }
      const score = lambdaParam * relevance - (1 - lambdaParam) * maxSimilarity;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    if (bestIdx === null) {
      break;
    }
    selected.push(bestIdx);
    remaining.delete(bestIdx);
  }

  return selected.map((idx) => items[idx]).filter((item): item is T => Boolean(item));
}

function scoreByRecency<T extends { created_at: Date }>(
  items: T[],
  decayFactor = 0.1,
): Array<[T, number]> {
  if (items.length === 0) {
    return [];
  }
  const timestamps = items.map((item) => item.created_at.getTime());
  const maxTimestamp = Math.max(...timestamps);
  const minTimestamp = Math.min(...timestamps);
  const range = maxTimestamp - minTimestamp;
  if (range === 0) {
    return items.map((item) => [item, 1]);
  }

  return items.map((item) => {
    const normalized = (item.created_at.getTime() - minTimestamp) / range;
    const recencyScore = Math.exp(-decayFactor * (1 - normalized));
    return [item, recencyScore];
  });
}

function scoreByEpisodeMentions(items: EntityNode[], alpha = 0.5): Array<[EntityNode, number]> {
  if (items.length === 0) {
    return [];
  }
  const maxMentions = Math.max(...items.map((item) => item.mention_count ?? 0));
  if (!maxMentions) {
    return items.map((item) => [item, 1]);
  }
  const scored = items.map((item) => {
    const normalized = (item.mention_count ?? 0) / maxMentions;
    return [item, alpha * normalized + (1 - alpha)] as [EntityNode, number];
  });
  scored.sort((a, b) => b[1] - a[1]);
  return scored;
}

function scoreByRetrospectiveQuality(
  items: EntityNode[],
  alpha = 0.5,
  minRetrievals = 3,
): Array<[EntityNode, number]> {
  if (items.length === 0) {
    return [];
  }
  const scored = items.map((item) => {
    const retrievalCount = item.retrieval_count ?? 0;
    const quality = item.retrieval_quality ?? 1;
    if (retrievalCount >= minRetrievals) {
      return [item, alpha * quality + (1 - alpha)] as [EntityNode, number];
    }
    return [item, 1] as [EntityNode, number];
  });
  scored.sort((a, b) => b[1] - a[1]);
  return scored;
}

function collectBfsSeedUuids(nodes: EntityNode[], edges: EntityEdge[], limit: number): string[] {
  if (limit <= 0) {
    return [];
  }
  const seeds: string[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    if (seeds.length >= limit) {
      return seeds;
    }
    if (!seen.has(node.uuid)) {
      seeds.push(node.uuid);
      seen.add(node.uuid);
    }
  }

  for (const edge of edges) {
    if (seeds.length >= limit) {
      return seeds;
    }
    for (const uuid of [edge.source_node_uuid, edge.target_node_uuid]) {
      if (seeds.length >= limit) {
        return seeds;
      }
      if (!seen.has(uuid)) {
        seeds.push(uuid);
        seen.add(uuid);
      }
    }
  }

  return seeds;
}

function extendSeedUuids(seeds: string[], extras: string[], limit: number): string[] {
  const seen = new Set(seeds);
  for (const uuid of extras) {
    if (seeds.length >= limit) {
      break;
    }
    if (!seen.has(uuid)) {
      seeds.push(uuid);
      seen.add(uuid);
    }
  }
  return seeds;
}

function selectWithBfs<T extends { uuid: string }>(
  ranked: T[],
  bfs: T[],
  limit: number,
  bfsSlots: number,
): T[] {
  if (limit <= 0) {
    return [];
  }
  const slots = Math.max(0, Math.min(bfsSlots, limit));
  const primaryLimit = Math.max(0, limit - slots);
  const primary = ranked.slice(0, primaryLimit);
  const seen = new Set(primary.map((item) => item.uuid));
  const rankedIds = new Set(ranked.map((item) => item.uuid));
  const combined = [...primary];

  for (const item of bfs) {
    if (combined.length >= limit) {
      break;
    }
    if (seen.has(item.uuid) || rankedIds.has(item.uuid)) {
      continue;
    }
    combined.push(item);
    seen.add(item.uuid);
  }

  for (const item of ranked.slice(primaryLimit)) {
    if (combined.length >= limit) {
      break;
    }
    if (seen.has(item.uuid)) {
      continue;
    }
    combined.push(item);
    seen.add(item.uuid);
  }

  return combined;
}

async function getRecentEpisodeEntityUuids(
  groupId: string,
  limitEpisodes: number,
  limitEntities: number,
  conversationId?: string | null,
): Promise<string[]> {
  if (limitEpisodes <= 0 || limitEntities <= 0) {
    return [];
  }

  const whereParts = ["e.group_id = $group_id"];
  const params: Record<string, unknown> = {
    group_id: groupId,
    limit_episodes: limitEpisodes,
    limit_entities: limitEntities,
  };
  if (conversationId) {
    whereParts.push("e.conversation_id = $conversation_id");
    params.conversation_id = conversationId;
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH (e:Episodic)
      ${whereClause}
      WITH e
      ORDER BY e.created_at DESC
      LIMIT $limit_episodes
      MATCH (e)-[:MENTIONS]->(entity:Entity)
      WHERE entity.group_id = $group_id
      WITH entity, max(e.created_at) AS last_seen
      ORDER BY last_seen DESC
      RETURN entity.uuid AS uuid
      LIMIT $limit_entities
    `,
    params,
  );

  return records.map((record) => String(record.uuid ?? "")).filter(Boolean);
}

export async function fulltextEdgeSearch(
  query: string,
  groupId: string,
  limit: number,
  filters?: SearchFilters | null,
  includeExpired = false,
): Promise<EntityEdge[]> {
  const q = query.trim().toLowerCase();
  const { clause, params } = buildTemporalQueryClause(filters, "e", "e");

  const whereParts = ["e.group_id = $group_id"];
  if (!includeExpired) {
    whereParts.push("e.invalid_at IS NULL");
  }
  if (q) {
    whereParts.push("(toLower(e.fact) CONTAINS $query OR toLower(e.name) CONTAINS $query)");
  }
  if (clause) {
    whereParts.push(clause.replace("WHERE ", ""));
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH (source:Entity)-[e:RELATES_TO]->(target:Entity)
      ${whereClause}
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
             e.strength AS strength,
             source.uuid AS source_uuid,
             target.uuid AS target_uuid,
             properties(e) AS attributes
      ORDER BY e.created_at DESC
      LIMIT $limit
    `,
    { group_id: groupId, query: q, limit, ...params },
  );

  return records.map((record) => parseEdgeRecord(record));
}

export async function vectorEdgeSearch(
  queryVector: number[],
  groupId: string,
  limit: number,
  filters?: SearchFilters | null,
  includeExpired = false,
  minScore = 0.5,
): Promise<EntityEdge[]> {
  if (queryVector.length === 0) {
    return [];
  }
  const { clause, params } = buildTemporalQueryClause(filters, "e", "e");
  const whereParts = ["e.group_id = $group_id", "e.fact_embedding IS NOT NULL"];
  if (!includeExpired) {
    whereParts.push("e.invalid_at IS NULL");
  }
  if (clause) {
    whereParts.push(clause.replace("WHERE ", ""));
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH ()-[e:RELATES_TO]->()
      ${whereClause}
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
             e.strength AS strength,
             source.uuid AS source_uuid,
             target.uuid AS target_uuid,
             properties(e) AS attributes,
             score
      ORDER BY score DESC
      LIMIT $limit
    `,
    { group_id: groupId, search_vector: queryVector, min_score: minScore, limit, ...params },
  );

  return records.map((record) => parseEdgeRecord(record));
}

export async function hybridEdgeSearch(options: {
  query: string;
  groupId: string;
  limit: number;
  filters?: SearchFilters | null;
  queryVector?: number[] | null;
  includeExpired?: boolean;
}): Promise<EntityEdge[]> {
  const trimmed = options.query.trim();
  const fulltext = await fulltextEdgeSearch(
    trimmed,
    options.groupId,
    options.limit * 2,
    options.filters ?? null,
    options.includeExpired ?? false,
  );
  const vector = options.queryVector
    ? await vectorEdgeSearch(
        options.queryVector,
        options.groupId,
        options.limit * 2,
        options.filters ?? null,
        options.includeExpired ?? false,
      )
    : [];

  const mergedUuids = rrf([
    fulltext.map((edge) => edge.uuid),
    vector.map((edge) => edge.uuid),
  ]).slice(0, options.limit * 2);

  const edgeByUuid = new Map<string, EntityEdge>();
  for (const edge of [...fulltext, ...vector]) {
    edgeByUuid.set(edge.uuid, edge);
  }

  const merged = mergedUuids
    .map((uuid) => edgeByUuid.get(uuid))
    .filter((edge): edge is EntityEdge => Boolean(edge));

  return merged.slice(0, options.limit);
}

export async function fulltextFactSearch(
  query: string,
  groupId: string,
  limit: number,
  filters?: SearchFilters | null,
  includeExpired = false,
): Promise<FactNode[]> {
  const q = query.trim().toLowerCase();
  const { clause, params } = buildTemporalQueryClause(filters, "fact", "fact");

  const whereParts = ["fact.group_id = $group_id"];
  if (!includeExpired) {
    whereParts.push("fact.invalid_at IS NULL");
  }
  if (q) {
    whereParts.push("toLower(fact.fact) CONTAINS $query");
  }
  if (clause) {
    whereParts.push(clause.replace("WHERE ", ""));
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH (fact:Fact)
      ${whereClause}
      RETURN fact.uuid AS uuid,
             fact.name AS name,
             fact.group_id AS group_id,
             fact.fact AS fact,
             fact.fact_embedding AS fact_embedding,
             fact.episodes AS episodes,
             fact.created_at AS created_at,
             fact.expired_at AS expired_at,
             fact.valid_at AS valid_at,
             fact.invalid_at AS invalid_at,
             fact.supersedes AS supersedes,
             fact.superseded_by AS superseded_by,
             properties(fact) AS attributes
      ORDER BY fact.created_at DESC
      LIMIT $limit
    `,
    { group_id: groupId, query: q, limit, ...params },
  );

  return records.map((record) => parseFactRecord(record));
}

export async function vectorFactSearch(
  queryVector: number[],
  groupId: string,
  limit: number,
  filters?: SearchFilters | null,
  includeExpired = false,
  minScore = 0.5,
): Promise<FactNode[]> {
  if (queryVector.length === 0) {
    return [];
  }
  const { clause, params } = buildTemporalQueryClause(filters, "fact", "fact");
  const whereParts = ["fact.group_id = $group_id", "fact.fact_embedding IS NOT NULL"];
  if (!includeExpired) {
    whereParts.push("fact.invalid_at IS NULL");
  }
  if (clause) {
    whereParts.push(clause.replace("WHERE ", ""));
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  const records = await queryGraph(
    `
      MATCH (fact:Fact)
      ${whereClause}
      WITH fact, (2 - vec.cosineDistance(fact.fact_embedding, vecf32($search_vector)))/2 AS score
      WHERE score >= $min_score
      RETURN fact.uuid AS uuid,
             fact.name AS name,
             fact.group_id AS group_id,
             fact.fact AS fact,
             fact.fact_embedding AS fact_embedding,
             fact.episodes AS episodes,
             fact.created_at AS created_at,
             fact.expired_at AS expired_at,
             fact.valid_at AS valid_at,
             fact.invalid_at AS invalid_at,
             fact.supersedes AS supersedes,
             fact.superseded_by AS superseded_by,
             properties(fact) AS attributes,
             score
      ORDER BY score DESC
      LIMIT $limit
    `,
    { group_id: groupId, search_vector: queryVector, min_score: minScore, limit, ...params },
  );

  return records.map((record) => parseFactRecord(record));
}

export async function hybridFactSearch(options: {
  query: string;
  groupId: string;
  limit: number;
  filters?: SearchFilters | null;
  queryVector?: number[] | null;
  includeExpired?: boolean;
}): Promise<FactNode[]> {
  const trimmed = options.query.trim();
  const fulltext = await fulltextFactSearch(
    trimmed,
    options.groupId,
    options.limit * 2,
    options.filters ?? null,
    options.includeExpired ?? false,
  );
  const vector = options.queryVector
    ? await vectorFactSearch(
        options.queryVector,
        options.groupId,
        options.limit * 2,
        options.filters ?? null,
        options.includeExpired ?? false,
      )
    : [];

  const mergedUuids = rrf([
    fulltext.map((fact) => fact.uuid),
    vector.map((fact) => fact.uuid),
  ]).slice(0, options.limit * 2);

  const factByUuid = new Map<string, FactNode>();
  for (const fact of [...fulltext, ...vector]) {
    factByUuid.set(fact.uuid, fact);
  }

  const merged = mergedUuids
    .map((uuid) => factByUuid.get(uuid))
    .filter((fact): fact is FactNode => Boolean(fact));

  return merged.slice(0, options.limit);
}

export type GraphSearchOptions = {
  query: string;
  groupId: string;
  limit: number;
  filters?: SearchFilters | null;
  centerNodeUuid?: string | null;
  rerankMethod?: string | null;
  lambdaParam?: number;
  rerankAlpha?: number;
  recencyWeight?: number;
  conversationId?: string | null;
  includeExpiredFacts?: boolean;
};

export type GraphSearchResults = {
  nodes: EntityNode[];
  edges: EntityEdge[];
  facts: FactNode[];
};

export async function searchGraph(options: GraphSearchOptions): Promise<GraphSearchResults> {
  const query = options.query.trim();
  if (!query) {
    return { nodes: [], edges: [], facts: [] };
  }

  const limit = Math.max(1, options.limit);
  const rerankMethod = options.rerankMethod ?? null;
  const rerankAlpha = typeof options.rerankAlpha === "number" ? options.rerankAlpha : 0.5;
  const lambdaParam = typeof options.lambdaParam === "number" ? options.lambdaParam : 0.5;
  const recencyWeight = typeof options.recencyWeight === "number" ? options.recencyWeight : 0;

  const enableBfs = true;
  const searchBfsLimit = 5;
  const searchBfsMaxDepth = 2;
  const searchBfsSeedLimit = 5;
  const searchRecentEpisodeLimit = 3;
  const searchBfsEpisodeSeedLimit = 5;

  const bfsSlots =
    enableBfs && searchBfsLimit > 0 && limit > 1 ? Math.min(searchBfsLimit, limit - 1) : 0;
  const primaryLimit = limit - bfsSlots;

  const embedder = await OpenAIEmbedder.fromConfig();
  const queryEmbedding = await embedder.create(query.replace(/\n/g, " "));

  const nodeFetchLimit = limit + bfsSlots;
  const edgeFetchLimit = limit + bfsSlots;
  const factFetchLimit = limit + bfsSlots;
  const nodeHybridLimit = rerankMethod ? nodeFetchLimit * 2 : nodeFetchLimit;

  let [nodeCandidates, edgeCandidates, factCandidates] = await Promise.all([
    hybridNodeSearch({
      query,
      groupId: options.groupId,
      limit: nodeHybridLimit,
      filters: options.filters ?? null,
      queryVector: queryEmbedding,
    }),
    hybridEdgeSearch({
      query,
      groupId: options.groupId,
      limit: edgeFetchLimit,
      filters: options.filters ?? null,
      queryVector: queryEmbedding,
    }),
    hybridFactSearch({
      query,
      groupId: options.groupId,
      limit: factFetchLimit,
      filters: options.filters ?? null,
      queryVector: queryEmbedding,
      includeExpired: options.includeExpiredFacts ?? false,
    }),
  ]);

  const enableDomainRouting = true;
  const searchDomainMaxRoutes = 2;
  const searchDomainLimit = 10;
  const hasLabelFilters =
    Boolean(options.filters?.node_labels && options.filters.node_labels.length > 0) ||
    Boolean(options.filters?.edge_types && options.filters.edge_types.length > 0);
  const domainFilters =
    enableDomainRouting && !hasLabelFilters && searchDomainMaxRoutes > 0
      ? selectDomainFilters(query, DEFAULT_DOMAIN_ROUTES, searchDomainMaxRoutes)
      : [];

  if (domainFilters.length > 0) {
    const domainLimit = Math.max(1, Math.min(searchDomainLimit, nodeFetchLimit));
    const domainNodeLists = await Promise.all(
      domainFilters.map((filter) =>
        hybridNodeSearch({
          query,
          groupId: options.groupId,
          limit: domainLimit,
          filters: mergeFilters(options.filters ?? null, filter),
          queryVector: queryEmbedding,
        }),
      ),
    );
    const mergeLimit = Math.max(nodeCandidates.length, nodeFetchLimit);
    nodeCandidates = mergeRankedItems([nodeCandidates, ...domainNodeLists], mergeLimit);

    if (domainFilters.some((filter) => filter.edge_types && filter.edge_types.length > 0)) {
      const edgeDomainLimit = Math.max(1, Math.min(searchDomainLimit, edgeFetchLimit));
      const domainEdgeLists = await Promise.all(
        domainFilters.map((filter) =>
          hybridEdgeSearch({
            query,
            groupId: options.groupId,
            limit: edgeDomainLimit,
            filters: mergeFilters(options.filters ?? null, filter),
            queryVector: queryEmbedding,
          }),
        ),
      );
      edgeCandidates = mergeRankedItems([edgeCandidates, ...domainEdgeLists], edgeFetchLimit);
    }
  }

  let rankedNodes = nodeCandidates;
  if (rerankMethod === "mmr") {
    rankedNodes = mmrRerank(
      nodeCandidates,
      queryEmbedding,
      lambdaParam,
      nodeFetchLimit,
      (node) => node.name_embedding ?? null,
    );
  } else if (rerankMethod === "distance" && options.centerNodeUuid) {
    const distances = await calculateNodeDistances(
      options.centerNodeUuid,
      nodeCandidates.map((node) => node.uuid),
      options.groupId,
      searchBfsMaxDepth,
    );
    rankedNodes = nodeDistanceRerank(nodeCandidates, options.centerNodeUuid, distances).slice(
      0,
      nodeFetchLimit,
    );
  } else if (rerankMethod === "episode_mentions") {
    rankedNodes = scoreByEpisodeMentions(nodeCandidates, rerankAlpha)
      .map(([node]) => node)
      .slice(0, nodeFetchLimit);
  } else if (rerankMethod === "recency") {
    rankedNodes = scoreByRecency(nodeCandidates, rerankAlpha)
      .map(([node]) => node)
      .slice(0, nodeFetchLimit);
  } else if (rerankMethod === "retrospective") {
    rankedNodes = scoreByRetrospectiveQuality(nodeCandidates, rerankAlpha)
      .map(([node]) => node)
      .slice(0, nodeFetchLimit);
  }

  let nodes = rankedNodes.slice(0, primaryLimit);
  let edges = edgeCandidates.slice(0, primaryLimit);
  let facts = factCandidates.slice(0, limit);

  if (bfsSlots > 0) {
    let seedUuids = collectBfsSeedUuids(nodes, edges, searchBfsSeedLimit);
    if (searchRecentEpisodeLimit > 0 && searchBfsEpisodeSeedLimit > 0) {
      const episodeSeeds = await getRecentEpisodeEntityUuids(
        options.groupId,
        searchRecentEpisodeLimit,
        searchBfsEpisodeSeedLimit,
        options.conversationId ?? null,
      );
      seedUuids = extendSeedUuids(
        seedUuids,
        episodeSeeds,
        searchBfsSeedLimit + searchBfsEpisodeSeedLimit,
      );
    }
    if (seedUuids.length > 0) {
      const [bfsNodes, bfsEdges] = await Promise.all([
        nodeBfsSearch(seedUuids, options.groupId, searchBfsMaxDepth, searchBfsLimit),
        edgeBfsSearch(seedUuids, options.groupId, searchBfsMaxDepth, searchBfsLimit),
      ]);
      nodes = selectWithBfs(rankedNodes, bfsNodes, limit, bfsSlots);
      edges = selectWithBfs(edgeCandidates, bfsEdges, limit, bfsSlots);
    }
  }

  if (recencyWeight > 0 && nodes.length > 0) {
    nodes = scoreByRecency(nodes, recencyWeight).map(([node]) => node);
  }

  return { nodes, edges, facts };
}
