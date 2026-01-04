import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  graphAvailable,
  queryGraph,
  toDate,
  toIsoString,
  toNumber,
  toStringArray,
  hybridFactSearch,
  searchGraph,
  type SearchFilters,
} from "@dere/graph";
import { router, publicProcedure } from "../init.js";
import { log } from "../../logger.js";

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
    if (!factUuid) continue;
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
  if (!start && !end) return true;
  const candidate = toDate(record.valid_at) ?? toDate(record.created_at);
  if (!candidate) return false;
  if (start && candidate < start) return false;
  if (end && candidate > end) return false;
  return true;
}

function temporalStatus(validAt: Date | null, invalidAt: Date | null, now: Date): string {
  if (validAt && validAt > now) return "future";
  if (invalidAt && invalidAt <= now) return "expired";
  return "valid";
}

export const knowledgeGraphRouter = router({
  stats: publicProcedure
    .input(z.object({ user_id: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const groupId = input?.user_id ?? "default";

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
          if (!label) continue;
          label_distribution[label] = toNumber(record.count ?? 0);
        }

        const communityCount = await queryGraph(
          "MATCH (c:Community {group_id: $group_id}) RETURN count(c) as count",
          { group_id: groupId },
        );
        const total_communities = toNumber(communityCount[0]?.count ?? 0);

        return {
          total_entities,
          total_facts,
          total_edges,
          total_communities,
          top_mentioned,
          top_quality,
          top_fact_roles,
          top_fact_entities,
          label_distribution,
        };
      } catch (error) {
        log.kg.warn("Stats query failed", { error: String(error) });
        return {
          total_entities: 0,
          total_facts: 0,
          total_edges: 0,
          total_communities: 0,
          top_mentioned: [],
          top_quality: [],
          top_fact_roles: [],
          top_fact_entities: [],
          label_distribution: {},
        };
      }
    }),

  labels: publicProcedure
    .input(z.object({ user_id: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const groupId = input?.user_id ?? "default";

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
        return { labels };
      } catch (error) {
        log.kg.warn("Labels query failed", { error: String(error) });
        return { labels: [] };
      }
    }),

  entities: publicProcedure
    .input(
      z.object({
        user_id: z.string().optional(),
        labels: z.array(z.string()).optional(),
        sort_by: z.string().optional(),
        sort_order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const groupId = input?.user_id ?? "default";
      const labels = input?.labels ?? [];
      const sortOrder = (input?.sort_order ?? "desc").toUpperCase();
      const limit = Math.max(1, input?.limit ?? 50);
      const offset = Math.max(0, input?.offset ?? 0);
      const allowedSorts = new Set([
        "mention_count",
        "retrieval_quality",
        "last_mentioned",
        "created_at",
        "name",
      ]);
      const sortKey = allowedSorts.has(input?.sort_by ?? "") ? input?.sort_by : "mention_count";

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

        return {
          entities: records.map(toEntitySummary),
          total,
          offset,
          limit,
        };
      } catch (error) {
        log.kg.warn("Entities query failed", { error: String(error) });
        return { entities: [], total: 0, offset, limit };
      }
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string(),
        user_id: z.string().optional(),
        limit: z.number().optional(),
        include_edges: z.boolean().optional(),
        include_facts: z.boolean().optional(),
        include_fact_roles: z.boolean().optional(),
        labels: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input }) => {
      const groupId = input.user_id ?? "default";
      const limit = Math.max(1, input.limit ?? 20);
      const includeEdges = input.include_edges ?? true;
      const includeFacts = input.include_facts ?? true;
      const includeFactRoles = input.include_fact_roles ?? true;
      const labels = input.labels ?? [];

      if (!input.query.trim()) {
        return { entities: [], edges: [], facts: [], query: input.query };
      }

      try {
        if (!(await graphAvailable())) {
          return { entities: [], edges: [], facts: [], query: input.query };
        }
        const results = await searchGraph({
          query: input.query,
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

        return { entities, edges, facts, query: input.query };
      } catch (error) {
        log.kg.warn("Search failed", { error: String(error) });
        return { entities: [], edges: [], facts: [], query: input.query };
      }
    }),

  factsSearch: publicProcedure
    .input(
      z.object({
        query: z.string(),
        user_id: z.string().optional(),
        limit: z.number().optional(),
        include_roles: z.boolean().optional(),
        include_expired: z.boolean().optional(),
        archival_only: z.boolean().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const groupId = input.user_id ?? "default";
      const limit = Math.max(1, input.limit ?? 20);
      const includeRoles = input.include_roles ?? true;
      const includeExpired = input.include_expired ?? false;
      const archivalOnly = input.archival_only ?? false;
      const start = input.start_date ? new Date(input.start_date) : null;
      const end = input.end_date ? new Date(input.end_date) : null;

      try {
        if (!(await graphAvailable())) {
          return { facts: [], query: input.query };
        }
        const fetchLimit = start || end ? Math.max(limit * 3, limit) : limit;
        const filters: SearchFilters | null = archivalOnly
          ? { node_attributes: { archival: true } }
          : null;

        const results = await hybridFactSearch({
          query: input.query,
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
          if (facts.length >= limit) break;
        }

        return { facts, query: input.query };
      } catch (error) {
        log.kg.warn("Facts search failed", { error: String(error) });
        return { facts: [], query: input.query };
      }
    }),

  factsArchival: publicProcedure
    .input(
      z.object({
        fact: z.string().min(1),
        user_id: z.string().optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
        valid_at: z.string().optional(),
        invalid_at: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const groupId = input.user_id ?? "default";

      if (!(await graphAvailable())) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "dere_graph not available" });
      }

      const factText = input.fact.trim();
      const source = input.source?.trim() ?? null;
      const tags = input.tags?.filter(Boolean) ?? null;
      const validAt = input.valid_at ? new Date(input.valid_at) : null;
      const invalidAt = input.invalid_at ? new Date(input.invalid_at) : null;

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

        const existingRecord = existing[0];
        if (existingRecord) {
          const roles = await fetchFactRoles(
            [String(existingRecord.uuid ?? "")].filter(Boolean),
            groupId,
          );
          return {
            created: false,
            fact: toFactSummary(existingRecord, roles.get(String(existingRecord.uuid ?? "")) ?? []),
          };
        }

        const now = new Date();
        const uuid = crypto.randomUUID();
        const attributes: Record<string, unknown> = { archival: true };
        if (source) attributes.sources = [source];
        if (tags && tags.length > 0) attributes.tags = tags;

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

        return { created: true, fact: summary };
      } catch (error) {
        log.kg.warn("Archival insert failed", { error: String(error) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to insert fact" });
      }
    }),

  factsAtTime: publicProcedure
    .input(
      z.object({
        timestamp: z.string(),
        user_id: z.string().optional(),
        limit: z.number().optional(),
        include_roles: z.boolean().optional(),
      }),
    )
    .query(async ({ input }) => {
      const groupId = input.user_id ?? "default";
      const limit = Math.max(1, input.limit ?? 100);
      const includeRoles = input.include_roles ?? true;
      const timestamp = new Date(input.timestamp);

      if (Number.isNaN(timestamp.getTime())) {
        return { facts: [], query: "" };
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
        return { facts, query: "" };
      } catch (error) {
        log.kg.warn("Facts at_time query failed", { error: String(error) });
        return { facts: [], query: "" };
      }
    }),

  factsTimeline: publicProcedure
    .input(
      z.object({
        user_id: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        entity_uuid: z.string().optional(),
        include_facts: z.boolean().optional(),
        include_fact_roles: z.boolean().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const groupId = input?.user_id ?? "default";
      const start = input?.start_date ? new Date(input.start_date) : null;
      const end = input?.end_date ? new Date(input.end_date) : null;
      const entityUuid = input?.entity_uuid ?? null;
      const includeFacts = input?.include_facts ?? true;
      const includeFactRoles = input?.include_fact_roles ?? true;
      const limit = Math.max(1, input?.limit ?? 100);
      const offset = Math.max(0, input?.offset ?? 0);
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
          if (!factInRange(record, start, end)) continue;
          const validAt = toDate(record.valid_at);
          const invalidAt = toDate(record.invalid_at);
          const createdAt = toDate(record.created_at);
          const eventTime = validAt ?? createdAt;
          if (!eventTime) continue;
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
            if (!factInRange(record, start, end)) continue;
            const validAt = toDate(record.valid_at);
            const invalidAt = toDate(record.invalid_at);
            const createdAt = toDate(record.created_at);
            const eventTime = validAt ?? createdAt;
            if (!eventTime) continue;
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
        return { facts: page.map((item) => item.entry), total: timeline.length, offset };
      } catch (error) {
        log.kg.warn("Timeline query failed", { error: String(error) });
        return { facts: [], total: 0, offset };
      }
    }),

  communities: publicProcedure
    .input(z.object({ user_id: z.string().optional(), limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const groupId = input?.user_id ?? "default";
      const limit = Math.max(1, input?.limit ?? 20);

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

        return { communities };
      } catch (error) {
        log.kg.warn("Communities query failed", { error: String(error) });
        return { communities: [] };
      }
    }),

  entity: publicProcedure
    .input(z.object({ entity_name: z.string(), user_id: z.string().optional() }))
    .query(async ({ input }) => {
      const groupId = input.user_id ?? "default";

      if (!(await graphAvailable())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Knowledge graph not available",
        });
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
          { group_id: groupId, q: input.entity_name.toLowerCase() },
        );

        if (records.length === 0) {
          return { entity: input.entity_name, found: false, nodes: [], edges: [] };
        }

        const primary = records[0];
        if (!primary) {
          return { entity: input.entity_name, found: false, nodes: [], edges: [] };
        }
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

        return {
          entity: input.entity_name,
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
        };
      } catch (error) {
        log.kg.warn("Entity lookup failed", { error: String(error) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(error) });
      }
    }),

  entityRelated: publicProcedure
    .input(
      z.object({
        entity_name: z.string(),
        user_id: z.string().optional(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const groupId = input.user_id ?? "default";
      const limit = Math.max(1, input.limit ?? 20);

      if (!(await graphAvailable())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Knowledge graph not available",
        });
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
          { group_id: groupId, q: input.entity_name.toLowerCase() },
        );

        if (records.length === 0) {
          return { entity: input.entity_name, found: false, related: [] };
        }

        const primary = records[0];
        if (!primary) {
          return { entity: input.entity_name, found: false, related: [] };
        }
        const primaryUuid = String(primary.uuid ?? "");
        const relatedNodes = await queryGraph(
          `
            MATCH (n:Entity {group_id: $group_id, uuid: $uuid})-[:RELATES_TO*1..2]-(m:Entity {group_id: $group_id})
            RETURN DISTINCT m.uuid AS uuid, m.name AS name, labels(m) AS labels
            LIMIT $limit
          `,
          { group_id: groupId, uuid: primaryUuid, limit },
        );

        return {
          entity: input.entity_name,
          found: true,
          related: relatedNodes
            .filter((node) => String(node.uuid ?? "") !== primaryUuid)
            .map((node) => ({
              uuid: String(node.uuid ?? ""),
              name: String(node.name ?? ""),
              labels: toStringArray(node.labels),
            })),
        };
      } catch (error) {
        log.kg.warn("Related entities query failed", { error: String(error) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(error) });
      }
    }),
});
