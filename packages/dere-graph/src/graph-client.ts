import { createClient } from "redis";
import { loadConfig } from "@dere/shared-config";
import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";

type GraphRecord = Record<string, unknown>;
type GraphRedisClient = ReturnType<typeof createClient>;

class GraphClient {
  private readonly client: GraphRedisClient;
  private readonly graphName: string;

  constructor(client: GraphRedisClient, graphName: string) {
    this.client = client;
    this.graphName = graphName;
  }

  async query(cypher: string, params?: Record<string, unknown>): Promise<GraphRecord[]> {
    const finalQuery = params ? inlineParams(cypher, params) : cypher;
    const raw = await this.client.sendCommand(["GRAPH.QUERY", this.graphName, finalQuery]);

    if (!Array.isArray(raw) || raw.length < 2) {
      return [];
    }

    const header = Array.isArray(raw[0]) ? raw[0] : [];
    const rows = Array.isArray(raw[1]) ? raw[1] : [];
    const columns = header.map((col) =>
      Array.isArray(col) && col.length > 1 ? String(col[1]) : String(col),
    );

    return rows.map((row) => {
      const record: GraphRecord = {};
      if (Array.isArray(row)) {
        for (let i = 0; i < columns.length; i += 1) {
          const column = columns[i];
          if (!column) {
            continue;
          }
          record[column] = row[i] ?? null;
        }
      }
      return record;
    });
  }
}

let graphClientPromise: Promise<GraphClient | null> | null = null;
let communityClientPromise: Promise<TextResponseClient> | null = null;

export async function getGraphClient(): Promise<GraphClient | null> {
  if (graphClientPromise) {
    return graphClientPromise;
  }

  graphClientPromise = (async () => {
    const config = (await loadConfig()) as { dere_graph?: Record<string, unknown> };
    const graphConfig = (config.dere_graph ?? {}) as Record<string, unknown>;
    if (graphConfig.enabled === false) {
      return null;
    }

    const host =
      typeof graphConfig.falkor_host === "string" ? graphConfig.falkor_host : "localhost";
    const port = typeof graphConfig.falkor_port === "number" ? graphConfig.falkor_port : 6379;
    const database =
      typeof graphConfig.falkor_database === "string" ? graphConfig.falkor_database : "dere_graph";

    const client = createClient({ url: `redis://${host}:${port}` });
    client.on("error", (error) => {
      console.log(`[graph] redis error: ${String(error)}`);
    });
    try {
      await client.connect();
    } catch (error) {
      console.log(`[graph] failed to connect: ${String(error)}`);
      return null;
    }

    return new GraphClient(client, database);
  })();

  return graphClientPromise;
}

async function getCommunityClient(): Promise<TextResponseClient> {
  if (communityClientPromise) {
    return communityClientPromise;
  }

  communityClientPromise = (async () => {
    const transport = new ClaudeAgentTransport({
      workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
    });
    const config = (await loadConfig()) as { dere_graph?: Record<string, unknown> };
    const graphConfig = (config.dere_graph ?? {}) as Record<string, unknown>;
    const model =
      (typeof graphConfig.claude_model === "string" && graphConfig.claude_model) ||
      process.env.DERE_GRAPH_MODEL ||
      "claude-haiku-4-5";
    return new TextResponseClient({ transport, model });
  })();

  return communityClientPromise;
}

function inlineParams(query: string, params: Record<string, unknown>): string {
  return query.replace(/\$([a-zA-Z_]\w*)/g, (match, key) => {
    if (!(key in params)) {
      return match;
    }
    return toCypherValue(params[key]);
  });
}

function toCypherValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (value instanceof Date) {
    return `'${escapeCypher(value.toISOString())}'`;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => toCypherValue(item));
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "string") {
    return `'${escapeCypher(value)}'`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
      return `${k}: ${toCypherValue(v)}`;
    });
    return `{${entries.join(", ")}}`;
  }
  return "NULL";
}

function escapeCypher(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function parseDate(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

type CommunityEntity = {
  uuid: string;
  name: string;
  summary: string;
  labels: string[];
};

type CommunityEdge = {
  source_uuid: string;
  target_uuid: string;
  relation_type: string;
  fact: string;
};

async function fetchCommunityData(
  client: GraphClient,
  groupId: string,
): Promise<{
  entities: CommunityEntity[];
  edges: CommunityEdge[];
}> {
  const entityRecords = await client.query(
    `
      MATCH (n:Entity {group_id: $group_id})
      WHERE n.name_embedding IS NOT NULL
      RETURN n.uuid AS uuid,
             n.name AS name,
             n.group_id AS group_id,
             n.summary AS summary,
             labels(n) AS labels
    `,
    { group_id: groupId },
  );

  const entities = entityRecords
    .map((record) => ({
      uuid: String(record.uuid ?? ""),
      name: String(record.name ?? ""),
      summary: typeof record.summary === "string" ? record.summary : "",
      labels: Array.isArray(record.labels)
        ? record.labels.filter((label) => label !== "Entity").map((label) => String(label))
        : [],
    }))
    .filter((entity) => entity.uuid);

  const edgeRecords = await client.query(
    `
      MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
      WHERE r.group_id = $group_id
        AND r.invalid_at IS NULL
      RETURN source.uuid AS source_uuid,
             target.uuid AS target_uuid,
             r.name AS relation_type,
             r.fact AS fact
    `,
    { group_id: groupId },
  );

  const edges = edgeRecords.map((record) => ({
    source_uuid: String(record.source_uuid ?? ""),
    target_uuid: String(record.target_uuid ?? ""),
    relation_type: String(record.relation_type ?? ""),
    fact: String(record.fact ?? ""),
  }));

  return { entities, edges };
}

function buildAdjacencyMatrix(entities: CommunityEntity[], edges: CommunityEdge[]): number[][] {
  const size = entities.length;
  const matrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
  const index = new Map<string, number>();
  entities.forEach((entity, idx) => {
    index.set(entity.uuid, idx);
  });

  for (const edge of edges) {
    const sourceIdx = index.get(edge.source_uuid);
    const targetIdx = index.get(edge.target_uuid);
    if (sourceIdx === undefined || targetIdx === undefined) {
      continue;
    }
    const sourceRow = matrix[sourceIdx];
    const targetRow = matrix[targetIdx];
    if (!sourceRow || !targetRow) {
      continue;
    }
    sourceRow[targetIdx] = (sourceRow[targetIdx] ?? 0) + 1;
    targetRow[sourceIdx] = (targetRow[sourceIdx] ?? 0) + 1;
  }

  return matrix;
}

function leidenClustering(adj: number[][], resolution: number): number[] {
  const n = adj.length;
  const communities = Array.from({ length: n }, (_, i) => i);
  let totalWeight = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      totalWeight += adj[i]?.[j] ?? 0;
    }
  }
  totalWeight /= 2;
  if (totalWeight === 0) {
    return communities;
  }

  let improved = true;
  let iterations = 0;
  const maxIterations = 100;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations += 1;
    for (let node = 0; node < n; node += 1) {
      const currentCommunity = communities[node];
      if (currentCommunity === undefined) {
        continue;
      }
      let bestCommunity = currentCommunity;
      let bestDelta = 0;

      const neighborCommunities = new Set<number>();
      for (let neighbor = 0; neighbor < n; neighbor += 1) {
        const edgeWeight = adj[node]?.[neighbor] ?? 0;
        const neighborCommunity = communities[neighbor];
        if (edgeWeight > 0 && neighborCommunity !== undefined) {
          neighborCommunities.add(neighborCommunity);
        }
      }

      for (const candidateCommunity of neighborCommunities) {
        if (candidateCommunity === currentCommunity) {
          continue;
        }

        let toCommunityWeight = 0;
        let fromCommunityWeight = 0;
        for (let other = 0; other < n; other += 1) {
          const otherCommunity = communities[other];
          const edgeWeight = adj[node]?.[other] ?? 0;
          if (otherCommunity === candidateCommunity) {
            toCommunityWeight += edgeWeight;
          }
          if (otherCommunity === currentCommunity && other !== node) {
            fromCommunityWeight += edgeWeight;
          }
        }

        const delta = ((toCommunityWeight - fromCommunityWeight) / totalWeight) * resolution;
        if (delta > bestDelta) {
          bestDelta = delta;
          bestCommunity = candidateCommunity;
        }
      }

      if (bestCommunity !== currentCommunity) {
        communities[node] = bestCommunity;
        improved = true;
      }
    }
  }

  const unique = Array.from(new Set(communities)).sort((a, b) => a - b);
  const mapping = new Map<number, number>();
  unique.forEach((value, idx) => mapping.set(value, idx));
  return communities.map((comm) => mapping.get(comm) ?? comm);
}

function buildCommunityName(members: CommunityEntity[], fallback: string): string {
  const names = Array.from(new Set(members.map((member) => member.name).filter(Boolean))).sort();
  if (names.length === 0) {
    return fallback;
  }
  return `Community: ${names.slice(0, 3).join(", ")}`;
}

async function summarizeCommunity(
  members: CommunityEntity[],
  edges: CommunityEdge[],
): Promise<string> {
  const membersData = members.map((member) => ({
    name: member.name,
    labels: member.labels,
    summary: member.summary,
  }));

  const memberUuids = new Set(members.map((member) => member.uuid));
  const edgesData = edges
    .filter((edge) => memberUuids.has(edge.source_uuid) && memberUuids.has(edge.target_uuid))
    .map((edge) => ({
      source: edge.source_uuid,
      target: edge.target_uuid,
      relation: edge.relation_type,
      fact: edge.fact,
    }));

  const prompt = [
    "You are an expert at analyzing knowledge graphs and identifying common themes, relationships, and purposes within clusters of related entities.",
    "",
    "<COMMUNITY MEMBERS>",
    JSON.stringify(membersData, null, 2),
    "</COMMUNITY MEMBERS>",
    "",
    "<RELATIONSHIPS>",
    JSON.stringify(edgesData, null, 2),
    "</RELATIONSHIPS>",
    "",
    "# TASK",
    "Analyze the above entities and their relationships to create a concise summary of this community.",
    "",
    "Your summary should:",
    "1. Identify the main theme or purpose that connects these entities",
    "2. Highlight key relationships and patterns",
    "3. Be 2-4 sentences maximum",
    "4. Be specific and informative",
    "",
    "Focus on what makes this a cohesive community and what the entities have in common.",
  ].join("\n");

  const client = await getCommunityClient();
  const response = await client.generate(prompt);
  return response.trim();
}

async function deleteCommunitiesByGroup(client: GraphClient, groupId: string): Promise<void> {
  await client.query(
    `
      MATCH (c:Community {group_id: $group_id})
      DETACH DELETE c
    `,
    { group_id: groupId },
  );
}

async function saveCommunityNode(
  client: GraphClient,
  node: { uuid: string; name: string; group_id: string; summary: string; created_at: Date },
): Promise<void> {
  await client.query(
    `
      MERGE (c:Community {uuid: $uuid})
      SET c.name = $name,
          c.group_id = $group_id,
          c.summary = $summary,
          c.name_embedding = $name_embedding,
          c.created_at = $created_at,
          c.expired_at = $expired_at
    `,
    {
      uuid: node.uuid,
      name: node.name,
      group_id: node.group_id,
      summary: node.summary,
      name_embedding: null,
      created_at: node.created_at,
      expired_at: null,
    },
  );
}

async function saveCommunityMembers(
  client: GraphClient,
  communityUuid: string,
  memberUuids: string[],
  groupId: string,
): Promise<void> {
  if (memberUuids.length === 0) {
    return;
  }

  await client.query(
    `
      MATCH (c:Community {uuid: $community_uuid})
      UNWIND $member_uuids AS member_uuid
      MATCH (e:Entity {uuid: member_uuid})
      MERGE (c)-[r:HAS_MEMBER]->(e)
      SET r.group_id = $group_id
    `,
    {
      community_uuid: communityUuid,
      member_uuids: memberUuids,
      group_id: groupId,
    },
  );
}

async function mergeEntityNodes(
  client: GraphClient,
  primaryUuid: string,
  duplicateUuid: string,
): Promise<void> {
  await client.query(
    `
      MATCH (primary:Entity {uuid: $primary_uuid})
      MATCH (dup:Entity {uuid: $duplicate_uuid})

      CALL {
        WITH primary, dup
        MATCH (dup)-[r:RELATES_TO]->(t)
        MERGE (primary)-[r2:RELATES_TO {uuid: r.uuid}]->(t)
        SET r2 = r,
            r2.source_node_uuid = $primary_uuid
        DELETE r
      }
      CALL {
        WITH primary, dup
        MATCH (s)-[r:RELATES_TO]->(dup)
        MERGE (s)-[r2:RELATES_TO {uuid: r.uuid}]->(primary)
        SET r2 = r,
            r2.target_node_uuid = $primary_uuid
        DELETE r
      }
      CALL {
        WITH primary, dup
        MATCH (e:Episodic)-[r:MENTIONS]->(dup)
        MERGE (e)-[r2:MENTIONS {uuid: r.uuid}]->(primary)
        SET r2 = r
        DELETE r
      }
      CALL {
        WITH primary, dup
        MATCH (f:Fact)-[r:HAS_ROLE]->(dup)
        MERGE (f)-[r2:HAS_ROLE {role: r.role, entity_uuid: $primary_uuid}]->(primary)
        SET r2 = r,
            r2.entity_uuid = $primary_uuid
        DELETE r
      }
      CALL {
        WITH primary, dup
        MATCH (c:Community)-[r:HAS_MEMBER]->(dup)
        MERGE (c)-[r2:HAS_MEMBER]->(primary)
        SET r2 = r
        DELETE r
      }

      WITH dup
      DETACH DELETE dup
    `,
    {
      primary_uuid: primaryUuid,
      duplicate_uuid: duplicateUuid,
    },
  );
}

export async function invalidateStaleEdges(groupId: string, cutoff: Date): Promise<number> {
  const client = await getGraphClient();
  if (!client) {
    return 0;
  }

  const records = await client.query(
    `
      MATCH ()-[r:RELATES_TO]->()
      WHERE r.group_id = $group_id AND r.invalid_at IS NULL
      WITH r
      OPTIONAL MATCH (e:Episodic)
      WHERE e.uuid IN coalesce(r.episodes, [])
      WITH r, max(e.created_at) AS last_seen
      WHERE last_seen IS NOT NULL AND last_seen < $cutoff
      SET r.invalid_at = $cutoff
      RETURN count(r) AS updated
    `,
    { group_id: groupId, cutoff },
  );

  return Number(records[0]?.updated ?? 0);
}

export async function invalidateStaleFacts(groupId: string, cutoff: Date): Promise<number> {
  const client = await getGraphClient();
  if (!client) {
    return 0;
  }

  const records = await client.query(
    `
      MATCH (f:Fact)
      WHERE f.group_id = $group_id AND f.invalid_at IS NULL
      WITH f
      OPTIONAL MATCH (e:Episodic)
      WHERE e.uuid IN coalesce(f.episodes, [])
      WITH f, max(e.created_at) AS last_seen
      WHERE last_seen IS NOT NULL AND last_seen < $cutoff
      SET f.invalid_at = $cutoff
      RETURN count(f) AS updated
    `,
    { group_id: groupId, cutoff },
  );

  return Number(records[0]?.updated ?? 0);
}

export async function invalidateLowQualityFacts(
  groupId: string,
  cutoff: Date,
  qualityThreshold: number,
  minRetrievals: number,
): Promise<number> {
  const client = await getGraphClient();
  if (!client) {
    return 0;
  }

  const now = new Date();
  const records = await client.query(
    `
      MATCH (f:Fact)
      WHERE f.group_id = $group_id
        AND f.invalid_at IS NULL
        AND f.created_at < $cutoff
      WITH f,
           coalesce(f.retrieval_count, 0) AS retrievals,
           coalesce(f.citation_count, 0) AS citations
      WHERE retrievals >= $min_retrievals
      WITH f, retrievals, citations,
           CASE WHEN retrievals = 0 THEN 0
                ELSE toFloat(citations) / retrievals
           END AS quality
      WHERE quality < $quality_threshold
      SET f.invalid_at = $now
      RETURN count(f) AS updated
    `,
    {
      group_id: groupId,
      cutoff,
      min_retrievals: minRetrievals,
      quality_threshold: qualityThreshold,
      now,
    },
  );

  return Number(records[0]?.updated ?? 0);
}

export async function mergeDuplicateEntities(groupId: string, limit: number): Promise<number> {
  const client = await getGraphClient();
  if (!client) {
    return 0;
  }

  const records = await client.query(
    `
      MATCH (n:Entity)
      WHERE n.group_id = $group_id
      WITH toLower(n.name) AS norm, collect(n.uuid) AS uuids
      WHERE size(uuids) > 1
      RETURN norm, uuids
      LIMIT $limit
    `,
    { group_id: groupId, limit },
  );

  let merged = 0;

  for (const record of records) {
    const uuids = Array.isArray(record.uuids) ? (record.uuids as string[]) : [];
    if (uuids.length < 2) {
      continue;
    }

    const nodes = await client.query(
      `
        MATCH (n:Entity)
        WHERE n.uuid IN $uuids
        RETURN n.uuid AS uuid,
               n.name AS name,
               n.aliases AS aliases,
               n.summary AS summary,
               n.mention_count AS mention_count,
               n.retrieval_count AS retrieval_count,
               n.citation_count AS citation_count,
               n.retrieval_quality AS retrieval_quality,
               n.last_mentioned AS last_mentioned,
               n.created_at AS created_at
      `,
      { uuids },
    );

    if (nodes.length < 2) {
      continue;
    }

    nodes.sort((a, b) => {
      const mentionA = Number(a.mention_count ?? 0);
      const mentionB = Number(b.mention_count ?? 0);
      if (mentionA !== mentionB) {
        return mentionB - mentionA;
      }
      return parseDate(a.created_at) - parseDate(b.created_at);
    });

    const primary = nodes[0];
    if (!primary) {
      continue;
    }
    const primaryUuid = typeof primary.uuid === "string" ? primary.uuid : "";
    if (!primaryUuid) {
      continue;
    }
    const aliases = new Set<string>();
    const primaryName = typeof primary.name === "string" ? primary.name : "";

    let summary = typeof primary.summary === "string" ? primary.summary : "";
    let mentionCount = Number(primary.mention_count ?? 0);
    let retrievalCount = Number(primary.retrieval_count ?? 0);
    let citationCount = Number(primary.citation_count ?? 0);
    let lastMentioned = parseDate(primary.last_mentioned);
    let createdAt = parseDate(primary.created_at);

    const primaryAliases = Array.isArray(primary.aliases) ? primary.aliases : [];
    for (const alias of primaryAliases) {
      if (typeof alias === "string" && alias) {
        aliases.add(alias);
      }
    }

    for (const node of nodes.slice(1)) {
      const name = typeof node.name === "string" ? node.name : "";
      if (name) {
        aliases.add(name);
      }
      const nodeAliases = Array.isArray(node.aliases) ? node.aliases : [];
      for (const alias of nodeAliases) {
        if (typeof alias === "string" && alias) {
          aliases.add(alias);
        }
      }
      if (!summary && typeof node.summary === "string") {
        summary = node.summary;
      }
      mentionCount += Number(node.mention_count ?? 0);
      retrievalCount += Number(node.retrieval_count ?? 0);
      citationCount += Number(node.citation_count ?? 0);

      const nodeLast = parseDate(node.last_mentioned);
      if (nodeLast > lastMentioned) {
        lastMentioned = nodeLast;
      }

      const nodeCreated = parseDate(node.created_at);
      if (nodeCreated && (createdAt === 0 || nodeCreated < createdAt)) {
        createdAt = nodeCreated;
      }
    }

    if (primaryName) {
      aliases.delete(primaryName);
    }

    const retrievalQuality = retrievalCount > 0 ? citationCount / retrievalCount : 0;

    await client.query(
      `
        MATCH (n:Entity {uuid: $uuid})
        SET n.aliases = $aliases,
            n.summary = $summary,
            n.mention_count = $mention_count,
            n.retrieval_count = $retrieval_count,
            n.citation_count = $citation_count,
            n.retrieval_quality = $retrieval_quality,
            n.last_mentioned = $last_mentioned,
            n.created_at = $created_at
      `,
      {
        uuid: primaryUuid,
        aliases: Array.from(aliases),
        summary,
        mention_count: mentionCount,
        retrieval_count: retrievalCount,
        citation_count: citationCount,
        retrieval_quality: retrievalQuality,
        last_mentioned: lastMentioned ? new Date(lastMentioned) : null,
        created_at: createdAt ? new Date(createdAt) : null,
      },
    );

    const duplicateIds = nodes
      .slice(1)
      .map((node) => (typeof node.uuid === "string" ? node.uuid : ""))
      .filter((uuid) => uuid);
    for (const duplicateId of duplicateIds) {
      await mergeEntityNodes(client, primaryUuid, duplicateId);
      merged += 1;
    }
  }

  return merged;
}

export async function buildCommunities(_groupId?: string, _resolution?: number): Promise<number> {
  const groupId = _groupId ?? "default";
  const resolution = typeof _resolution === "number" ? _resolution : 1.0;
  const client = await getGraphClient();
  if (!client) {
    return 0;
  }

  const { entities, edges } = await fetchCommunityData(client, groupId);
  if (entities.length < 2) {
    return 0;
  }

  const adj = buildAdjacencyMatrix(entities, edges);
  const communities = leidenClustering(adj, resolution);
  const groups = new Map<number, CommunityEntity[]>();

  communities.forEach((communityId, idx) => {
    const entity = entities[idx];
    if (!entity) {
      return;
    }
    const list = groups.get(communityId) ?? [];
    list.push(entity);
    groups.set(communityId, list);
  });

  await deleteCommunitiesByGroup(client, groupId);

  let created = 0;
  for (const [communityId, members] of groups.entries()) {
    if (members.length < 2) {
      continue;
    }
    let summary = "";
    try {
      summary = await summarizeCommunity(members, edges);
    } catch (error) {
      console.log(`[graph] community summary failed: ${String(error)}`);
      summary = "";
    }
    const name = buildCommunityName(members, `Community ${communityId}`);
    const communityUuid = crypto.randomUUID();
    await saveCommunityNode(client, {
      uuid: communityUuid,
      name,
      group_id: groupId,
      summary,
      created_at: new Date(),
    });
    await saveCommunityMembers(
      client,
      communityUuid,
      members.map((member) => member.uuid),
      groupId,
    );
    created += 1;
  }

  return created;
}
