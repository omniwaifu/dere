import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { daemonRequest } from "@dere/shared-runtime";

type JsonRecord = Record<string, unknown>;

const server = new McpServer({
  name: "Swarm Agent Coordinator",
  version: "1.0.0",
});

const PARENT_SESSION_ID = process.env.DERE_SESSION_ID;

function getSessionId(): number {
  if (!PARENT_SESSION_ID) {
    throw new Error(
      "spawn_agents can only be called from a dere session. DERE_SESSION_ID environment variable not set.",
    );
  }
  const parsed = Number.parseInt(PARENT_SESSION_ID, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error("DERE_SESSION_ID is invalid.");
  }
  return parsed;
}

function getSwarmContext(): { swarmId: number; agentId: number } | null {
  const swarmIdRaw = process.env.DERE_SWARM_ID;
  const agentIdRaw = process.env.DERE_SWARM_AGENT_ID;
  if (!swarmIdRaw || !agentIdRaw) {
    return null;
  }
  const swarmId = Number.parseInt(swarmIdRaw, 10);
  const agentId = Number.parseInt(agentIdRaw, 10);
  if (!Number.isFinite(swarmId) || !Number.isFinite(agentId)) {
    return null;
  }
  return { swarmId, agentId };
}

function requireSwarmContext(): { swarmId: number; agentId: number } {
  const ctx = getSwarmContext();
  if (!ctx) {
    throw new Error(
      "Scratchpad tools are only available when running as a swarm agent. DERE_SWARM_ID and DERE_SWARM_AGENT_ID environment variables not set.",
    );
  }
  return ctx;
}

function getAgentName(): string | null {
  return process.env.DERE_SWARM_AGENT_NAME ?? null;
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

const SpawnAgentsSchema = z.object({
  swarm_name: z.string(),
  agents: z.array(z.record(z.unknown())),
  description: z.string().optional(),
  git_branch_prefix: z.string().optional(),
  base_branch: z.string().optional(),
  working_dir: z.string().optional(),
  auto_start: z.boolean().optional().default(true),
  auto_synthesize: z.boolean().optional().default(false),
  synthesis_prompt: z.string().optional(),
  skip_synthesis_on_failure: z.boolean().optional().default(false),
  auto_supervise: z.boolean().optional().default(false),
  supervisor_warn_seconds: z.number().int().optional().default(600),
  supervisor_cancel_seconds: z.number().int().optional().default(1800),
});

server.registerTool(
  "spawn_agents",
  {
    description:
      "Spawn a swarm of background agents to work on tasks. auto_start defaults true; use wait_for_agents to block.",
    inputSchema: SpawnAgentsSchema.shape,
  },
  async (args) => {
    const parsed = SpawnAgentsSchema.parse(args);
    const payload: JsonRecord = {
      parent_session_id: getSessionId(),
      name: parsed.swarm_name,
      description: parsed.description,
      working_dir: parsed.working_dir ?? process.cwd(),
      git_branch_prefix: parsed.git_branch_prefix,
      base_branch: parsed.base_branch,
      agents: parsed.agents,
      auto_start: parsed.auto_start,
      auto_synthesize: parsed.auto_synthesize,
      synthesis_prompt: parsed.synthesis_prompt,
      skip_synthesis_on_failure: parsed.skip_synthesis_on_failure,
      auto_supervise: parsed.auto_supervise,
      supervisor_warn_seconds: parsed.supervisor_warn_seconds,
      supervisor_cancel_seconds: parsed.supervisor_cancel_seconds,
    };

    const data = await requestJson<JsonRecord>({
      path: "/swarm/create",
      method: "POST",
      body: payload,
      timeoutMs: 60_000,
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const SwarmIdSchema = z.object({
  swarm_id: z.number().int(),
});

server.registerTool(
  "start_swarm",
  {
    description: "Start executing a pending swarm's agents.",
    inputSchema: SwarmIdSchema.shape,
  },
  async (args) => {
    const parsed = SwarmIdSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${parsed.swarm_id}/start`,
      method: "POST",
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "get_swarm_status",
  {
    description: "Get status of swarm and all agents.",
    inputSchema: SwarmIdSchema.shape,
  },
  async (args) => {
    const parsed = SwarmIdSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${parsed.swarm_id}`,
      method: "GET",
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const WaitForAgentsSchema = z.object({
  swarm_id: z.number().int(),
  agent_names: z.array(z.string()).optional(),
  timeout_seconds: z.number().optional(),
});

server.registerTool(
  "wait_for_agents",
  {
    description: "Wait for agents to complete (blocking).",
    inputSchema: WaitForAgentsSchema.shape,
  },
  async (args) => {
    const parsed = WaitForAgentsSchema.parse(args);
    const timeout = parsed.timeout_seconds ?? null;
    const requestTimeout = timeout ? timeout * 1000 + 30_000 : 300_000;

    const data = await requestJson<JsonRecord>({
      path: `/swarm/${parsed.swarm_id}/wait`,
      method: "POST",
      body: {
        agent_names: parsed.agent_names,
        timeout_seconds: parsed.timeout_seconds,
      },
      timeoutMs: requestTimeout,
    });

    return { content: [{ type: "text", text: JSON.stringify({ agents: data }) }] };
  },
);

const AgentOutputSchema = z.object({
  swarm_id: z.number().int(),
  agent_name: z.string(),
});

server.registerTool(
  "get_agent_output",
  {
    description: "Get full output from a specific agent.",
    inputSchema: AgentOutputSchema.shape,
  },
  async (args) => {
    const parsed = AgentOutputSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${parsed.swarm_id}/agent/${parsed.agent_name}`,
      method: "GET",
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "cancel_swarm",
  {
    description: "Cancel all running/pending agents in a swarm.",
    inputSchema: SwarmIdSchema.shape,
  },
  async (args) => {
    const parsed = SwarmIdSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${parsed.swarm_id}/cancel`,
      method: "POST",
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const MergeBranchesSchema = z.object({
  swarm_id: z.number().int(),
  target_branch: z.string().optional().default("main"),
  strategy: z.string().optional().default("sequential"),
});

server.registerTool(
  "merge_agent_branches",
  {
    description: "Merge agent branches back to target branch.",
    inputSchema: MergeBranchesSchema.shape,
  },
  async (args) => {
    const parsed = MergeBranchesSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${parsed.swarm_id}/merge`,
      method: "POST",
      body: {
        target_branch: parsed.target_branch,
        strategy: parsed.strategy,
      },
      timeoutMs: 300_000,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "list_personalities",
  {
    description: "List available personalities for swarm agents.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    const data = await requestJson<JsonRecord>({
      path: "/swarm/personalities",
      method: "GET",
      timeoutMs: 10_000,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "list_plugins",
  {
    description: "List available plugins that can be assigned to swarm agents.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    const data = await requestJson<JsonRecord>({
      path: "/swarm/plugins",
      method: "GET",
      timeoutMs: 10_000,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const ScratchpadSetSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

server.registerTool(
  "scratchpad_set",
  {
    description: "Share a value with other agents in this swarm via the scratchpad.",
    inputSchema: ScratchpadSetSchema.shape,
  },
  async (args) => {
    const parsed = ScratchpadSetSchema.parse(args);
    const { swarmId, agentId } = requireSwarmContext();
    let agentName = getAgentName();

    if (!agentName) {
      const status = await requestJson<JsonRecord>({
        path: `/swarm/${swarmId}`,
        method: "GET",
      });
      const agents = Array.isArray(status.agents) ? status.agents : [];
      for (const agent of agents) {
        if (agent?.id === agentId) {
          agentName = agent.name ?? null;
          break;
        }
      }
    }

    const data = await requestJson<JsonRecord>({
      path: `/swarm/${swarmId}/scratchpad/${parsed.key}`,
      method: "PUT",
      body: {
        value: parsed.value,
        agent_id: agentId,
        agent_name: agentName,
      },
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const ScratchpadKeySchema = z.object({
  key: z.string(),
});

server.registerTool(
  "scratchpad_get",
  {
    description: "Get a value from the swarm scratchpad.",
    inputSchema: ScratchpadKeySchema.shape,
  },
  async (args) => {
    const parsed = ScratchpadKeySchema.parse(args);
    const { swarmId } = requireSwarmContext();

    try {
      const data = await requestJson<JsonRecord>({
        path: `/swarm/${swarmId}/scratchpad/${parsed.key}`,
        method: "GET",
      });
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (error) {
      if (String(error).includes("404")) {
        return { content: [{ type: "text", text: JSON.stringify(null) }] };
      }
      throw error;
    }
  },
);

const ScratchpadListSchema = z.object({
  prefix: z.string().optional(),
});

server.registerTool(
  "scratchpad_list",
  {
    description: "List all scratchpad entries in this swarm.",
    inputSchema: ScratchpadListSchema.shape,
  },
  async (args) => {
    const parsed = ScratchpadListSchema.parse(args);
    const { swarmId } = requireSwarmContext();
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${swarmId}/scratchpad`,
      method: "GET",
      query: parsed.prefix ? { prefix: parsed.prefix } : undefined,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "scratchpad_delete",
  {
    description: "Delete a key from the swarm scratchpad.",
    inputSchema: ScratchpadKeySchema.shape,
  },
  async (args) => {
    const parsed = ScratchpadKeySchema.parse(args);
    const { swarmId } = requireSwarmContext();
    const data = await requestJson<JsonRecord>({
      path: `/swarm/${swarmId}/scratchpad/${parsed.key}`,
      method: "DELETE",
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const SendMessageSchema = z.object({
  to: z.string(),
  text: z.string(),
  priority: z.string().optional().default("normal"),
});

server.registerTool(
  "send_message",
  {
    description: "Send a message to another agent in this swarm.",
    inputSchema: SendMessageSchema.shape,
  },
  async (args) => {
    const parsed = SendMessageSchema.parse(args);
    const { swarmId, agentId } = requireSwarmContext();
    const senderName = getAgentName() ?? `agent-${agentId}`;
    const messageId = `${Date.now()}-${agentId}`;
    const key = `messages/to-${parsed.to}/${messageId}`;

    await requestJson<JsonRecord>({
      path: `/swarm/${swarmId}/scratchpad/${key}`,
      method: "PUT",
      body: {
        value: {
          from: senderName,
          from_id: agentId,
          to: parsed.to,
          text: parsed.text,
          priority: parsed.priority,
          timestamp: new Date().toISOString(),
        },
        agent_id: agentId,
        agent_name: senderName,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ sent: true, message_id: messageId, to: parsed.to }),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Swarm Server running on stdio");
}

main().catch((error) => {
  console.error("Server crashed:", error);
  process.exit(1);
});
