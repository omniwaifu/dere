export type EpisodeType = "message" | "json" | "text" | "code" | "doc";

export type BaseNode = {
  uuid: string;
  name: string;
  group_id: string;
  labels: string[];
  created_at: Date;
  expired_at: Date | null;
};

export type EntityNode = BaseNode & {
  name_embedding: number[] | null;
  summary: string;
  attributes: Record<string, unknown>;
  aliases: string[];
  last_mentioned: Date | null;
  mention_count: number;
  retrieval_count: number;
  citation_count: number;
  retrieval_quality: number;
};

export type EpisodicNode = BaseNode & {
  source: EpisodeType;
  source_description: string;
  content: string;
  valid_at: Date;
  conversation_id: string;
  entity_edges: string[];
  fact_nodes: string[];
  speaker_id: string | null;
  speaker_name: string | null;
  personality: string | null;
};

export type CommunityNode = BaseNode & {
  name_embedding: number[] | null;
  summary: string;
};

export type FactNode = BaseNode & {
  fact: string;
  fact_embedding: number[] | null;
  attributes: Record<string, unknown>;
  episodes: string[];
  valid_at: Date | null;
  invalid_at: Date | null;
  supersedes: string[];
  superseded_by: string[];
};

export type BaseEdge = {
  uuid: string;
  group_id: string;
  source_node_uuid: string;
  target_node_uuid: string;
  created_at: Date;
};

export type EntityEdge = BaseEdge & {
  name: string;
  fact: string;
  fact_embedding: number[] | null;
  episodes: string[];
  expired_at: Date | null;
  strength: number | null;
  valid_at: Date | null;
  invalid_at: Date | null;
  attributes: Record<string, unknown>;
};

export type EpisodicEdge = BaseEdge;

export type FactRoleEdge = BaseEdge & {
  role: string;
  role_description: string | null;
};

export type FactRoleDetail = {
  fact_uuid: string;
  entity_uuid: string;
  entity_name: string;
  role: string;
  role_description: string | null;
};

export function nowUtc(): Date {
  return new Date();
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function createEntityNode(input: {
  name: string;
  group_id: string;
  labels?: string[];
  summary?: string;
  attributes?: Record<string, unknown>;
  aliases?: string[];
}): EntityNode {
  return {
    uuid: newUuid(),
    name: input.name,
    group_id: input.group_id,
    labels: input.labels ?? [],
    created_at: nowUtc(),
    expired_at: null,
    name_embedding: null,
    summary: input.summary ?? "",
    attributes: input.attributes ?? {},
    aliases: input.aliases ?? [],
    last_mentioned: null,
    mention_count: 1,
    retrieval_count: 0,
    citation_count: 0,
    retrieval_quality: 1.0,
  };
}

export function createEpisodicNode(input: {
  name: string;
  group_id: string;
  source: EpisodeType;
  source_description: string;
  content: string;
  valid_at: Date;
  conversation_id: string;
  entity_edges?: string[];
  fact_nodes?: string[];
  speaker_id?: string | null;
  speaker_name?: string | null;
  personality?: string | null;
}): EpisodicNode {
  return {
    uuid: newUuid(),
    name: input.name,
    group_id: input.group_id,
    labels: [],
    created_at: nowUtc(),
    expired_at: null,
    source: input.source,
    source_description: input.source_description,
    content: input.content,
    valid_at: input.valid_at,
    conversation_id: input.conversation_id,
    entity_edges: input.entity_edges ?? [],
    fact_nodes: input.fact_nodes ?? [],
    speaker_id: input.speaker_id ?? null,
    speaker_name: input.speaker_name ?? null,
    personality: input.personality ?? null,
  };
}

export function createEntityEdge(input: {
  source_node_uuid: string;
  target_node_uuid: string;
  group_id: string;
  name: string;
  fact: string;
  episodes?: string[];
  strength?: number | null;
  valid_at?: Date | null;
  invalid_at?: Date | null;
  attributes?: Record<string, unknown>;
}): EntityEdge {
  return {
    uuid: newUuid(),
    group_id: input.group_id,
    source_node_uuid: input.source_node_uuid,
    target_node_uuid: input.target_node_uuid,
    created_at: nowUtc(),
    name: input.name,
    fact: input.fact,
    fact_embedding: null,
    episodes: input.episodes ?? [],
    expired_at: null,
    strength: input.strength ?? null,
    valid_at: input.valid_at ?? null,
    invalid_at: input.invalid_at ?? null,
    attributes: input.attributes ?? {},
  };
}

export function createFactNode(input: {
  fact: string;
  group_id: string;
  attributes?: Record<string, unknown>;
  episodes?: string[];
  valid_at?: Date | null;
  invalid_at?: Date | null;
}): FactNode {
  return {
    uuid: newUuid(),
    name: input.fact,
    group_id: input.group_id,
    labels: [],
    created_at: nowUtc(),
    expired_at: null,
    fact: input.fact,
    fact_embedding: null,
    attributes: input.attributes ?? {},
    episodes: input.episodes ?? [],
    valid_at: input.valid_at ?? null,
    invalid_at: input.invalid_at ?? null,
    supersedes: [],
    superseded_by: [],
  };
}

export function createFactRoleEdge(input: {
  source_node_uuid: string;
  target_node_uuid: string;
  group_id: string;
  role: string;
  role_description?: string | null;
}): FactRoleEdge {
  return {
    uuid: newUuid(),
    group_id: input.group_id,
    source_node_uuid: input.source_node_uuid,
    target_node_uuid: input.target_node_uuid,
    created_at: nowUtc(),
    role: input.role,
    role_description: input.role_description ?? null,
  };
}

export function createEpisodicEdge(input: {
  source_node_uuid: string;
  target_node_uuid: string;
  group_id: string;
}): EpisodicEdge {
  return {
    uuid: newUuid(),
    group_id: input.group_id,
    source_node_uuid: input.source_node_uuid,
    target_node_uuid: input.target_node_uuid,
    created_at: nowUtc(),
  };
}

export function parseEpisodeType(value: string | null | undefined): EpisodeType {
  switch ((value ?? "").toLowerCase()) {
    case "message":
      return "message";
    case "json":
      return "json";
    case "text":
      return "text";
    case "code":
      return "code";
    case "doc":
      return "doc";
    default:
      return "text";
  }
}
