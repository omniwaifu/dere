import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { daemonRequest } from "../lib/daemon-client.ts";

type JsonRecord = Record<string, unknown>;

const server = new McpServer({
  name: "Project Work Queue",
  version: "1.0.0",
});

const SESSION_ID = process.env.DERE_SESSION_ID;
const AGENT_ID = process.env.DERE_SWARM_AGENT_ID;

function getSessionId(): number | null {
  if (!SESSION_ID) {
    return null;
  }
  const parsed = Number.parseInt(SESSION_ID, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAgentId(): number | null {
  if (!AGENT_ID) {
    return null;
  }
  const parsed = Number.parseInt(AGENT_ID, 10);
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

const ListTasksSchema = z.object({
  working_dir: z.string().optional(),
  status: z.string().optional(),
  task_type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().optional().default(50),
});

server.registerTool(
  "list_tasks",
  {
    description: "List project tasks with optional filtering.",
    inputSchema: ListTasksSchema.shape,
  },
  async (args) => {
    const parsed = ListTasksSchema.parse(args);
    const params: JsonRecord = {
      limit: parsed.limit,
      working_dir: parsed.working_dir ?? process.cwd(),
    };
    if (parsed.status) {
      params.status = parsed.status;
    }
    if (parsed.task_type) {
      params.task_type = parsed.task_type;
    }
    if (parsed.tags) {
      params.tags = parsed.tags;
    }

    const data = await requestJson<JsonRecord>({
      path: "/work-queue/tasks",
      method: "GET",
      query: params as Record<string, any>,
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const CreateTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  working_dir: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  context_summary: z.string().optional(),
  scope_paths: z.array(z.string()).optional(),
  required_tools: z.array(z.string()).optional(),
  task_type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  estimated_effort: z.string().optional(),
  priority: z.number().int().optional().default(0),
  blocked_by: z.array(z.number().int()).optional(),
  related_task_ids: z.array(z.number().int()).optional(),
  discovered_from_task_id: z.number().int().optional(),
  discovery_reason: z.string().optional(),
  extra: z.record(z.unknown()).optional(),
});

server.registerTool(
  "create_task",
  {
    description: "Create a new project task.",
    inputSchema: CreateTaskSchema.shape,
  },
  async (args) => {
    const parsed = CreateTaskSchema.parse(args);
    const payload: JsonRecord = {
      title: parsed.title,
      description: parsed.description,
      working_dir: parsed.working_dir ?? process.cwd(),
      acceptance_criteria: parsed.acceptance_criteria,
      context_summary: parsed.context_summary,
      scope_paths: parsed.scope_paths,
      required_tools: parsed.required_tools,
      task_type: parsed.task_type,
      tags: parsed.tags,
      estimated_effort: parsed.estimated_effort,
      priority: parsed.priority,
      blocked_by: parsed.blocked_by,
      related_task_ids: parsed.related_task_ids,
      created_by_session_id: getSessionId(),
      created_by_agent_id: getAgentId(),
      discovered_from_task_id: parsed.discovered_from_task_id,
      discovery_reason: parsed.discovery_reason,
      extra: parsed.extra,
    };

    const data = await requestJson<JsonRecord>({
      path: "/work-queue/tasks",
      method: "POST",
      body: payload,
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const ReadyTasksSchema = z.object({
  working_dir: z.string().optional(),
  task_type: z.string().optional(),
  required_tools: z.array(z.string()).optional(),
  limit: z.number().int().optional().default(10),
});

server.registerTool(
  "get_ready_tasks",
  {
    description: "Find tasks that are ready for work (unblocked, unclaimed).",
    inputSchema: ReadyTasksSchema.shape,
  },
  async (args) => {
    const parsed = ReadyTasksSchema.parse(args);
    const params: JsonRecord = {
      working_dir: parsed.working_dir ?? process.cwd(),
      limit: parsed.limit,
    };
    if (parsed.task_type) {
      params.task_type = parsed.task_type;
    }
    if (parsed.required_tools) {
      params.required_tools = parsed.required_tools;
    }

    const data = await requestJson<JsonRecord>({
      path: "/work-queue/tasks/ready",
      method: "GET",
      query: params as Record<string, any>,
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const TaskIdSchema = z.object({
  task_id: z.number().int(),
});

server.registerTool(
  "claim_task",
  {
    description: "Atomically claim a ready task for the current session/agent.",
    inputSchema: TaskIdSchema.shape,
  },
  async (args) => {
    const parsed = TaskIdSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/work-queue/tasks/${parsed.task_id}/claim`,
      method: "POST",
      body: {
        session_id: getSessionId(),
        agent_id: getAgentId(),
      },
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const ReleaseTaskSchema = z.object({
  task_id: z.number().int(),
  reason: z.string().optional(),
});

server.registerTool(
  "release_task",
  {
    description: "Release a claimed task back to ready status.",
    inputSchema: ReleaseTaskSchema.shape,
  },
  async (args) => {
    const parsed = ReleaseTaskSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/work-queue/tasks/${parsed.task_id}/release`,
      method: "POST",
      body: { reason: parsed.reason ?? null },
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const UpdateTaskSchema = z.object({
  task_id: z.number().int(),
  status: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.number().int().optional(),
  tags: z.array(z.string()).optional(),
  outcome: z.string().optional(),
  completion_notes: z.string().optional(),
  files_changed: z.array(z.string()).optional(),
  last_error: z.string().optional(),
});

server.registerTool(
  "update_task",
  {
    description: "Update a task's details or status.",
    inputSchema: UpdateTaskSchema.shape,
  },
  async (args) => {
    const parsed = UpdateTaskSchema.parse(args);
    const payload: JsonRecord = {};
    if (parsed.status !== undefined) {
      payload.status = parsed.status;
    }
    if (parsed.title !== undefined) {
      payload.title = parsed.title;
    }
    if (parsed.description !== undefined) {
      payload.description = parsed.description;
    }
    if (parsed.priority !== undefined) {
      payload.priority = parsed.priority;
    }
    if (parsed.tags !== undefined) {
      payload.tags = parsed.tags;
    }
    if (parsed.outcome !== undefined) {
      payload.outcome = parsed.outcome;
    }
    if (parsed.completion_notes !== undefined) {
      payload.completion_notes = parsed.completion_notes;
    }
    if (parsed.files_changed !== undefined) {
      payload.files_changed = parsed.files_changed;
    }
    if (parsed.last_error !== undefined) {
      payload.last_error = parsed.last_error;
    }

    const data = await requestJson<JsonRecord>({
      path: `/work-queue/tasks/${parsed.task_id}`,
      method: "PATCH",
      body: payload,
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "get_task",
  {
    description: "Get details of a specific task.",
    inputSchema: TaskIdSchema.shape,
  },
  async (args) => {
    const parsed = TaskIdSchema.parse(args);
    const data = await requestJson<JsonRecord>({
      path: `/work-queue/tasks/${parsed.task_id}`,
      method: "GET",
    });

    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Work Queue Server running on stdio");
}

main().catch((error) => {
  console.error("Server crashed:", error);
  process.exit(1);
});
