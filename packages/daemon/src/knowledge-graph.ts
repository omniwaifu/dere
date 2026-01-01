import type { Hono } from "hono";

import {
  graphAvailable,
  queryGraph,
  toDate,
  toIsoString,
  toNumber,
  toStringArray,
} from "./graph-helpers.js";
import { type SearchFilters } from "./graph-filters.js";
import { hybridFactSearch, searchGraph } from "./graph-search.js";

type FactRoleSummary = {
  entity_uuid: string;
  entity_name: string;
  role: string;
  role_description: string | null;
};

type EntitySummary = {
  uuid: string;
  name: string;
  labels: string[];
  summary: string;
  mention_count: number;
  retrieval_quality: number;
  last_mentioned: string | null;
  created_at: string;
};

type EdgeSummary = {
  uuid: string;
  source_uuid: string;
  source_name: string;
  target_uuid: string;
  target_name: string;
  relation: string;
  fact: string;
  strength: number | null;
  valid_at: string | null;
  invalid_at: string | null;
  created_at: string;
};

type FactSummary = {
  uuid: string;
  fact: string;
  roles: FactRoleSummary[];
  attributes: Record<string, unknown> | null;
  valid_at: string | null;
  invalid_at: string | null;
  created_at: string;
};

function getGroupId(url: URL): string {
  return url.searchParams.get("user_id") ?? "default";
}

function parseLabels(url: URL): string[] {
  const raw = url.searchParams.getAll("labels");
  if (raw.length === 0) {
    return [];
  }
  if (raw.length === 1 && raw[0].includes(",")) {
    return raw[0]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return raw.map((item) => item.trim()).filter(Boolean);
}

function parseBool(value: string | null | undefined, fallback = false): boolean {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function parseLimit(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, parsed);
}

function parseOffset(value: string | null, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function toEntitySummary(record: Record<string, unknown>): EntitySummary {
  return {
    uuid: String(record.uuid ?? ""),
    name: String(record.name ?? ""),
    labels: toStringArray(record.labels),
    summary: typeof record.summary === "string" ? record.summary : "",
    mention_count: toNumber(record.mention_count, 1),
    retrieval_quality: toNumber(record.retrieval_quality, 1),
    last_mentioned: toIsoString(record.last_mentioned),
    created_at: toIsoString(record.created_at) ?? "",
  };
}

function toEdgeSummary(record: Record<string, unknown>): EdgeSummary {
  return {
    uuid: String(record.uuid ?? ""),
    source_uuid: String(record.source_uuid ?? ""),
    source_name: String(record.source_name ?? ""),
    target_uuid: String(record.target_uuid ?? ""),
    target_name: String(record.target_name ?? ""),
    relation: String(record.relation ?? ""),
    fact: String(record.fact ?? ""),
    strength:
      record.strength === null || record.strength === undefined
        ? null
        : toNumber(record.strength, 0),
    valid_at: toIsoString(record.valid_at),
    invalid_at: toIsoString(record.invalid_at),
    created_at: toIsoString(record.created_at) ?? "",
  };
}

function toFactSummary(record: Record<string, unknown>, roles: FactRoleSummary[]): FactSummary {
  return {
    uuid: String(record.uuid ?? ""),
    fact: String(record.fact ?? ""),
    roles,
    attributes:
      record.attributes && typeof record.attributes === "object"
        ? (record.attributes as Record<string, unknown>)
        : null,
    valid_at: toIsoString(record.valid_at),
    invalid_at: toIsoString(record.invalid_at),
    created_at: toIsoString(record.created_at) ?? "",
  };
}

async function fetchFactRoles(
  factUuids: string[],
  groupId: string,
): Promise<Map<string, FactRoleSummary[]>> {
  const roles = new Map<string, FactRoleSummary[]>();
  if (factUuids.length === 0) {
    return roles;
  }

  const records = await queryGraph(
    `
      MATCH (f:Fact {group_id: $group_id})-[r:HAS_ROLE]->(e:Entity {group_id: $group_id})
      WHERE f.uuid IN $uuids
      RETURN f.uuid AS fact_uuid,
             e.uuid AS entity_uuid,
             e.name AS entity_name,
             r.role AS role,
             r.role_description AS role_description
    `,
    { group_id: groupId, uuids: factUuids },
  );

  for (const record of records) {
    const factUuid = String(record.fact_uuid ?? "");
    if (!factUuid) {
      continue;
    }
    const entry: FactRoleSummary = {
      entity_uuid: String(record.entity_uuid ?? ""),
      entity_name: String(record.entity_name ?? ""),
      role: String(record.role ?? ""),
      role_description:
        record.role_description === null || record.role_description === undefined
          ? null
          : String(record.role_description),
    };
    const list = roles.get(factUuid) ?? [];
    list.push(entry);
    roles.set(factUuid, list);
  }

  return roles;
}

function factInRange(
  record: Record<string, unknown>,
  start: Date | null,
  end: Date | null,
): boolean {
  if (!start && !end) {
    return true;
  }
  const candidate = toDate(record.valid_at) ?? toDate(record.created_at);
  if (!candidate) {
    return false;
  }
  if (start && candidate < start) {
    return false;
  }
  if (end && candidate > end) {
    return false;
  }
  return true;
}

function temporalStatus(validAt: Date | null, invalidAt: Date | null, now: Date): string {
  if (validAt && validAt > now) {
    return "future";
  }
  if (invalidAt && invalidAt <= now) {
    return "expired";
  }
  return "valid";
}

export function registerKnowledgeGraphRoutes(app: Hono): void {
  app.get("/kg/stats", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);

    try {
      const [entityCount, factCount, edgeCount] = await Promise.all([
        queryGraph("MATCH (n:Entity {group_id: $group_id}) RETURN count(n) as count", {
          group_id: groupId,
        }),
        queryGraph("MATCH (f:Fact {group_id: $group_id}) RETURN count(f) as count", {
          group_id: groupId,
        }),
        queryGraph("MATCH ()-[r:RELATES_TO {group_id: $group_id}]->() RETURN count(r) as count", {
          group_id: groupId,
        }),
      ]);

      const total_entities = toNumber(entityCount[0]?.count ?? 0);
      const total_facts = toNumber(factCount[0]?.count ?? 0);
      const total_edges = toNumber(edgeCount[0]?.count ?? 0);

      const topMentionedRecords = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels,
                 n.mention_count AS mention_count, n.retrieval_quality AS retrieval_quality
          ORDER BY n.mention_count DESC
          LIMIT 5
        `,
        { group_id: groupId },
      );
      const top_mentioned = topMentionedRecords.map(toEntitySummary);

      const topQualityRecords = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          WHERE n.retrieval_count > 0
          RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels,
                 n.mention_count AS mention_count, n.retrieval_quality AS retrieval_quality
          ORDER BY n.retrieval_quality DESC, n.citation_count DESC
          LIMIT 5
        `,
        { group_id: groupId },
      );
      const top_quality = topQualityRecords.map(toEntitySummary);

      const topRoleRecords = await queryGraph(
        `
          MATCH (f:Fact {group_id: $group_id})-[r:HAS_ROLE]->()
          WHERE r.role IS NOT NULL
          RETURN r.role AS role, count(*) AS count
          ORDER BY count DESC
          LIMIT 5
        `,
        { group_id: groupId },
      );
      const top_fact_roles = topRoleRecords.map((record) => ({
        role: String(record.role ?? ""),
        count: toNumber(record.count ?? 0),
      }));

      const topFactEntitiesRecords = await queryGraph(
        `
          MATCH (f:Fact {group_id: $group_id})-[r:HAS_ROLE]->(e:Entity {group_id: $group_id})
          RETURN e.uuid AS uuid, e.name AS name, labels(e) AS labels, count(*) AS count
          ORDER BY count DESC
          LIMIT 5
        `,
        { group_id: groupId },
      );
      const top_fact_entities = topFactEntitiesRecords.map((record) => ({
        uuid: String(record.uuid ?? ""),
        name: String(record.name ?? ""),
        labels: toStringArray(record.labels),
        count: toNumber(record.count ?? 0),
      }));

      const labelRecords = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          UNWIND labels(n) AS label
          RETURN label, count(*) as count
          ORDER BY count DESC
        `,
        { group_id: groupId },
      );
      const label_distribution: Record<string, number> = {};
      for (const record of labelRecords) {
        const label = String(record.label ?? "");
        if (!label) {
          continue;
        }
        label_distribution[label] = toNumber(record.count ?? 0);
      }

      const communityCount = await queryGraph(
        "MATCH (c:Community {group_id: $group_id}) RETURN count(c) as count",
        { group_id: groupId },
      );
      const total_communities = toNumber(communityCount[0]?.count ?? 0);

      return c.json({
        total_entities,
        total_facts,
        total_edges,
        total_communities,
        top_mentioned,
        top_quality,
        top_fact_roles,
        top_fact_entities,
        label_distribution,
      });
    } catch (error) {
      console.log(`[kg] stats failed: ${String(error)}`);
      return c.json({
        total_entities: 0,
        total_facts: 0,
        total_edges: 0,
        total_communities: 0,
        top_mentioned: [],
        top_quality: [],
        top_fact_roles: [],
        top_fact_entities: [],
        label_distribution: {},
      });
    }
  });

  app.get("/kg/labels", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);

    try {
      const records = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          UNWIND labels(n) AS label
          RETURN DISTINCT label
          ORDER BY label
        `,
        { group_id: groupId },
      );
      const labels = records.map((record) => String(record.label ?? "")).filter(Boolean);
      return c.json({ labels });
    } catch (error) {
      console.log(`[kg] labels failed: ${String(error)}`);
      return c.json({ labels: [] });
    }
  });

  app.get("/kg/entities", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const labels = parseLabels(url);

    const sortBy = url.searchParams.get("sort_by") ?? "mention_count";
    const sortOrder =
      (url.searchParams.get("sort_order") ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
    const limit = parseLimit(url.searchParams.get("limit"), 50);
    const offset = parseOffset(url.searchParams.get("offset"), 0);
    const allowedSorts = new Set([
      "mention_count",
      "retrieval_quality",
      "last_mentioned",
      "created_at",
      "name",
    ]);
    const sortKey = allowedSorts.has(sortBy) ? sortBy : "mention_count";

    try {
      const labelFilter =
        labels.length > 0 ? "AND ANY(label IN labels(n) WHERE label IN $labels)" : "";
      const countResult = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          WHERE true ${labelFilter}
          RETURN count(n) as total
        `,
        { group_id: groupId, labels },
      );
      const total = toNumber(countResult[0]?.total ?? 0);

      const records = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          WHERE true ${labelFilter}
          RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels, n.summary AS summary,
                 n.mention_count AS mention_count, n.retrieval_quality AS retrieval_quality,
                 n.last_mentioned AS last_mentioned, n.created_at AS created_at
          ORDER BY n.${sortKey} ${sortOrder}
          SKIP $offset
          LIMIT $limit
        `,
        { group_id: groupId, labels, offset, limit },
      );

      return c.json({
        entities: records.map(toEntitySummary),
        total,
        offset,
        limit,
      });
    } catch (error) {
      console.log(`[kg] entities failed: ${String(error)}`);
      return c.json({ entities: [], total: 0, offset, limit });
    }
  });

  app.get("/kg/search", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const query = url.searchParams.get("query") ?? "";
    const limit = parseLimit(url.searchParams.get("limit"), 20);
    const includeEdges = parseBool(url.searchParams.get("include_edges"), true);
    const includeFacts = parseBool(url.searchParams.get("include_facts"), true);
    const includeFactRoles = parseBool(url.searchParams.get("include_fact_roles"), true);
    const labels = parseLabels(url);

    if (!query.trim()) {
      return c.json({ entities: [], edges: [], facts: [], query });
    }

    try {
      if (!(await graphAvailable())) {
        return c.json({ entities: [], edges: [], facts: [], query });
      }
      const results = await searchGraph({
        query,
        groupId,
        limit,
      });

      let nodes = results.nodes;
      if (labels.length > 0) {
        nodes = nodes.filter((node) => node.labels.some((label) => labels.includes(label)));
      }

      const entities = nodes.map(toEntitySummary);
      const nameLookup = new Map(nodes.map((node) => [node.uuid, node.name]));

      let edges: EdgeSummary[] = [];
      if (includeEdges) {
        edges = results.edges.map((edge) =>
          toEdgeSummary({
            uuid: edge.uuid,
            source_uuid: edge.source_node_uuid,
            source_name: nameLookup.get(edge.source_node_uuid) ?? "",
            target_uuid: edge.target_node_uuid,
            target_name: nameLookup.get(edge.target_node_uuid) ?? "",
            relation: edge.name,
            fact: edge.fact,
            strength: edge.strength,
            valid_at: edge.valid_at,
            invalid_at: edge.invalid_at,
            created_at: edge.created_at,
          }),
        );
      }

      let facts: FactSummary[] = [];
      if (includeFacts) {
        const rolesLookup = includeFactRoles
          ? await fetchFactRoles(
              results.facts.map((fact) => fact.uuid),
              groupId,
            )
          : new Map<string, FactRoleSummary[]>();
        facts = results.facts.map((fact) =>
          toFactSummary(
            {
              uuid: fact.uuid,
              fact: fact.fact,
              attributes: fact.attributes,
              valid_at: fact.valid_at,
              invalid_at: fact.invalid_at,
              created_at: fact.created_at,
            },
            rolesLookup.get(fact.uuid) ?? [],
          ),
        );
      }

      return c.json({ entities, edges, facts, query });
    } catch (error) {
      console.log(`[kg] search failed: ${String(error)}`);
      return c.json({ entities: [], edges: [], facts: [], query });
    }
  });

  app.get("/kg/facts/search", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const query = url.searchParams.get("query") ?? "";
    const limit = parseLimit(url.searchParams.get("limit"), 20);
    const includeRoles = parseBool(url.searchParams.get("include_roles"), true);
    const includeExpired = parseBool(url.searchParams.get("include_expired"), false);
    const archivalOnly = parseBool(url.searchParams.get("archival_only"), false);
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    try {
      if (!(await graphAvailable())) {
        return c.json({ facts: [], query });
      }
      const fetchLimit = start || end ? Math.max(limit * 3, limit) : limit;
      const filters: SearchFilters | null = archivalOnly
        ? { node_attributes: { archival: true } }
        : null;

      const results = await hybridFactSearch({
        query,
        groupId,
        limit: fetchLimit,
        filters,
        includeExpired,
      });

      const rolesLookup = includeRoles
        ? await fetchFactRoles(
            results.map((fact) => fact.uuid),
            groupId,
          )
        : new Map<string, FactRoleSummary[]>();

      const facts: FactSummary[] = [];
      for (const fact of results) {
        if (
          !factInRange(
            {
              valid_at: fact.valid_at,
              invalid_at: fact.invalid_at,
              created_at: fact.created_at,
            },
            start,
            end,
          )
        ) {
          continue;
        }
        facts.push(
          toFactSummary(
            {
              uuid: fact.uuid,
              fact: fact.fact,
              attributes: fact.attributes,
              valid_at: fact.valid_at,
              invalid_at: fact.invalid_at,
              created_at: fact.created_at,
            },
            rolesLookup.get(fact.uuid) ?? [],
          ),
        );
        if (facts.length >= limit) {
          break;
        }
      }

      return c.json({ facts, query });
    } catch (error) {
      console.log(`[kg] facts search failed: ${String(error)}`);
      return c.json({ facts: [], query });
    }
  });

  app.post("/kg/facts/archival", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);

    if (!(await graphAvailable())) {
      return c.json({ error: "dere_graph not available" }, 503);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const factText = typeof payload.fact === "string" ? payload.fact.trim() : "";
    if (!factText) {
      return c.json({ error: "Fact text cannot be empty" }, 400);
    }

    const source = typeof payload.source === "string" ? payload.source.trim() : null;
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : null;
    const validAt = payload.valid_at ? new Date(String(payload.valid_at)) : null;
    const invalidAt = payload.invalid_at ? new Date(String(payload.invalid_at)) : null;

    try {
      const existing = await queryGraph(
        `
          MATCH (f:Fact {group_id: $group_id})
          WHERE f.fact = $fact
          RETURN f.uuid AS uuid,
                 f.fact AS fact,
                 f.attributes AS attributes,
                 f.valid_at AS valid_at,
                 f.invalid_at AS invalid_at,
                 f.created_at AS created_at
          LIMIT 1
        `,
        { group_id: groupId, fact: factText },
      );

      if (existing.length > 0) {
        const roles = await fetchFactRoles(
          [String(existing[0].uuid ?? "")].filter(Boolean),
          groupId,
        );
        return c.json({
          created: false,
          fact: toFactSummary(existing[0], roles.get(String(existing[0].uuid ?? "")) ?? []),
        });
      }

      const now = new Date();
      const uuid = crypto.randomUUID();
      const attributes: Record<string, unknown> = { archival: true };
      if (source) {
        attributes.sources = [source];
      }
      if (tags && tags.length > 0) {
        attributes.tags = tags;
      }

      await queryGraph(
        `
          CREATE (f:Fact {
            uuid: $uuid,
            name: $name,
            fact: $fact,
            group_id: $group_id,
            attributes: $attributes,
            valid_at: $valid_at,
            invalid_at: $invalid_at,
            created_at: $created_at,
            episodes: []
          })
        `,
        {
          uuid,
          name: factText,
          fact: factText,
          group_id: groupId,
          attributes,
          valid_at: validAt ?? null,
          invalid_at: invalidAt ?? null,
          created_at: now,
        },
      );

      const summary: FactSummary = {
        uuid,
        fact: factText,
        roles: [],
        attributes,
        valid_at: validAt ? validAt.toISOString() : null,
        invalid_at: invalidAt ? invalidAt.toISOString() : null,
        created_at: now.toISOString(),
      };

      return c.json({ created: true, fact: summary });
    } catch (error) {
      console.log(`[kg] archival insert failed: ${String(error)}`);
      return c.json({ error: "Failed to insert fact" }, 500);
    }
  });

  app.get("/kg/facts/at_time", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const timestampParam = url.searchParams.get("timestamp");
    const limit = parseLimit(url.searchParams.get("limit"), 100);
    const includeRoles = parseBool(url.searchParams.get("include_roles"), true);

    if (!timestampParam) {
      return c.json({ facts: [], query: "" }, 400);
    }

    const timestamp = new Date(timestampParam);
    if (Number.isNaN(timestamp.getTime())) {
      return c.json({ facts: [], query: "" }, 400);
    }

    try {
      const records = await queryGraph(
        `
          MATCH (f:Fact {group_id: $group_id})
          WHERE (f.valid_at IS NULL OR f.valid_at <= $timestamp)
            AND (f.invalid_at IS NULL OR f.invalid_at > $timestamp)
          RETURN f.uuid AS uuid,
                 f.fact AS fact,
                 f.attributes AS attributes,
                 f.valid_at AS valid_at,
                 f.invalid_at AS invalid_at,
                 f.created_at AS created_at
          ORDER BY f.valid_at DESC
          LIMIT $limit
        `,
        { group_id: groupId, timestamp, limit },
      );

      const rolesLookup = includeRoles
        ? await fetchFactRoles(
            records.map((record) => String(record.uuid ?? "")).filter(Boolean),
            groupId,
          )
        : new Map<string, FactRoleSummary[]>();

      const facts = records.map((record) =>
        toFactSummary(record, rolesLookup.get(String(record.uuid ?? "")) ?? []),
      );
      return c.json({ facts, query: "" });
    } catch (error) {
      console.log(`[kg] facts at_time failed: ${String(error)}`);
      return c.json({ facts: [], query: "" });
    }
  });

  app.get("/kg/facts/timeline", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const entityUuid = url.searchParams.get("entity_uuid");
    const includeFacts = parseBool(url.searchParams.get("include_facts"), true);
    const includeFactRoles = parseBool(url.searchParams.get("include_fact_roles"), true);
    const limit = parseLimit(url.searchParams.get("limit"), 100);
    const offset = parseOffset(url.searchParams.get("offset"), 0);

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    const now = new Date();

    try {
      const timeline: Array<{ timestamp: number; entry: Record<string, unknown> }> = [];

      const edgeFilters: string[] = ["r.group_id = $group_id"];
      if (entityUuid) {
        edgeFilters.push(
          "(r.source_node_uuid = $entity_uuid OR r.target_node_uuid = $entity_uuid)",
        );
      }
      const edgeWhere = edgeFilters.join(" AND ");
      const edgeFetchLimit = start || end ? Math.max(limit * 3, limit) : limit;

      const edgeRecords = await queryGraph(
        `
          MATCH (s:Entity {group_id: $group_id})-[r:RELATES_TO]->(t:Entity {group_id: $group_id})
          WHERE ${edgeWhere}
          RETURN r.uuid AS uuid,
                 r.source_node_uuid AS source_uuid,
                 r.target_node_uuid AS target_uuid,
                 r.name AS relation,
                 r.fact AS fact,
                 r.strength AS strength,
                 r.valid_at AS valid_at,
                 r.invalid_at AS invalid_at,
                 r.created_at AS created_at,
                 s.name AS source_name,
                 t.name AS target_name
          ORDER BY r.created_at DESC
          LIMIT $limit
        `,
        { group_id: groupId, entity_uuid: entityUuid ?? null, limit: edgeFetchLimit },
      );

      for (const record of edgeRecords) {
        if (!factInRange(record, start, end)) {
          continue;
        }
        const validAt = toDate(record.valid_at);
        const invalidAt = toDate(record.invalid_at);
        const createdAt = toDate(record.created_at);
        const eventTime = validAt ?? createdAt;
        if (!eventTime) {
          continue;
        }
        timeline.push({
          timestamp: eventTime.getTime(),
          entry: {
            kind: "edge",
            edge: toEdgeSummary(record),
            temporal_status: temporalStatus(validAt, invalidAt, now),
          },
        });
      }

      if (includeFacts) {
        const factFilters: string[] = ["f.group_id = $group_id"];
        if (entityUuid) {
          factFilters.push(
            `EXISTS { MATCH (f)-[r:HAS_ROLE]->(e:Entity {group_id: $group_id, uuid: $entity_uuid}) }`,
          );
        }
        const factWhere = factFilters.join(" AND ");
        const factFetchLimit = start || end ? Math.max(limit * 3, limit) : limit;

        const factRecords = await queryGraph(
          `
            MATCH (f:Fact {group_id: $group_id})
            WHERE ${factWhere}
            RETURN f.uuid AS uuid,
                   f.fact AS fact,
                   f.attributes AS attributes,
                   f.valid_at AS valid_at,
                   f.invalid_at AS invalid_at,
                   f.created_at AS created_at
            ORDER BY f.created_at DESC
            LIMIT $limit
          `,
          { group_id: groupId, entity_uuid: entityUuid ?? null, limit: factFetchLimit },
        );

        const rolesLookup = includeFactRoles
          ? await fetchFactRoles(
              factRecords.map((record) => String(record.uuid ?? "")).filter(Boolean),
              groupId,
            )
          : new Map<string, FactRoleSummary[]>();

        for (const record of factRecords) {
          if (!factInRange(record, start, end)) {
            continue;
          }
          const validAt = toDate(record.valid_at);
          const invalidAt = toDate(record.invalid_at);
          const createdAt = toDate(record.created_at);
          const eventTime = validAt ?? createdAt;
          if (!eventTime) {
            continue;
          }
          timeline.push({
            timestamp: eventTime.getTime(),
            entry: {
              kind: "fact",
              fact: toFactSummary(record, rolesLookup.get(String(record.uuid ?? "")) ?? []),
              temporal_status: temporalStatus(validAt, invalidAt, now),
            },
          });
        }
      }

      timeline.sort((a, b) => b.timestamp - a.timestamp);
      const page = timeline.slice(offset, offset + limit);
      return c.json({ facts: page.map((item) => item.entry), total: timeline.length, offset });
    } catch (error) {
      console.log(`[kg] timeline failed: ${String(error)}`);
      return c.json({ facts: [], total: 0, offset });
    }
  });

  app.get("/kg/communities", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const limit = parseLimit(url.searchParams.get("limit"), 20);

    try {
      const records = await queryGraph(
        `
          MATCH (c:Community {group_id: $group_id})
          OPTIONAL MATCH (c)-[:HAS_MEMBER]->(e:Entity)
          RETURN c.name as name, c.summary as summary, count(e) as member_count
          ORDER BY member_count DESC
          LIMIT $limit
        `,
        { group_id: groupId, limit },
      );

      const communities = records.map((record) => ({
        name: String(record.name ?? ""),
        summary: String(record.summary ?? ""),
        member_count: toNumber(record.member_count ?? 0),
      }));

      return c.json({ communities });
    } catch (error) {
      console.log(`[kg] communities failed: ${String(error)}`);
      return c.json({ communities: [] });
    }
  });

  app.get("/kg/entity/:entity_name", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const entityName = c.req.param("entity_name");
    if (!entityName) {
      return c.json({ error: "Entity name required" }, 400);
    }

    if (!(await graphAvailable())) {
      return c.json({ error: "Knowledge graph not available" }, 503);
    }

    try {
      const records = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          WHERE toLower(n.name) CONTAINS $q
          RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels, n.created_at AS created_at
          ORDER BY n.mention_count DESC
          LIMIT 10
        `,
        { group_id: groupId, q: entityName.toLowerCase() },
      );

      if (records.length === 0) {
        return c.json({ entity: entityName, found: false, nodes: [], edges: [] });
      }

      const primary = records[0];
      const primaryUuid = String(primary.uuid ?? "");

      const relatedNodes = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id, uuid: $uuid})-[r:RELATES_TO]-(m:Entity {group_id: $group_id})
          RETURN DISTINCT m.uuid AS uuid, m.name AS name, labels(m) AS labels
          LIMIT 20
        `,
        { group_id: groupId, uuid: primaryUuid },
      );

      const relatedEdges = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id, uuid: $uuid})-[r:RELATES_TO]-(m:Entity {group_id: $group_id})
          RETURN r.uuid AS uuid,
                 r.fact AS fact,
                 r.source_node_uuid AS source,
                 r.target_node_uuid AS target,
                 r.created_at AS created_at
          LIMIT 20
        `,
        { group_id: groupId, uuid: primaryUuid },
      );

      return c.json({
        entity: entityName,
        found: true,
        primary_node: {
          uuid: primaryUuid,
          name: String(primary.name ?? ""),
          labels: toStringArray(primary.labels),
          created_at: toIsoString(primary.created_at),
        },
        related_nodes: relatedNodes
          .filter((node) => String(node.uuid ?? "") !== primaryUuid)
          .map((node) => ({
            uuid: String(node.uuid ?? ""),
            name: String(node.name ?? ""),
            labels: toStringArray(node.labels),
          })),
        relationships: relatedEdges.map((edge) => ({
          uuid: String(edge.uuid ?? ""),
          fact: String(edge.fact ?? ""),
          source: String(edge.source ?? ""),
          target: String(edge.target ?? ""),
          created_at: toIsoString(edge.created_at),
        })),
      });
    } catch (error) {
      console.log(`[kg] entity lookup failed: ${String(error)}`);
      return c.json({ error: String(error) }, 500);
    }
  });

  app.get("/kg/entity/:entity_name/related", async (c) => {
    const url = new URL(c.req.url);
    const groupId = getGroupId(url);
    const entityName = c.req.param("entity_name");
    const limit = parseLimit(url.searchParams.get("limit"), 20);

    if (!entityName) {
      return c.json({ error: "Entity name required" }, 400);
    }

    if (!(await graphAvailable())) {
      return c.json({ error: "Knowledge graph not available" }, 503);
    }

    try {
      const records = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id})
          WHERE toLower(n.name) CONTAINS $q
          RETURN n.uuid AS uuid, n.name AS name, labels(n) AS labels
          ORDER BY n.mention_count DESC
          LIMIT 1
        `,
        { group_id: groupId, q: entityName.toLowerCase() },
      );

      if (records.length === 0) {
        return c.json({ entity: entityName, found: false, related: [] });
      }

      const primaryUuid = String(records[0].uuid ?? "");
      const relatedNodes = await queryGraph(
        `
          MATCH (n:Entity {group_id: $group_id, uuid: $uuid})-[:RELATES_TO*1..2]-(m:Entity {group_id: $group_id})
          RETURN DISTINCT m.uuid AS uuid, m.name AS name, labels(m) AS labels
          LIMIT $limit
        `,
        { group_id: groupId, uuid: primaryUuid, limit },
      );

      return c.json({
        entity: entityName,
        found: true,
        related: relatedNodes
          .filter((node) => String(node.uuid ?? "") !== primaryUuid)
          .map((node) => ({
            uuid: String(node.uuid ?? ""),
            name: String(node.name ?? ""),
            labels: toStringArray(node.labels),
          })),
      });
    } catch (error) {
      console.log(`[kg] related entities failed: ${String(error)}`);
      return c.json({ error: String(error) }, 500);
    }
  });
}
