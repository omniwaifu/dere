import { queryGraph, toDate, toIsoString } from "./graph-helpers.js";
import {
  createEpisodicEdge,
  createEpisodicNode,
  createEntityEdge,
  createEntityNode,
  createFactNode,
  createFactRoleEdge,
  type EntityEdge,
  type EntityNode,
  type EpisodicEdge,
  type EpisodicNode,
  type FactNode,
  type FactRoleDetail,
  type FactRoleEdge,
} from "./graph-types.js";

function parseDate(value: unknown): Date | null {
  return toDate(value);
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

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_]/g, "_");
}

function parseAttributes(
  record: Record<string, unknown>,
  reservedKeys: string[],
): Record<string, unknown> {
  const raw = record.attributes;
  const attributes: Record<string, unknown> =
    raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  for (const key of reservedKeys) {
    delete attributes[key];
  }
  return attributes;
}

export async function saveEntityNode(node: EntityNode): Promise<void> {
  const labels = [...new Set(["Entity", ...(node.labels ?? [])])].map(sanitizeLabel);
  const labelClause = labels.join(":");
  const entityData: Record<string, unknown> = {
    uuid: node.uuid,
    name: node.name,
    group_id: node.group_id,
    summary: node.summary,
    created_at: node.created_at,
    expired_at: node.expired_at,
    name_embedding: node.name_embedding,
    aliases: node.aliases,
    last_mentioned: node.last_mentioned,
    mention_count: node.mention_count,
    retrieval_count: node.retrieval_count,
    citation_count: node.citation_count,
    retrieval_quality: node.retrieval_quality,
    ...node.attributes,
  };

  await queryGraph(
    `
      MERGE (n:${labelClause} {uuid: $entity.uuid})
      SET n = $entity
      SET n.name_embedding = vecf32($entity.name_embedding)
    `,
    { entity: entityData },
  );
}

export async function saveFactNode(node: FactNode): Promise<void> {
  const factData: Record<string, unknown> = {
    uuid: node.uuid,
    name: node.name,
    fact: node.fact,
    group_id: node.group_id,
    created_at: node.created_at,
    expired_at: node.expired_at,
    fact_embedding: node.fact_embedding,
    episodes: node.episodes,
    valid_at: node.valid_at,
    invalid_at: node.invalid_at,
    supersedes: node.supersedes,
    superseded_by: node.superseded_by,
    ...node.attributes,
  };

  await queryGraph(
    `
      MERGE (f:Fact {uuid: $fact.uuid})
      SET f = $fact
      SET f.fact_embedding = vecf32($fact.fact_embedding)
    `,
    { fact: factData },
  );
}

export async function saveFactRoleEdge(edge: FactRoleEdge): Promise<void> {
  await queryGraph(
    `
      MATCH (fact:Fact {uuid: $fact_uuid})
      MATCH (entity:Entity {uuid: $entity_uuid})
      MERGE (fact)-[r:HAS_ROLE {role: $role, entity_uuid: $entity_uuid}]->(entity)
      SET r.group_id = $group_id,
          r.role_description = $role_description,
          r.created_at = $created_at
    `,
    {
      fact_uuid: edge.source_node_uuid,
      entity_uuid: edge.target_node_uuid,
      role: edge.role,
      role_description: edge.role_description,
      group_id: edge.group_id,
      created_at: edge.created_at,
    },
  );
}

export async function saveEntityEdge(edge: EntityEdge): Promise<void> {
  const edgeData: Record<string, unknown> = {
    uuid: edge.uuid,
    name: edge.name,
    fact: edge.fact,
    fact_embedding: edge.fact_embedding,
    episodes: edge.episodes,
    created_at: edge.created_at,
    expired_at: edge.expired_at,
    valid_at: edge.valid_at,
    invalid_at: edge.invalid_at,
    strength: edge.strength,
    group_id: edge.group_id,
    ...edge.attributes,
  };

  await queryGraph(
    `
      MATCH (source:Entity {uuid: $source_uuid})
      MATCH (target:Entity {uuid: $target_uuid})
      MERGE (source)-[r:RELATES_TO {uuid: $edge.uuid}]->(target)
      SET r = $edge
      SET r.fact_embedding = vecf32($edge.fact_embedding)
    `,
    {
      source_uuid: edge.source_node_uuid,
      target_uuid: edge.target_node_uuid,
      edge: edgeData,
    },
  );
}

export async function saveEpisodicNode(node: EpisodicNode): Promise<void> {
  await queryGraph(
    `
      MERGE (e:Episodic {uuid: $uuid})
      SET e.name = $name,
          e.content = $content,
          e.source_description = $source_description,
          e.source = $source,
          e.group_id = $group_id,
          e.valid_at = $valid_at,
          e.conversation_id = $conversation_id,
          e.entity_edges = $entity_edges,
          e.fact_nodes = $fact_nodes,
          e.speaker_id = $speaker_id,
          e.speaker_name = $speaker_name,
          e.personality = $personality,
          e.created_at = $created_at
    `,
    {
      uuid: node.uuid,
      name: node.name,
      content: node.content,
      source_description: node.source_description,
      source: node.source,
      group_id: node.group_id,
      valid_at: node.valid_at,
      conversation_id: node.conversation_id,
      entity_edges: node.entity_edges,
      fact_nodes: node.fact_nodes,
      speaker_id: node.speaker_id,
      speaker_name: node.speaker_name,
      personality: node.personality,
      created_at: node.created_at,
    },
  );
}

export async function saveEpisodicEdge(edge: EpisodicEdge): Promise<void> {
  await queryGraph(
    `
      MATCH (source:Episodic {uuid: $source_uuid})
      MATCH (target:Entity {uuid: $target_uuid})
      MERGE (source)-[r:MENTIONS {uuid: $uuid}]->(target)
      SET r.group_id = $group_id,
          r.created_at = $created_at
    `,
    {
      uuid: edge.uuid,
      source_uuid: edge.source_node_uuid,
      target_uuid: edge.target_node_uuid,
      group_id: edge.group_id,
      created_at: edge.created_at,
    },
  );
}

export async function trackEntityRetrievals(entityUuids: string[]): Promise<void> {
  const unique = Array.from(new Set(entityUuids.filter(Boolean)));
  if (unique.length === 0) {
    return;
  }

  await queryGraph(
    `
      MATCH (n:Entity)
      WHERE n.uuid IN $uuids
      SET n.retrieval_count = coalesce(n.retrieval_count, 0) + 1
    `,
    { uuids: unique },
  );
}

export async function trackEntityCitations(entityUuids: string[]): Promise<void> {
  const unique = Array.from(new Set(entityUuids.filter(Boolean)));
  if (unique.length === 0) {
    return;
  }

  await queryGraph(
    `
      MATCH (n:Entity)
      WHERE n.uuid IN $uuids
      SET n.citation_count = coalesce(n.citation_count, 0) + 1
      WITH n
      SET n.retrieval_quality = CASE
        WHEN coalesce(n.retrieval_count, 0) = 0 THEN 0
        ELSE toFloat(n.citation_count) / toFloat(n.retrieval_count)
      END
    `,
    { uuids: unique },
  );
}

export async function getRecentEpisodes(groupId: string, limit = 10): Promise<EpisodicNode[]> {
  const records = await queryGraph(
    `
      MATCH (e:Episodic {group_id: $group_id})
      RETURN e.uuid AS uuid,
             e.name AS name,
             e.content AS content,
             e.source_description AS source_description,
             e.source AS source,
             e.group_id AS group_id,
             e.valid_at AS valid_at,
             e.conversation_id AS conversation_id,
             e.entity_edges AS entity_edges,
             e.fact_nodes AS fact_nodes,
             e.speaker_id AS speaker_id,
             e.speaker_name AS speaker_name,
             e.personality AS personality,
             e.created_at AS created_at
      ORDER BY e.created_at DESC
      LIMIT $limit
    `,
    { group_id: groupId, limit },
  );

  return records.map((record) => parseEpisodicRecord(record));
}

export async function getEpisodesByConversationId(
  groupId: string,
  conversationId: string,
): Promise<EpisodicNode[]> {
  const records = await queryGraph(
    `
      MATCH (e:Episodic {conversation_id: $conversation_id, group_id: $group_id})
      RETURN e.uuid AS uuid,
             e.name AS name,
             e.content AS content,
             e.source_description AS source_description,
             e.source AS source,
             e.group_id AS group_id,
             e.valid_at AS valid_at,
             e.conversation_id AS conversation_id,
             e.entity_edges AS entity_edges,
             e.fact_nodes AS fact_nodes,
             e.speaker_id AS speaker_id,
             e.speaker_name AS speaker_name,
             e.personality AS personality,
             e.created_at AS created_at
      ORDER BY e.created_at DESC
    `,
    { group_id: groupId, conversation_id: conversationId },
  );

  return records.map((record) => parseEpisodicRecord(record));
}

export async function getEpisodesForEntities(
  entityUuids: string[],
  groupId: string,
  limit = 10,
): Promise<EpisodicNode[]> {
  if (entityUuids.length === 0) {
    return [];
  }
  const records = await queryGraph(
    `
      MATCH (episode:Episodic)-[:MENTIONS]->(entity:Entity)
      WHERE entity.uuid IN $entity_uuids
        AND episode.group_id = $group_id
      RETURN episode.uuid AS uuid,
             episode.name AS name,
             episode.content AS content,
             episode.source_description AS source_description,
             episode.source AS source,
             episode.group_id AS group_id,
             episode.valid_at AS valid_at,
             episode.conversation_id AS conversation_id,
             episode.entity_edges AS entity_edges,
             episode.fact_nodes AS fact_nodes,
             episode.speaker_id AS speaker_id,
             episode.speaker_name AS speaker_name,
             episode.personality AS personality,
             episode.created_at AS created_at
      ORDER BY episode.valid_at DESC
      LIMIT $limit
    `,
    { entity_uuids: entityUuids, group_id: groupId, limit },
  );

  return records.map((record) => parseEpisodicRecord(record));
}

export async function getEntityByUuid(uuid: string): Promise<EntityNode | null> {
  const records = await queryGraph(
    `
      MATCH (node:Entity {uuid: $uuid})
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
    `,
    { uuid },
  );
  if (records.length === 0) {
    return null;
  }
  return parseEntityRecord(records[0]);
}

export async function getExistingEdges(
  sourceUuid: string,
  targetUuid: string,
  groupId: string,
): Promise<EntityEdge[]> {
  const records = await queryGraph(
    `
      MATCH (source:Entity {uuid: $source_uuid})
      MATCH (target:Entity {uuid: $target_uuid})
      MATCH (source)-[r:RELATES_TO]->(target)
      WHERE r.group_id = $group_id
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
    `,
    { source_uuid: sourceUuid, target_uuid: targetUuid, group_id: groupId },
  );

  return records.map((record) => parseEntityEdgeRecord(record));
}

export async function getFactByText(fact: string, groupId: string): Promise<FactNode | null> {
  const records = await queryGraph(
    `
      MATCH (f:Fact)
      WHERE f.group_id = $group_id
        AND toLower(f.fact) = toLower($fact)
      RETURN f.uuid AS uuid,
             f.name AS name,
             f.fact AS fact,
             f.group_id AS group_id,
             f.created_at AS created_at,
             f.expired_at AS expired_at,
             f.fact_embedding AS fact_embedding,
             f.episodes AS episodes,
             f.valid_at AS valid_at,
             f.invalid_at AS invalid_at,
             f.supersedes AS supersedes,
             f.superseded_by AS superseded_by,
             properties(f) AS attributes
      LIMIT 1
    `,
    { fact, group_id: groupId },
  );
  if (records.length === 0) {
    return null;
  }
  return parseFactRecord(records[0]);
}

export async function getFactsByEntities(
  entityUuids: string[],
  groupId: string,
  limit = 10,
): Promise<FactNode[]> {
  if (entityUuids.length === 0) {
    return [];
  }
  const records = await queryGraph(
    `
      MATCH (fact:Fact)-[:HAS_ROLE]->(entity:Entity)
      WHERE entity.uuid IN $entity_uuids
        AND fact.group_id = $group_id
        AND fact.invalid_at IS NULL
      RETURN DISTINCT fact.uuid AS uuid,
             fact.name AS name,
             fact.fact AS fact,
             fact.group_id AS group_id,
             fact.created_at AS created_at,
             fact.expired_at AS expired_at,
             fact.fact_embedding AS fact_embedding,
             fact.episodes AS episodes,
             fact.valid_at AS valid_at,
             fact.invalid_at AS invalid_at,
             fact.supersedes AS supersedes,
             fact.superseded_by AS superseded_by,
             properties(fact) AS attributes
      LIMIT $limit
    `,
    { entity_uuids: entityUuids, group_id: groupId, limit },
  );

  return records.map((record) => parseFactRecord(record));
}

export async function getFactRoles(
  factUuids: string[],
  groupId: string,
): Promise<FactRoleDetail[]> {
  if (factUuids.length === 0) {
    return [];
  }
  const records = await queryGraph(
    `
      MATCH (fact:Fact)-[r:HAS_ROLE]->(entity:Entity)
      WHERE fact.uuid IN $fact_uuids
        AND fact.group_id = $group_id
        AND entity.group_id = $group_id
      RETURN fact.uuid AS fact_uuid,
             entity.uuid AS entity_uuid,
             entity.name AS entity_name,
             r.role AS role,
             r.role_description AS role_description
    `,
    { fact_uuids: factUuids, group_id: groupId },
  );

  return records.map((record) => ({
    fact_uuid: String(record.fact_uuid ?? ""),
    entity_uuid: String(record.entity_uuid ?? ""),
    entity_name: String(record.entity_name ?? ""),
    role: String(record.role ?? ""),
    role_description: record.role_description ? String(record.role_description) : null,
  }));
}

export async function invalidateEdge(edgeUuid: string, invalidAt: Date): Promise<void> {
  await queryGraph(
    `
      MATCH ()-[r:RELATES_TO {uuid: $uuid}]->()
      SET r.invalid_at = $invalid_at
    `,
    { uuid: edgeUuid, invalid_at: invalidAt },
  );
}

export async function getEdgeUuidsForEpisode(
  episodeUuid: string,
  groupId: string,
): Promise<string[]> {
  const records = await queryGraph(
    `
      MATCH ()-[r:RELATES_TO]->()
      WHERE r.group_id = $group_id
        AND r.episodes IS NOT NULL
        AND $episode_uuid IN r.episodes
      RETURN r.uuid AS uuid
    `,
    { group_id: groupId, episode_uuid: episodeUuid },
  );
  return records.map((record) => String(record.uuid ?? "")).filter(Boolean);
}

export async function getFactUuidsForEpisode(
  episodeUuid: string,
  groupId: string,
): Promise<string[]> {
  const records = await queryGraph(
    `
      MATCH (f:Fact)
      WHERE f.group_id = $group_id
        AND f.episodes IS NOT NULL
        AND $episode_uuid IN f.episodes
      RETURN f.uuid AS uuid
    `,
    { group_id: groupId, episode_uuid: episodeUuid },
  );
  return records.map((record) => String(record.uuid ?? "")).filter(Boolean);
}

export async function findRecentConversationId(
  groupId: string,
  sourceDescription: string,
): Promise<{ conversationId: string; validAt: Date | null } | null> {
  const records = await queryGraph(
    `
      MATCH (e:Episodic)
      WHERE e.source_description = $source_description
        AND e.group_id = $group_id
      RETURN e.conversation_id AS conversation_id,
             e.valid_at AS valid_at
      ORDER BY e.valid_at DESC
      LIMIT 1
    `,
    { source_description: sourceDescription, group_id: groupId },
  );
  if (records.length === 0) {
    return null;
  }
  return {
    conversationId: String(records[0].conversation_id ?? ""),
    validAt: parseDate(records[0].valid_at),
  };
}

function parseEpisodicRecord(record: Record<string, unknown>): EpisodicNode {
  return {
    ...createEpisodicNode({
      name: String(record.name ?? ""),
      group_id: String(record.group_id ?? "default"),
      source: (record.source ?? "text") as "message" | "json" | "text" | "code" | "doc",
      source_description: String(record.source_description ?? ""),
      content: String(record.content ?? ""),
      valid_at: parseDate(record.valid_at) ?? new Date(),
      conversation_id: String(record.conversation_id ?? "default"),
      entity_edges: toStringArray(record.entity_edges),
      fact_nodes: toStringArray(record.fact_nodes),
      speaker_id: record.speaker_id ? String(record.speaker_id) : null,
      speaker_name: record.speaker_name ? String(record.speaker_name) : null,
      personality: record.personality ? String(record.personality) : null,
    }),
    uuid: String(record.uuid ?? ""),
    created_at: parseDate(record.created_at) ?? new Date(),
    expired_at: parseDate(record.expired_at),
  };
}

function parseEntityRecord(record: Record<string, unknown>): EntityNode {
  const labels = toStringArray(record.labels).filter((label) => label !== "Entity");
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
  const attributes = parseAttributes(record, reserved);

  return {
    ...createEntityNode({
      name: String(record.name ?? ""),
      group_id: String(record.group_id ?? "default"),
      labels,
      summary: typeof record.summary === "string" ? record.summary : "",
      attributes,
      aliases: toStringArray(record.aliases),
    }),
    uuid: String(record.uuid ?? ""),
    created_at: parseDate(record.created_at) ?? new Date(),
    expired_at: parseDate(record.expired_at),
    name_embedding: Array.isArray(record.name_embedding)
      ? (record.name_embedding as number[])
      : null,
    last_mentioned: parseDate(record.last_mentioned),
    mention_count: parseNumber(record.mention_count, 1),
    retrieval_count: parseNumber(record.retrieval_count, 0),
    citation_count: parseNumber(record.citation_count, 0),
    retrieval_quality: parseNumber(record.retrieval_quality, 1),
  };
}

function parseFactRecord(record: Record<string, unknown>): FactNode {
  const reserved = [
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
  ];
  const attributes = parseAttributes(record, reserved);
  return {
    ...createFactNode({
      fact: String(record.fact ?? ""),
      group_id: String(record.group_id ?? "default"),
      attributes,
      episodes: toStringArray(record.episodes),
      valid_at: parseDate(record.valid_at),
      invalid_at: parseDate(record.invalid_at),
    }),
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? record.fact ?? ""),
    created_at: parseDate(record.created_at) ?? new Date(),
    expired_at: parseDate(record.expired_at),
    fact_embedding: Array.isArray(record.fact_embedding)
      ? (record.fact_embedding as number[])
      : null,
    supersedes: toStringArray(record.supersedes),
    superseded_by: toStringArray(record.superseded_by),
  };
}

function parseEntityEdgeRecord(record: Record<string, unknown>): EntityEdge {
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
  const attributes = parseAttributes(record, reserved);

  return {
    ...createEntityEdge({
      source_node_uuid: String(record.source_uuid ?? ""),
      target_node_uuid: String(record.target_uuid ?? ""),
      group_id: String(record.group_id ?? "default"),
      name: String(record.name ?? ""),
      fact: String(record.fact ?? ""),
      episodes: toStringArray(record.episodes),
      strength:
        record.strength === null || record.strength === undefined
          ? null
          : parseNumber(record.strength, 0),
      valid_at: parseDate(record.valid_at),
      invalid_at: parseDate(record.invalid_at),
      attributes,
    }),
    uuid: String(record.uuid ?? ""),
    created_at: parseDate(record.created_at) ?? new Date(),
    expired_at: parseDate(record.expired_at),
    fact_embedding: Array.isArray(record.fact_embedding)
      ? (record.fact_embedding as number[])
      : null,
  };
}

export function parseEdgeDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export function toIso(date: Date | null): string | null {
  return date ? toIsoString(date) : null;
}

export {
  createEntityNode,
  createEntityEdge,
  createFactNode,
  createFactRoleEdge,
  createEpisodicEdge,
};
