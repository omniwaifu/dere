import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { daemonRequest } from "@dere/shared-runtime";

type JsonRecord = Record<string, unknown>;

const server = new McpServer({
  name: "Knowledge Graph",
  version: "1.0.0",
});

const SESSION_ID = process.env.DERE_SESSION_ID;

function getSessionId(): number | null {
  if (!SESSION_ID) {
    return null;
  }
  const parsed = Number.parseInt(SESSION_ID, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function requestJson<T>(args: {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const { status, data, text } = await daemonRequest<T>({
    path: args.path,
    method: args.method,
    query: args.query,
    body: args.body,
    timeoutMs: args.timeoutMs,
  });

  if (status < 200 || status >= 300) {
    throw new Error(`Daemon request failed (${status}): ${text}`);
  }

  return (data ?? null) as T;
}

function formatEntity(entity: Record<string, any>): string {
  const labels = Array.isArray(entity.labels) ? entity.labels.join(", ") : "";
  const summary = entity.summary ?? "";
  const mentions = entity.mention_count ?? 0;
  const parts: string[] = [`**${entity.name}**`];
  if (labels) {
    parts.push(`[${labels}]`);
  }
  if (summary) {
    parts.push(`: ${summary}`);
  }
  if (mentions > 1) {
    parts.push(` (mentioned ${mentions}x)`);
  }
  return parts.join("");
}

function formatFact(fact: Record<string, any>): string {
  const factText = fact.fact ?? "";
  const roles = Array.isArray(fact.roles) ? fact.roles : [];
  if (roles.length) {
    const roleParts = roles.map(
      (role) => `${role.entity_name ?? "unknown"} (${role.role ?? "role"})`,
    );
    return `${factText} [involves: ${roleParts.join(", ")}]`;
  }
  return factText;
}

function formatEdge(edge: Record<string, any>): string {
  const source = edge.source_name ?? "?";
  const target = edge.target_name ?? "?";
  const relation = edge.relation ?? "relates to";
  const fact = edge.fact ?? "";
  if (fact) {
    return `${source} --[${relation}]--> ${target}: ${fact}`;
  }
  return `${source} --[${relation}]--> ${target}`;
}

const SearchKnowledgeSchema = z.object({
  query: z.string(),
  limit: z.number().int().optional().default(10),
  include_facts: z.boolean().optional().default(true),
  include_relationships: z.boolean().optional().default(true),
  labels: z.array(z.string()).optional(),
});

server.registerTool(
  "search_knowledge",
  {
    description:
      "Search the knowledge graph for entities, facts, and relationships. Use to recall info or explore connections.",
    inputSchema: SearchKnowledgeSchema.shape,
  },
  async (args) => {
    const parsed = SearchKnowledgeSchema.parse(args);
    const params: JsonRecord = {
      query: parsed.query,
      limit: parsed.limit,
      include_edges: parsed.include_relationships,
      include_facts: parsed.include_facts,
      include_fact_roles: true,
    };
    if (parsed.labels) {
      params.labels = parsed.labels;
    }

    const data = await requestJson<JsonRecord>({
      path: "/kg/search",
      method: "GET",
      query: params as Record<string, any>,
    });

    const entities = Array.isArray(data.entities) ? data.entities : [];
    const facts = Array.isArray(data.facts) ? data.facts : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];

    if (!entities.length && !facts.length && !edges.length) {
      return { content: [{ type: "text", text: `No results found for '${parsed.query}'` }] };
    }

    const parts: string[] = [`## Knowledge Graph Results for '${parsed.query}'\n`];

    if (entities.length) {
      parts.push(`### Entities (${entities.length})`);
      for (const entity of entities) {
        parts.push(`- ${formatEntity(entity as Record<string, any>)}`);
      }
      parts.push("");
    }

    if (facts.length) {
      parts.push(`### Facts (${facts.length})`);
      for (const fact of facts) {
        parts.push(`- ${formatFact(fact as Record<string, any>)}`);
      }
      parts.push("");
    }

    if (edges.length) {
      parts.push(`### Relationships (${edges.length})`);
      for (const edge of edges) {
        parts.push(`- ${formatEdge(edge as Record<string, any>)}`);
      }
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

const SearchFactsSchema = z.object({
  query: z.string(),
  limit: z.number().int().optional().default(20),
});

server.registerTool(
  "search_facts",
  {
    description: "Search for specific facts in the knowledge graph.",
    inputSchema: SearchFactsSchema.shape,
  },
  async (args) => {
    const parsed = SearchFactsSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: "/kg/facts/search",
      method: "GET",
      query: {
        query: parsed.query,
        limit: parsed.limit,
        include_roles: true,
      },
    });

    const facts = Array.isArray(data.facts) ? data.facts : [];
    if (!facts.length) {
      return { content: [{ type: "text", text: `No facts found matching '${parsed.query}'` }] };
    }

    const parts = [`## Facts matching '${parsed.query}'\n`];
    for (const fact of facts) {
      parts.push(`- ${formatFact(fact as Record<string, any>)}`);
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

const ArchivalInsertSchema = z.object({
  fact: z.string(),
  source: z.string().optional(),
  valid_from: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

server.registerTool(
  "archival_memory_insert",
  {
    description: "Insert a long-term fact into archival memory.",
    inputSchema: ArchivalInsertSchema.shape,
  },
  async (args) => {
    const parsed = ArchivalInsertSchema.parse(args);
    const payload: JsonRecord = { fact: parsed.fact };
    if (parsed.source) {
      payload.source = parsed.source;
    }
    if (parsed.valid_from) {
      payload.valid_at = parsed.valid_from;
    }
    if (parsed.tags) {
      payload.tags = parsed.tags;
    }

    const data = await requestJson<JsonRecord>({
      path: "/kg/facts/archival",
      method: "POST",
      body: payload,
    });

    const created = Boolean(data.created);
    const factData = (data.fact as Record<string, any>) ?? {};
    const factText = factData.fact ?? parsed.fact;
    const status = created ? "Stored" : "Updated";

    return { content: [{ type: "text", text: `${status} archival fact: ${factText}` }] };
  },
);

const ArchivalSearchSchema = z.object({
  query: z.string(),
  limit: z.number().int().optional().default(20),
  include_expired: z.boolean().optional().default(false),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

server.registerTool(
  "archival_memory_search",
  {
    description: "Search archival memory facts.",
    inputSchema: ArchivalSearchSchema.shape,
  },
  async (args) => {
    const parsed = ArchivalSearchSchema.parse(args);
    const params: JsonRecord = {
      query: parsed.query,
      limit: parsed.limit,
      include_roles: true,
      include_expired: parsed.include_expired,
      archival_only: true,
    };
    if (parsed.start_date) {
      params.start_date = parsed.start_date;
    }
    if (parsed.end_date) {
      params.end_date = parsed.end_date;
    }

    const data = await requestJson<JsonRecord>({
      path: "/kg/facts/search",
      method: "GET",
      query: params as Record<string, any>,
    });

    const facts = Array.isArray(data.facts) ? data.facts : [];
    if (!facts.length) {
      return {
        content: [{ type: "text", text: `No archival facts found matching '${parsed.query}'` }],
      };
    }

    const parts = [`## Archival Facts matching '${parsed.query}'\n`];
    for (const fact of facts) {
      parts.push(`- ${formatFact(fact as Record<string, any>)}`);
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

const RecallSearchSchema = z.object({
  query: z.string(),
  days_back: z.number().int().optional(),
  session_filter: z.number().int().optional(),
  limit: z.number().int().optional().default(10),
});

server.registerTool(
  "recall_search",
  {
    description: "Search past conversation turns and exploration findings with hybrid recall.",
    inputSchema: RecallSearchSchema.shape,
  },
  async (args) => {
    const parsed = RecallSearchSchema.parse(args);
    const params: JsonRecord = { query: parsed.query, limit: parsed.limit };
    if (parsed.days_back !== undefined) {
      params.days_back = parsed.days_back;
    }
    if (parsed.session_filter !== undefined) {
      params.session_id = parsed.session_filter;
    }

    const data = await requestJson<JsonRecord>({
      path: "/recall/search",
      method: "GET",
      query: params as Record<string, any>,
    });

    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      return { content: [{ type: "text", text: `No recall results found for '${parsed.query}'` }] };
    }

    const sessionId = getSessionId() ?? parsed.session_filter ?? null;
    const surfaced: Array<{ finding_id: number; session_id: number | null }> = [];

    for (const item of results) {
      if (item?.result_type !== "exploration_finding") {
        continue;
      }
      const findingId = item.finding_id;
      if (typeof findingId !== "number") {
        continue;
      }
      surfaced.push({ finding_id: findingId, session_id: sessionId });
    }

    if (surfaced.length) {
      for (const payload of surfaced) {
        await requestJson<JsonRecord>({
          path: "/recall/findings/surface",
          method: "POST",
          body: payload,
        });
      }
    }

    const parts: string[] = [`## Recall Results for '${parsed.query}'\n`];
    for (const item of results) {
      const ts = typeof item.timestamp === "number" ? item.timestamp : 0;
      const role = item.message_type ?? "unknown";
      const text = item.text ?? "";
      const when = ts ? new Date(ts * 1000).toISOString() : "unknown time";
      parts.push(`- [${when}] ${role}: ${text}`);
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

const CoreMemoryEditSchema = z.object({
  block_type: z.string(),
  new_content: z.string(),
  reason: z.string().optional(),
  scope: z.string().optional().default("user"),
  session_id: z.number().int().optional(),
  char_limit: z.number().int().optional(),
});

server.registerTool(
  "core_memory_edit",
  {
    description: "Create or update a core memory block (persona/human/task).",
    inputSchema: CoreMemoryEditSchema.shape,
  },
  async (args) => {
    const parsed = CoreMemoryEditSchema.parse(args);
    const payload: JsonRecord = {
      block_type: parsed.block_type,
      content: parsed.new_content,
      reason: parsed.reason ?? null,
      scope: parsed.scope,
    };

    const resolvedSessionId = parsed.session_id ?? getSessionId();
    if (resolvedSessionId !== null) {
      payload.session_id = resolvedSessionId;
    }
    if (parsed.char_limit !== undefined) {
      payload.char_limit = parsed.char_limit;
    }

    const data = await requestJson<JsonRecord>({
      path: "/memory/core/edit",
      method: "POST",
      body: payload,
    });

    const block = (data.block as Record<string, any>) ?? {};
    const version = block.version ?? 0;
    const scopeName = block.scope ?? parsed.scope;
    const blockType = block.block_type ?? parsed.block_type;

    return {
      content: [
        { type: "text", text: `Core memory updated (${scopeName}, v${version}): ${blockType}` },
      ],
    };
  },
);

const CoreMemoryHistorySchema = z.object({
  block_type: z.string(),
  limit: z.number().int().optional().default(20),
  scope: z.string().optional().default("user"),
  session_id: z.number().int().optional(),
});

server.registerTool(
  "core_memory_history",
  {
    description: "Fetch core memory block history (most recent first).",
    inputSchema: CoreMemoryHistorySchema.shape,
  },
  async (args) => {
    const parsed = CoreMemoryHistorySchema.parse(args);
    const params: JsonRecord = {
      block_type: parsed.block_type,
      limit: parsed.limit,
      scope: parsed.scope,
    };

    const resolvedSessionId = parsed.session_id ?? getSessionId();
    if (resolvedSessionId !== null) {
      params.session_id = resolvedSessionId;
    }

    const data = await requestJson<unknown>({
      path: "/memory/core/history",
      method: "GET",
      query: params as Record<string, any>,
    });

    if (!Array.isArray(data) || data.length === 0) {
      return {
        content: [
          { type: "text", text: `No history for core memory block '${parsed.block_type}'` },
        ],
      };
    }

    const parts: string[] = [`## Core Memory History (${parsed.block_type})\n`];
    for (const item of data as Array<Record<string, any>>) {
      const version = item.version ?? "";
      const reason = item.reason ?? "";
      const content = item.content ?? "";
      const header = reason ? `- v${version} (${reason})` : `- v${version}`;
      parts.push(header);
      parts.push(`  ${content}`);
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

const CoreMemoryRollbackSchema = z.object({
  block_type: z.string(),
  target_version: z.number().int(),
  reason: z.string().optional(),
  scope: z.string().optional().default("user"),
  session_id: z.number().int().optional(),
});

server.registerTool(
  "core_memory_rollback",
  {
    description: "Roll back a core memory block to a previous version.",
    inputSchema: CoreMemoryRollbackSchema.shape,
  },
  async (args) => {
    const parsed = CoreMemoryRollbackSchema.parse(args);
    const payload: JsonRecord = {
      block_type: parsed.block_type,
      target_version: parsed.target_version,
      reason: parsed.reason ?? null,
      scope: parsed.scope,
    };

    const resolvedSessionId = parsed.session_id ?? getSessionId();
    if (resolvedSessionId !== null) {
      payload.session_id = resolvedSessionId;
    }

    const data = await requestJson<JsonRecord>({
      path: "/memory/core/rollback",
      method: "POST",
      body: payload,
    });

    const block = (data.block as Record<string, any>) ?? {};
    const rolled = data.rolled_back_to ?? parsed.target_version;
    const blockType = block.block_type ?? parsed.block_type;

    return {
      content: [{ type: "text", text: `Rolled back core memory (${blockType}) to v${rolled}` }],
    };
  },
);

const GetEntitySchema = z.object({
  name: z.string(),
  include_related: z.boolean().optional().default(true),
});

server.registerTool(
  "get_entity",
  {
    description: "Get detailed information about a specific entity.",
    inputSchema: GetEntitySchema.shape,
  },
  async (args) => {
    const parsed = GetEntitySchema.parse(args);

    let data: JsonRecord;
    try {
      data = await requestJson<JsonRecord>({
        path: `/kg/entity/${parsed.name}`,
        method: "GET",
      });
    } catch (error) {
      if (String(error).includes("404")) {
        return {
          content: [{ type: "text", text: `Entity '${parsed.name}' not found in knowledge graph` }],
        };
      }
      throw error;
    }

    if (!data.found) {
      return {
        content: [{ type: "text", text: `Entity '${parsed.name}' not found in knowledge graph` }],
      };
    }

    const primary = (data.primary_node as Record<string, any>) ?? {};
    const related = Array.isArray(data.related_nodes) ? data.related_nodes : [];
    const relationships = Array.isArray(data.relationships) ? data.relationships : [];

    const parts: string[] = [`## ${primary.name ?? parsed.name}`];

    const labels = Array.isArray(primary.labels) ? primary.labels : [];
    if (labels.length) {
      parts.push(`**Type:** ${labels.join(", ")}`);
    }

    if (primary.created_at) {
      parts.push(`**First seen:** ${primary.created_at}`);
    }

    parts.push("");

    if (relationships.length) {
      parts.push(`### Relationships (${relationships.length})`);
      for (const rel of relationships) {
        parts.push(`- ${rel.fact ?? "Unknown relationship"}`);
      }
      parts.push("");
    }

    if (parsed.include_related && related.length) {
      parts.push(`### Related Entities (${related.length})`);
      for (const rel of related) {
        const relLabels = Array.isArray(rel.labels) ? rel.labels.join(", ") : "";
        if (relLabels) {
          parts.push(`- **${rel.name ?? "unknown"}** [${relLabels}]`);
        } else {
          parts.push(`- **${rel.name ?? "unknown"}**`);
        }
      }
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

const RecallContextSchema = z.object({
  around_date: z.string().optional(),
  limit: z.number().int().optional().default(20),
});

server.registerTool(
  "recall_context",
  {
    description: "Recall facts and events from a specific time period.",
    inputSchema: RecallContextSchema.shape,
  },
  async (args) => {
    const parsed = RecallContextSchema.parse(args);
    const params: JsonRecord = { limit: parsed.limit };
    if (parsed.around_date) {
      params.start_date = parsed.around_date;
      params.end_date = parsed.around_date;
    }

    const data = await requestJson<JsonRecord>({
      path: "/kg/facts/timeline",
      method: "GET",
      query: params as Record<string, any>,
    });

    const facts = Array.isArray(data.facts) ? data.facts : [];
    if (!facts.length) {
      return {
        content: [
          {
            type: "text",
            text: parsed.around_date
              ? `No events found around ${parsed.around_date}`
              : "No recent events in the knowledge graph",
          },
        ],
      };
    }

    const parts: string[] = [
      parsed.around_date ? `## Events around ${parsed.around_date}\n` : "## Recent Timeline\n",
    ];

    for (const item of facts) {
      const kind = item.kind;
      const status = item.temporal_status ?? "valid";
      const statusIndicator = status === "valid" ? "" : ` [${status}]`;
      if (kind === "fact") {
        const factData = item.fact ?? {};
        parts.push(`- ${formatFact(factData)}${statusIndicator}`);
      } else if (kind === "edge") {
        const edgeData = item.edge ?? {};
        parts.push(`- ${formatEdge(edgeData)}${statusIndicator}`);
      }
    }

    const total = typeof data.total === "number" ? data.total : facts.length;
    if (total > parsed.limit) {
      parts.push(`\n*Showing ${parsed.limit} of ${total} total entries*`);
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

server.registerTool(
  "get_knowledge_stats",
  {
    description: "Get statistics about the knowledge graph.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    const data = await requestJson<JsonRecord>({
      path: "/kg/stats",
      method: "GET",
    });

    const parts: string[] = ["## Knowledge Graph Statistics\n"];
    parts.push(`- **Entities:** ${data.total_entities ?? 0}`);
    parts.push(`- **Facts:** ${data.total_facts ?? 0}`);
    parts.push(`- **Relationships:** ${data.total_edges ?? 0}`);
    parts.push(`- **Communities:** ${data.total_communities ?? 0}`);
    parts.push("");

    const topMentioned = Array.isArray(data.top_mentioned) ? data.top_mentioned : [];
    if (topMentioned.length) {
      parts.push("### Most Mentioned");
      for (const item of topMentioned.slice(0, 5)) {
        parts.push(`- ${item.name ?? "unknown"} (${item.mention_count ?? 0}x)`);
      }
      parts.push("");
    }

    const labelDist = data.label_distribution as Record<string, number> | undefined;
    if (labelDist) {
      parts.push("### Entity Types");
      const entries = Object.entries(labelDist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      for (const [label, count] of entries) {
        parts.push(`- ${label}: ${count}`);
      }
    }

    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Knowledge Graph Server running on stdio");
}

main().catch((error) => {
  console.error("Server crashed:", error);
  process.exit(1);
});
