import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";
import type { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { getDb } from "./db.js";
import { listPersonalityInfos } from "./personalities.js";
import { bufferInteractionStimulus } from "./emotion-runtime.js";
import { processCuriosityTriggers } from "./ambient-triggers/index.js";
import { runDockerSandboxQuery } from "./sandbox/docker-runner.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_SIZE = 50 * 1024;
const SUMMARY_THRESHOLD = 1000;
const SUMMARY_MODEL = "claude-haiku-4-5";

const MEMORY_STEWARD_NAME = "memory-steward";
const MEMORY_SCRATCHPAD_PREFIX = "memory/";
const MEMORY_RECALL_QUERY_LIMIT = 200;

const STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
} as const;

const INCLUDE_MODES = new Set(["summary", "full", "none"]);

type DependencySpec = {
  agent: string;
  include: "summary" | "full" | "none";
  condition?: string | null;
};

type AgentSpec = {
  name: string;
  prompt: string;
  role: string;
  mode: string;
  personality: string | null;
  plugins: string[] | null;
  depends_on: DependencySpec[] | null;
  allowed_tools: string[] | null;
  thinking_budget: number | null;
  model: string | null;
  sandbox_mode: boolean;
  goal: string | null;
  capabilities: string[] | null;
  task_types: string[] | null;
  max_tasks: number | null;
  max_duration_seconds: number | null;
  idle_timeout_seconds: number;
};

type SwarmRow = {
  id: number;
  name: string;
  description: string | null;
  parent_session_id: number | null;
  working_dir: string;
  git_branch_prefix: string | null;
  base_branch: string | null;
  status: string;
  auto_synthesize: boolean;
  synthesis_prompt: string | null;
  skip_synthesis_on_failure: boolean;
  synthesis_output: string | null;
  synthesis_summary: string | null;
  auto_supervise: boolean;
  supervisor_warn_seconds: number;
  supervisor_cancel_seconds: number;
  created_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
};

type SwarmAgentRow = {
  id: number;
  swarm_id: number;
  name: string;
  role: string;
  is_synthesis_agent: boolean;
  mode: string;
  prompt: string;
  goal: string | null;
  capabilities: string[] | null;
  task_types: string[] | null;
  max_tasks: number | null;
  max_duration_seconds: number | null;
  idle_timeout_seconds: number;
  tasks_completed: number;
  tasks_failed: number;
  current_task_id: number | null;
  personality: string | null;
  plugins: string[] | null;
  git_branch: string | null;
  allowed_tools: string[] | null;
  thinking_budget: number | null;
  model: string | null;
  sandbox_mode: boolean;
  depends_on: Array<{ agent_id: number; include: string; condition?: string | null }> | null;
  session_id: number | null;
  status: string;
  output_text: string | null;
  output_summary: string | null;
  error_message: string | null;
  tool_count: number;
  created_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
};

type SwarmRun = {
  promise: Promise<void>;
  cancelled: boolean;
};

const runningAgents = new Map<number, Promise<void>>();
const completionSignals = new Map<number, { promise: Promise<void>; resolve: () => void }>();
const swarmRuns = new Map<number, SwarmRun>();

function nowDate(): Date {
  return new Date();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_SIZE) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_SIZE)}\n\n[Output truncated]`;
}

function resolvePluginPaths(
  plugins: string[] | null,
): Array<{ type: "local"; path: string }> | undefined {
  const resolved = plugins ?? ["dere_core"];
  if (resolved.length === 0) {
    return undefined;
  }
  const base = `${process.cwd()}/plugins`;
  return resolved.map((name) => ({ type: "local", path: `${base}/${name}` }));
}

function collectText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(collectText).join("");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.content)) {
      return record.content.map(collectText).join("");
    }
  }
  return "";
}

function extractBlocksFromAssistantMessage(message: SDKAssistantMessage): {
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }>;
  toolNames: string[];
} {
  const blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }> = [];
  const toolNames: string[] = [];

  const content = message?.message?.content;
  if (!content) {
    return { blocks, toolNames };
  }

  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
    return { blocks, toolNames };
  }

  if (!Array.isArray(content)) {
    return { blocks, toolNames };
  }

  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const block = item as Record<string, unknown>;
    const type = String(block.type ?? "");
    if (type === "text" || type === "thinking") {
      blocks.push({ type, text: collectText(block.text ?? block.content ?? "") });
      continue;
    }
    if (type === "tool_use") {
      const name = typeof block.name === "string" ? block.name : "";
      if (name) {
        toolNames.push(name);
      }
      blocks.push({
        type,
        id: typeof block.id === "string" ? block.id : undefined,
        name,
        input:
          typeof block.input === "object" && block.input
            ? (block.input as Record<string, unknown>)
            : {},
      });
      continue;
    }
    if (type === "tool_result") {
      blocks.push({
        type,
        tool_use_id: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
        output: collectText(block.content ?? ""),
        is_error: Boolean(block.is_error),
      });
    }
  }

  return { blocks, toolNames };
}

async function runAgentQuery(args: {
  swarm: SwarmRow;
  agent: SwarmAgentRow;
  prompt: string;
  sessionId: number;
}): Promise<{
  outputText: string;
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }>;
  toolNames: string[];
  toolCount: number;
  structuredOutput?: unknown;
}> {
  if (args.agent.sandbox_mode) {
    return await runDockerSandboxQuery({
      prompt: args.prompt,
      config: {
        workingDir: args.swarm.working_dir,
        outputStyle: "default",
        systemPrompt: null,
        model: args.agent.model ?? null,
        thinkingBudget: args.agent.thinking_budget ?? null,
        allowedTools: args.agent.allowed_tools ?? null,
        autoApprove: true,
        outputFormat: null,
        sandboxSettings: null,
        plugins: args.agent.plugins ?? null,
        env: {
          DERE_SESSION_ID: String(args.sessionId),
          DERE_SWARM_ID: String(args.swarm.id),
          DERE_SWARM_AGENT_ID: String(args.agent.id),
          DERE_SWARM_AGENT_NAME: args.agent.name,
        },
        sandboxNetworkMode: "bridge",
        mountType: "copy",
      },
    });
  }

  const plugins = resolvePluginPaths(args.agent.plugins);

  const options: Record<string, unknown> = {
    cwd: args.swarm.working_dir,
    model: args.agent.model ?? undefined,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    persistSession: false,
    settingSources: ["project"],
  };

  if (args.agent.allowed_tools && args.agent.allowed_tools.length > 0) {
    options.tools = args.agent.allowed_tools;
    options.allowedTools = args.agent.allowed_tools;
  } else {
    options.tools = { type: "preset", preset: "claude_code" };
  }

  if (plugins && plugins.length > 0) {
    options.plugins = plugins;
  }

  options.env = {
    DERE_SESSION_ID: String(args.sessionId),
    DERE_SWARM_ID: String(args.swarm.id),
    DERE_SWARM_AGENT_ID: String(args.agent.id),
    DERE_SWARM_AGENT_NAME: args.agent.name,
  };

  options.sandbox = { enabled: false };

  const blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }> = [];
  const toolNames: string[] = [];
  let toolCount = 0;
  let structuredOutput: unknown;
  let resultText = "";

  const response = query({ prompt: args.prompt, options });
  for await (const message of response) {
    if (message.type === "assistant") {
      const extracted = extractBlocksFromAssistantMessage(message as SDKAssistantMessage);
      if (extracted.blocks.length > 0) {
        blocks.push(...extracted.blocks);
        for (const tool of extracted.blocks) {
          if (tool.type === "tool_use") {
            toolCount += 1;
          }
        }
      }
      if (extracted.toolNames.length > 0) {
        toolNames.push(...extracted.toolNames);
      }
      continue;
    }

    if (message.type === "result") {
      const resultMessage = message as SDKResultMessage;
      if ("structured_output" in resultMessage && resultMessage.structured_output) {
        structuredOutput = resultMessage.structured_output;
      }
      if ("result" in resultMessage && typeof resultMessage.result === "string") {
        resultText = resultMessage.result;
      }
    }
  }

  const outputText =
    blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("") || resultText;

  return {
    outputText,
    blocks,
    toolNames: Array.from(new Set(toolNames)),
    toolCount,
    structuredOutput,
  };
}

async function generateSummary(outputText: string): Promise<string | null> {
  try {
    const transport = new ClaudeAgentTransport({
      workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
    });
    const client = new TextResponseClient({
      transport,
      model: process.env.DERE_SWARM_SUMMARY_MODEL ?? SUMMARY_MODEL,
    });
    const maxContext = 2000;
    const context =
      outputText.length > maxContext * 2
        ? `${outputText.slice(0, maxContext)}\n\n[...]\n\n${outputText.slice(-maxContext)}`
        : outputText;
    const prompt = `Summarize this agent output in 1-2 sentences. Focus on the main result or outcome.

Output:
${context}

Summary:`;
    const summary = await client.generate(prompt);
    return summary.trim();
  } catch (error) {
    console.log(`[swarm] summary generation failed: ${String(error)}`);
    return null;
  }
}

function detectDependencyCycle(agents: AgentSpec[]): string[] | null {
  const agentNames = new Set(agents.map((agent) => agent.name));
  const adjacency = new Map<string, string[]>();

  for (const agent of agents) {
    const deps = (agent.depends_on ?? [])
      .map((dep) => dep.agent)
      .filter((dep) => agentNames.has(dep));
    adjacency.set(agent.name, deps);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): string[] | null => {
    visiting.add(node);
    path.push(node);
    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (visiting.has(neighbor)) {
        const idx = path.indexOf(neighbor);
        return path.slice(idx).concat([neighbor]);
      }
      if (!visited.has(neighbor)) {
        const result = dfs(neighbor);
        if (result) {
          return result;
        }
      }
    }
    visiting.delete(node);
    visited.add(node);
    path.pop();
    return null;
  };

  for (const agent of agents) {
    if (!visited.has(agent.name)) {
      const result = dfs(agent.name);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function evaluateCondition(
  condition: string,
  outputText: string | null,
): { result: boolean; error: string | null } {
  if (!outputText) {
    return { result: false, error: "Dependency has no output" };
  }

  let parsed: unknown = null;
  try {
    let jsonText = outputText;
    const jsonBlock = outputText.match(/```json\\s*([\\s\\S]*?)```/i);
    if (jsonBlock?.[1]) {
      jsonText = jsonBlock[1].trim();
    } else {
      const codeBlock = outputText.match(/```\\s*([\\s\\S]*?)```/);
      if (codeBlock?.[1]) {
        jsonText = codeBlock[1].trim();
      }
    }
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = { text: outputText, raw: outputText };
  }

  const len = (value: unknown) =>
    Array.isArray(value) || typeof value === "string" ? value.length : 0;
  const list = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []);
  const dict = (value: unknown) => (value && typeof value === "object" ? value : {});
  const output = new Proxy(dict(parsed), {
    get(target, prop) {
      if (typeof prop === "string") {
        return (target as Record<string, unknown>)[prop];
      }
      return undefined;
    },
  });

  try {
    const fn = new Function(
      "output",
      "len",
      "str",
      "int",
      "float",
      "bool",
      "list",
      "dict",
      "any",
      "all",
      "sum",
      "min",
      "max",
      "abs",
      "True",
      "False",
      "None",
      `return (${condition});`,
    );
    const result = Boolean(
      fn(
        output,
        len,
        (value: unknown) => String(value ?? ""),
        (value: unknown) => Number.parseInt(String(value), 10),
        (value: unknown) => Number(value),
        (value: unknown) => Boolean(value),
        list,
        dict,
        (value: unknown[]) => value.some(Boolean),
        (value: unknown[]) => value.every(Boolean),
        (value: number[]) => value.reduce((acc, v) => acc + v, 0),
        Math.min,
        Math.max,
        Math.abs,
        true,
        false,
        null,
      ),
    );
    return { result, error: null };
  } catch (error) {
    return { result: false, error: `Condition evaluation error: ${String(error)}` };
  }
}

function computeCriticalPath(agents: SwarmAgentRow[]): string[] | null {
  if (agents.length === 0) {
    return null;
  }

  const idToAgent = new Map<number, SwarmAgentRow>();
  const nameToAgent = new Map<string, SwarmAgentRow>();
  agents.forEach((agent) => {
    idToAgent.set(agent.id, agent);
    nameToAgent.set(agent.name, agent);
  });

  const levels = new Map<string, number>();
  const computeLevel = (name: string): number => {
    if (levels.has(name)) {
      return levels.get(name) as number;
    }
    const agent = nameToAgent.get(name);
    if (!agent || !agent.depends_on || agent.depends_on.length === 0) {
      levels.set(name, 0);
      return 0;
    }
    let maxDep = -1;
    for (const dep of agent.depends_on) {
      const depAgent = idToAgent.get(dep.agent_id);
      if (depAgent) {
        maxDep = Math.max(maxDep, computeLevel(depAgent.name));
      }
    }
    levels.set(name, maxDep + 1);
    return maxDep + 1;
  };

  agents.forEach((agent) => computeLevel(agent.name));
  const maxLevel = Math.max(...Array.from(levels.values()));
  if (maxLevel === 0) {
    return null;
  }

  const pathTo = new Map<string, string[]>();
  agents.forEach((agent) => pathTo.set(agent.name, [agent.name]));

  for (let level = 1; level <= maxLevel; level += 1) {
    for (const agent of agents) {
      if (levels.get(agent.name) !== level || !agent.depends_on) {
        continue;
      }
      let longest: string[] = [];
      for (const dep of agent.depends_on) {
        const depAgent = idToAgent.get(dep.agent_id);
        if (depAgent) {
          const path = pathTo.get(depAgent.name) ?? [];
          if (path.length > longest.length) {
            longest = path;
          }
        }
      }
      pathTo.set(agent.name, [...longest, agent.name]);
    }
  }

  let best: string[] = [];
  for (const path of pathTo.values()) {
    if (path.length > best.length) {
      best = path;
    }
  }
  return best.length > 0 ? best : null;
}

function buildRecallQuery(
  swarmName: string,
  swarmDescription: string | null,
  extra?: string | null,
): string {
  const parts = [swarmName];
  if (swarmDescription) {
    parts.push(swarmDescription);
  }
  if (extra) {
    parts.push(extra);
  }
  let query = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  if (query.length > MEMORY_RECALL_QUERY_LIMIT) {
    query = query.slice(0, MEMORY_RECALL_QUERY_LIMIT).trim();
  }
  return query;
}

function buildMemoryPromptPrefix(
  swarmName: string,
  swarmDescription: string | null,
  agentName: string,
  extraQuery?: string | null,
): string {
  const query = buildRecallQuery(swarmName, swarmDescription, extraQuery);
  return (
    "# Swarm Memory Protocol\n" +
    "If recall_search is available, run it first with:\n" +
    `- query: "${query}"\n\n` +
    "If you discover durable facts, preferences, or decisions, write them to the swarm\n" +
    "scratchpad so the memory steward can store them:\n" +
    `- ${MEMORY_SCRATCHPAD_PREFIX}archival_facts/${agentName}: ` +
    '[{"fact": "...", "valid_from": "ISO-8601 or null", "tags": ["..."]}]\n' +
    `- ${MEMORY_SCRATCHPAD_PREFIX}core_updates/${agentName}: ` +
    '[{"block_type": "persona|human|task", "content": "...", "reason": "...", "scope": "user|session"}]\n' +
    `- ${MEMORY_SCRATCHPAD_PREFIX}recall_notes/${agentName}: "short notes"\n\n` +
    "Use scratchpad_set(key, value). If scratchpad tools aren't available, skip.\n"
  );
}

function buildMemoryStewardPrompt(swarmName: string): string {
  return (
    `You are the memory steward for swarm '${swarmName}'.\n\n` +
    "Your job is to consolidate swarm findings into durable memory.\n\n" +
    "## Steps\n" +
    `1. Read scratchpad entries with prefix '${MEMORY_SCRATCHPAD_PREFIX}' using scratchpad_list.\n` +
    "2. Review dependency outputs (including synthesis if present).\n" +
    "3. If synthesis output includes a `Memory Payload` JSON block, prefer it.\n" +
    "4. Apply updates using:\n" +
    "   - core_memory_edit (persona/human/task)\n" +
    "   - archival_memory_insert (durable facts)\n" +
    "5. Write a brief summary to " +
    `${MEMORY_SCRATCHPAD_PREFIX}steward_summary using scratchpad_set.\n\n` +
    "## Rules\n" +
    "- Only store high-confidence, durable information.\n" +
    "- Keep core memory concise and factual.\n" +
    "- Avoid duplicating facts that already exist unless clarified.\n"
  );
}

function buildDefaultSynthesisPrompt(swarmName: string): string {
  return (
    `You are the synthesis agent for swarm '${swarmName}'.\n\n` +
    "Your job is to produce a concise, high-signal summary of the swarm's work.\n\n" +
    "## Output format\n" +
    "Provide:\n" +
    "1. A short executive summary (3-5 bullets)\n" +
    "2. Key decisions and tradeoffs\n" +
    "3. Risks or open questions\n" +
    "4. Suggested next steps\n\n" +
    "If useful, include a `Memory Payload` JSON block with archival facts or core memory updates."
  );
}

function buildSupervisorPrompt(
  swarmName: string,
  agentNames: string[],
  warnSeconds: number,
  cancelSeconds: number,
): string {
  return (
    `You are the watchdog supervisor for swarm '${swarmName}'.\n\n` +
    "Your job is to monitor running agents and detect stalls or failures.\n\n" +
    "## Agents\n" +
    agentNames.map((name) => `- ${name}`).join("\n") +
    "\n\n" +
    "## Instructions\n" +
    "1. Call get_swarm_status() to check all agents\n" +
    "2. If any agent has been running for longer than " +
    `${warnSeconds}s, send a warning message\n` +
    "3. If any agent has been running for longer than " +
    `${cancelSeconds}s, mark it as stuck and request cancellation\n\n` +
    "- get_swarm_status(): Get status of all agents\n" +
    "- Your observations help improve future swarms\n"
  );
}

function buildTaskPrompt(
  agent: SwarmAgentRow,
  task: Record<string, unknown>,
  swarm: SwarmRow,
): string {
  const sections: string[] = [];
  if (agent.goal) {
    sections.push(`# Your Goal\n\n${agent.goal}`);
  }
  sections.push(`# Current Task\n\n**${String(task.title ?? "Untitled Task")}**`);
  if (typeof task.description === "string" && task.description) {
    sections.push(`## Description\n\n${task.description}`);
  }
  if (typeof task.acceptance_criteria === "string" && task.acceptance_criteria) {
    sections.push(`## Acceptance Criteria\n\n${task.acceptance_criteria}`);
  }
  if (typeof task.context_summary === "string" && task.context_summary) {
    sections.push(`## Context\n\n${task.context_summary}`);
  }
  if (Array.isArray(task.scope_paths) && task.scope_paths.length > 0) {
    sections.push(`## Scope\n\nFocus on: ${task.scope_paths.join(", ")}`);
  }

  sections.push(
    buildMemoryPromptPrefix(swarm.name, swarm.description, agent.name, String(task.title ?? "")),
  );

  sections.push(
    "## Instructions\n\n" +
      "1. Complete this task thoroughly\n" +
      "2. If you discover additional work needed, use work-queue tools to create follow-up tasks\n" +
      "3. Mark this task complete when done",
  );

  return sections.join("\n\n");
}

function normalizeAgentSpec(raw: Record<string, unknown>): AgentSpec {
  const dependsRaw = Array.isArray(raw.depends_on) ? raw.depends_on : null;
  const depends: DependencySpec[] | null = dependsRaw
    ? dependsRaw.map((item) => {
        if (typeof item === "string") {
          return { agent: item, include: "summary" };
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const includeRaw =
            typeof record.include === "string" ? record.include.toLowerCase() : "summary";
          const include = INCLUDE_MODES.has(includeRaw)
            ? (includeRaw as DependencySpec["include"])
            : "summary";
          return {
            agent: String(record.agent ?? ""),
            include,
            condition: typeof record.condition === "string" ? record.condition : null,
          };
        }
        return { agent: "", include: "summary" };
      })
    : null;

  return {
    name: String(raw.name ?? ""),
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    role: typeof raw.role === "string" ? raw.role : "generic",
    mode: typeof raw.mode === "string" ? raw.mode : "assigned",
    personality: typeof raw.personality === "string" ? raw.personality : null,
    plugins: Array.isArray(raw.plugins) ? raw.plugins.map(String) : null,
    depends_on: depends,
    allowed_tools: Array.isArray(raw.allowed_tools) ? raw.allowed_tools.map(String) : null,
    thinking_budget: typeof raw.thinking_budget === "number" ? raw.thinking_budget : null,
    model: typeof raw.model === "string" ? raw.model : null,
    sandbox_mode: typeof raw.sandbox_mode === "boolean" ? raw.sandbox_mode : true,
    goal: typeof raw.goal === "string" ? raw.goal : null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : null,
    task_types: Array.isArray(raw.task_types) ? raw.task_types.map(String) : null,
    max_tasks: typeof raw.max_tasks === "number" ? raw.max_tasks : null,
    max_duration_seconds:
      typeof raw.max_duration_seconds === "number" ? raw.max_duration_seconds : null,
    idle_timeout_seconds:
      typeof raw.idle_timeout_seconds === "number" ? raw.idle_timeout_seconds : 60,
  };
}

function getCompletionSignal(agentId: number): { promise: Promise<void>; resolve: () => void } {
  const existing = completionSignals.get(agentId);
  if (existing) {
    return existing;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  const entry = { promise, resolve };
  completionSignals.set(agentId, entry);
  return entry;
}

async function getSwarmWithAgents(
  swarmId: number,
): Promise<{ swarm: SwarmRow; agents: SwarmAgentRow[] } | null> {
  const db = await getDb();
  const swarm = await db
    .selectFrom("swarms")
    .selectAll()
    .where("id", "=", swarmId)
    .executeTakeFirst();
  if (!swarm) {
    return null;
  }
  const agents = await db
    .selectFrom("swarm_agents")
    .selectAll()
    .where("swarm_id", "=", swarmId)
    .execute();
  return { swarm: swarm as SwarmRow, agents: agents as SwarmAgentRow[] };
}

async function createSessionForAgent(agent: SwarmAgentRow, swarm: SwarmRow): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const session = await db
    .insertInto("sessions")
    .values({
      name: `swarm:${swarm.name}:${agent.name}`,
      working_dir: swarm.working_dir,
      start_time: nowSeconds(),
      end_time: null,
      last_activity: now,
      continued_from: null,
      project_type: null,
      claude_session_id: null,
      personality: agent.personality,
      medium: "agent_api",
      user_id: null,
      thinking_budget: agent.thinking_budget,
      sandbox_mode: agent.sandbox_mode,
      sandbox_settings: null,
      is_locked: false,
      mission_id: null,
      created_at: now,
      summary: null,
      summary_updated_at: null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return session.id;
}

async function insertConversation(
  sessionId: number,
  messageType: string,
  prompt: string,
  personality: string | null,
): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const timestamp = nowSeconds();
  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt,
      message_type: messageType,
      personality,
      timestamp,
      medium: "agent_api",
      user_id: null,
      ttft_ms: null,
      response_ms: null,
      thinking_ms: null,
      tool_uses: null,
      tool_names: null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  if (prompt.trim()) {
    await db
      .insertInto("conversation_blocks")
      .values({
        conversation_id: conversation.id,
        ordinal: 0,
        block_type: "text",
        text: prompt,
        tool_use_id: null,
        tool_name: null,
        tool_input: null,
        is_error: null,
        content_embedding: null,
        created_at: now,
      })
      .execute();
  }

  await db
    .updateTable("sessions")
    .set({ last_activity: now })
    .where("id", "=", sessionId)
    .execute();

  return conversation.id;
}

async function insertAssistantBlocks(
  sessionId: number,
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }>,
  personality: string | null,
  metadata: { toolUses: number; toolNames: string[] },
): Promise<number | null> {
  if (blocks.length === 0) {
    return null;
  }

  const db = await getDb();
  const now = nowDate();
  const timestamp = nowSeconds();

  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt: blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join(""),
      message_type: "assistant",
      personality,
      timestamp,
      medium: "agent_api",
      user_id: null,
      ttft_ms: null,
      response_ms: null,
      thinking_ms: null,
      tool_uses: metadata.toolUses,
      tool_names: metadata.toolNames.length > 0 ? metadata.toolNames : null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  let ordinal = 0;
  for (const block of blocks) {
    if (block.type === "text" || block.type === "thinking") {
      const text = block.text ?? "";
      if (!text) {
        continue;
      }
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text,
          tool_use_id: null,
          tool_name: null,
          tool_input: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_use") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text: null,
          tool_use_id: block.id ?? null,
          tool_name: block.name ?? null,
          tool_input: block.input ?? null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_result") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text: block.output ?? "",
          tool_use_id: block.tool_use_id ?? null,
          tool_name: null,
          tool_input: null,
          is_error: block.is_error ?? null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
    }
  }

  await db
    .updateTable("sessions")
    .set({ last_activity: now })
    .where("id", "=", sessionId)
    .execute();

  return conversation.id;
}

async function buildDependencyContext(
  agent: SwarmAgentRow,
  swarmAgents: SwarmAgentRow[],
): Promise<string> {
  if (!agent.depends_on || agent.depends_on.length === 0) {
    return "";
  }

  const byId = new Map<number, SwarmAgentRow>();
  swarmAgents.forEach((item) => byId.set(item.id, item));

  const sections: string[] = [];
  for (const dep of agent.depends_on) {
    const depAgent = byId.get(dep.agent_id);
    if (!depAgent) {
      continue;
    }
    const include = dep.include ?? "summary";
    if (include === "none") {
      continue;
    }

    let output = depAgent.output_text ?? "";
    if (include === "summary") {
      if (depAgent.output_summary) {
        output = depAgent.output_summary;
      } else if (output.length > SUMMARY_THRESHOLD) {
        output = (await generateSummary(output)) ?? output.slice(0, 2000);
      }
    }
    if (!output) {
      continue;
    }

    sections.push(`## Dependency: ${depAgent.name} (${include})\n\n${output}`);
  }

  if (sections.length === 0) {
    return "";
  }
  return sections.join("\n\n");
}

async function executeAssignedAgent(
  swarm: SwarmRow,
  agent: SwarmAgentRow,
  swarmAgents: SwarmAgentRow[],
) {
  const db = await getDb();
  const startedAt = nowDate();

  await db
    .updateTable("swarm_agents")
    .set({ status: STATUS.RUNNING, started_at: startedAt })
    .where("id", "=", agent.id)
    .execute();

  const sessionId = await createSessionForAgent(agent, swarm);
  await db
    .updateTable("swarm_agents")
    .set({ session_id: sessionId })
    .where("id", "=", agent.id)
    .execute();

  const dependencyContext = await buildDependencyContext(agent, swarmAgents);
  const prompt = dependencyContext ? `${dependencyContext}\n\n${agent.prompt}` : agent.prompt;

  try {
    await insertConversation(sessionId, "user", prompt, agent.personality);

    const {
      outputText: rawOutput,
      blocks,
      toolNames,
      toolCount,
    } = await runAgentQuery({
      swarm,
      agent,
      prompt,
      sessionId,
    });

    let outputText = truncateOutput(rawOutput ?? "");
    if (!outputText.trim()) {
      outputText = "";
    }

    let outputSummary: string | null = null;
    if (outputText.length > SUMMARY_THRESHOLD) {
      outputSummary = await generateSummary(outputText);
    }

    const completedAt = nowDate();
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.COMPLETED,
        completed_at: completedAt,
        output_text: outputText,
        output_summary: outputSummary,
        tool_count: toolCount,
        error_message: null,
      })
      .where("id", "=", agent.id)
      .execute();

    let assistantConversationId: number | null = null;
    if (blocks.length > 0) {
      assistantConversationId = await insertAssistantBlocks(sessionId, blocks, agent.personality, {
        toolUses: toolCount,
        toolNames,
      });
    } else if (outputText) {
      assistantConversationId = await insertConversation(
        sessionId,
        "assistant",
        outputText,
        agent.personality,
      );
    }

    if (assistantConversationId) {
      void processCuriosityTriggers({
        db,
        prompt: outputText,
        sessionId,
        conversationId: assistantConversationId,
        userId: null,
        workingDir: swarm.working_dir,
        personality: agent.personality,
        speakerName: null,
        isCommand: false,
        messageType: "assistant",
        kgNodes: null,
      }).catch((error) => {
        console.log(`[ambient] curiosity detection failed: ${String(error)}`);
      });
    }

    void bufferInteractionStimulus({
      sessionId,
      prompt,
      responseText: outputText,
      toolCount,
      personality: agent.personality,
      workingDir: swarm.working_dir,
    }).catch((error) => {
      console.log(`[emotion] buffer failed: ${String(error)}`);
    });

    if (agent.is_synthesis_agent) {
      await db
        .updateTable("swarms")
        .set({
          synthesis_output: outputText,
          synthesis_summary: outputSummary,
        })
        .where("id", "=", swarm.id)
        .execute();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = nowDate();
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.FAILED,
        completed_at: completedAt,
        error_message: message,
      })
      .where("id", "=", agent.id)
      .execute();
  }
}

async function claimTaskForAgent(
  agentId: number,
  workingDir: string,
  taskTypes: string[] | null,
  requiredTools: string[] | null,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();

  let query = db
    .selectFrom("project_tasks")
    .selectAll()
    .where("working_dir", "=", workingDir)
    .where("status", "=", "ready")
    .where("claimed_by_session_id", "is", null)
    .where("claimed_by_agent_id", "is", null);

  if (taskTypes && taskTypes.length > 0) {
    query = query.where("task_type", "in", taskTypes);
  }

  if (requiredTools && requiredTools.length > 0) {
    query = query.where(
      ({ ref, sql }) => sql`${ref("required_tools")} && ${sql.array(requiredTools)}`,
    );
  }

  const task = await query
    .orderBy("priority", "desc")
    .orderBy("created_at", "asc")
    .limit(1)
    .executeTakeFirst();
  if (!task) {
    return null;
  }

  const claimed = await db
    .updateTable("project_tasks")
    .set({
      status: "claimed",
      claimed_by_agent_id: agentId,
      claimed_at: nowDate(),
      updated_at: nowDate(),
    })
    .where("id", "=", task.id)
    .where("status", "=", "ready")
    .where("claimed_by_agent_id", "is", null)
    .executeTakeFirst();

  if (!claimed) {
    return null;
  }

  return task as Record<string, unknown>;
}

async function executeAutonomousAgent(swarm: SwarmRow, agent: SwarmAgentRow): Promise<void> {
  const db = await getDb();
  const startedAt = nowDate();

  await db
    .updateTable("swarm_agents")
    .set({ status: STATUS.RUNNING, started_at: startedAt })
    .where("id", "=", agent.id)
    .execute();

  const sessionId = await createSessionForAgent(agent, swarm);
  await db
    .updateTable("swarm_agents")
    .set({ session_id: sessionId })
    .where("id", "=", agent.id)
    .execute();

  const startTime = nowDate();
  let lastTaskTime = startTime;
  let tasksCompleted = agent.tasks_completed ?? 0;
  let tasksFailed = agent.tasks_failed ?? 0;

  while (true) {
    const elapsed = (nowDate().getTime() - startTime.getTime()) / 1000;
    if (agent.max_duration_seconds && elapsed >= agent.max_duration_seconds) {
      break;
    }
    if (agent.max_tasks && tasksCompleted >= agent.max_tasks) {
      break;
    }

    const task = await claimTaskForAgent(
      agent.id,
      swarm.working_dir,
      agent.task_types,
      agent.capabilities,
    );
    if (!task) {
      const idleTime = (nowDate().getTime() - lastTaskTime.getTime()) / 1000;
      if (idleTime >= agent.idle_timeout_seconds) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    lastTaskTime = nowDate();

    await db
      .updateTable("swarm_agents")
      .set({ current_task_id: task.id as number })
      .where("id", "=", agent.id)
      .execute();

    const prompt = buildTaskPrompt(agent, task, swarm);
    const { outputText: rawOutput, toolCount } = await runAgentQuery({
      swarm,
      agent,
      prompt,
      sessionId,
    });
    const outputText = truncateOutput(rawOutput ?? "");

    const success = outputText.trim().length > 0;
    if (success) {
      tasksCompleted += 1;
      await db
        .updateTable("project_tasks")
        .set({
          status: "done",
          outcome: `Completed by autonomous agent '${agent.name}'`,
          completion_notes: outputText.slice(0, 2000),
          completed_at: nowDate(),
          updated_at: nowDate(),
        })
        .where("id", "=", task.id as number)
        .execute();
    } else {
      tasksFailed += 1;
      await db
        .updateTable("project_tasks")
        .set({
          status: "ready",
          last_error: "Agent produced no output",
          claimed_by_agent_id: null,
          claimed_at: null,
          updated_at: nowDate(),
        })
        .where("id", "=", task.id as number)
        .execute();
    }

    await db
      .updateTable("swarm_agents")
      .set({ current_task_id: null })
      .where("id", "=", agent.id)
      .execute();
  }

  await db
    .updateTable("swarm_agents")
    .set({
      status: STATUS.COMPLETED,
      completed_at: nowDate(),
      output_text: `Autonomous agent completed. Tasks: ${tasksCompleted} completed, ${tasksFailed} failed.`,
      tasks_completed: tasksCompleted,
      tasks_failed: tasksFailed,
    })
    .where("id", "=", agent.id)
    .execute();
}

async function executeAgentWithDependencies(swarmId: number, agent: SwarmAgentRow) {
  const completion = getCompletionSignal(agent.id);

  try {
    if (agent.depends_on && agent.depends_on.length > 0) {
      for (const dep of agent.depends_on) {
        const signal = getCompletionSignal(dep.agent_id);
        await signal.promise;
      }
    }

    const { swarm, agents } = (await getSwarmWithAgents(swarmId)) ?? {};
    if (!swarm || !agents) {
      completion.resolve();
      return;
    }

    if (agent.is_synthesis_agent && swarm.skip_synthesis_on_failure) {
      const failed = agents.some(
        (other) =>
          !other.is_synthesis_agent &&
          other.name !== MEMORY_STEWARD_NAME &&
          other.status === STATUS.FAILED,
      );
      if (failed) {
        await getDb()
          .then((db) =>
            db
              .updateTable("swarm_agents")
              .set({ status: STATUS.SKIPPED, completed_at: nowDate() })
              .where("id", "=", agent.id)
              .execute(),
          )
          .catch(() => null);
        completion.resolve();
        return;
      }
    }

    if (swarmRuns.get(swarmId)?.cancelled) {
      await getDb()
        .then((db) =>
          db
            .updateTable("swarm_agents")
            .set({ status: STATUS.CANCELLED, completed_at: nowDate() })
            .where("id", "=", agent.id)
            .execute(),
        )
        .catch(() => null);
      completion.resolve();
      return;
    }

    let shouldSkip = false;
    if (agent.depends_on) {
      for (const dep of agent.depends_on) {
        if (!dep.condition) {
          continue;
        }
        const depAgent = agents.find((item) => item.id === dep.agent_id);
        if (!depAgent) {
          continue;
        }
        const result = evaluateCondition(dep.condition, depAgent.output_text);
        if (!result.result) {
          shouldSkip = true;
          break;
        }
      }
    }

    if (shouldSkip) {
      await getDb()
        .then((db) =>
          db
            .updateTable("swarm_agents")
            .set({ status: STATUS.SKIPPED, completed_at: nowDate() })
            .where("id", "=", agent.id)
            .execute(),
        )
        .catch(() => null);
      completion.resolve();
      return;
    }

    if (agent.mode === "autonomous") {
      await executeAutonomousAgent(swarm, agent);
    } else {
      await executeAssignedAgent(swarm, agent, agents);
    }
  } finally {
    completion.resolve();
  }
}

async function updateSwarmCompletion(swarmId: number) {
  const db = await getDb();
  const swarm = await db
    .selectFrom("swarms")
    .selectAll()
    .where("id", "=", swarmId)
    .executeTakeFirst();
  if (!swarm) {
    return;
  }

  const agents = (await db
    .selectFrom("swarm_agents")
    .selectAll()
    .where("swarm_id", "=", swarmId)
    .execute()) as SwarmAgentRow[];

  const finalStatuses = new Set([
    STATUS.COMPLETED,
    STATUS.FAILED,
    STATUS.CANCELLED,
    STATUS.SKIPPED,
  ]);
  const allDone = agents.every((agent) => finalStatuses.has(agent.status));
  if (!allDone) {
    return;
  }

  let finalStatus = STATUS.COMPLETED;
  if (agents.some((agent) => agent.status === STATUS.FAILED)) {
    finalStatus = STATUS.FAILED;
  }
  if (agents.some((agent) => agent.status === STATUS.CANCELLED)) {
    finalStatus = STATUS.CANCELLED;
  }

  await db
    .updateTable("swarms")
    .set({
      status: finalStatus,
      completed_at: nowDate(),
    })
    .where("id", "=", swarmId)
    .execute();

  await queueMemoryConsolidation(swarmId, swarm.parent_session_id);
}

async function queueMemoryConsolidation(swarmId: number, parentSessionId: number | null) {
  try {
    const db = await getDb();
    let userId: string | null = null;
    if (parentSessionId) {
      const session = await db
        .selectFrom("sessions")
        .select(["user_id"])
        .where("id", "=", parentSessionId)
        .executeTakeFirst();
      userId = session?.user_id ?? null;
    }

    await db
      .insertInto("task_queue")
      .values({
        task_type: "memory_consolidation",
        model_name: "gemma3n:latest",
        content: `Memory consolidation after swarm ${swarmId}`,
        metadata: {
          user_id: userId,
          recency_days: 30,
          update_core_memory: false,
          trigger: "swarm",
          swarm_id: swarmId,
        },
        priority: 5,
        status: "pending",
        session_id: null,
        created_at: nowDate(),
        processed_at: null,
        retry_count: 0,
        error_message: null,
      })
      .execute();
  } catch (error) {
    console.log(`[swarm] failed to queue memory consolidation: ${String(error)}`);
  }
}

async function runSwarm(swarmId: number) {
  const { swarm, agents } = (await getSwarmWithAgents(swarmId)) ?? {};
  if (!swarm || !agents) {
    return;
  }

  const pendingAgents = agents.filter((agent) => agent.status === STATUS.PENDING);
  for (const agent of pendingAgents) {
    const task = executeAgentWithDependencies(swarmId, agent);
    runningAgents.set(agent.id, task);
  }

  for (const agent of pendingAgents) {
    const signal = getCompletionSignal(agent.id);
    await signal.promise;
  }

  await updateSwarmCompletion(swarmId);
}

async function startSwarmExecution(swarmId: number): Promise<void> {
  if (swarmRuns.has(swarmId)) {
    return;
  }

  const run: SwarmRun = {
    cancelled: false,
    promise: (async () => {
      await runSwarm(swarmId);
      swarmRuns.delete(swarmId);
    })(),
  };
  swarmRuns.set(swarmId, run);
}

async function runGitCommand(
  workingDir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: workingDir });
    return { code: 0, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      code: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(error),
    };
  }
}

async function getCurrentBranch(workingDir: string): Promise<string> {
  const result = await runGitCommand(workingDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to get current branch");
  }
  return result.stdout.trim();
}

async function createBranch(workingDir: string, branchName: string, base: string) {
  const exists = await runGitCommand(workingDir, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branchName}`,
  ]);
  if (exists.code === 0) {
    throw new Error(`Branch '${branchName}' already exists`);
  }
  const result = await runGitCommand(workingDir, ["branch", branchName, base]);
  if (result.code !== 0) {
    throw new Error(result.stderr || "Failed to create branch");
  }
}

async function mergeBranch(
  workingDir: string,
  source: string,
  target: string,
  noFf = true,
  message?: string,
) {
  await runGitCommand(workingDir, ["checkout", target]);
  const args = ["merge", source];
  if (noFf) {
    args.push("--no-ff");
  }
  if (message) {
    args.push("-m", message);
  }
  const result = await runGitCommand(workingDir, args);
  if (result.code !== 0) {
    if (result.stdout.includes("CONFLICT") || result.stderr.includes("CONFLICT")) {
      await runGitCommand(workingDir, ["merge", "--abort"]);
      return { success: false, error: `Merge conflict: ${result.stderr || result.stdout}` };
    }
    return { success: false, error: result.stderr || result.stdout };
  }
  return { success: true, error: null };
}

async function listPlugins() {
  const pluginsDir = join(process.cwd(), "plugins");
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const plugins: Array<{
      name: string;
      version: string;
      description: string;
      has_mcp_servers: boolean;
      mcp_servers: string[];
    }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) {
        continue;
      }
      const pluginJson = join(pluginsDir, entry.name, ".claude-plugin", "plugin.json");
      try {
        const raw = await readFile(pluginJson, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        const mcpServers =
          data.mcpServers && typeof data.mcpServers === "object"
            ? Object.keys(data.mcpServers as Record<string, unknown>)
            : [];
        plugins.push({
          name: entry.name,
          version: typeof data.version === "string" ? data.version : "0.0.0",
          description: typeof data.description === "string" ? data.description : "",
          has_mcp_servers: mcpServers.length > 0,
          mcp_servers: mcpServers,
        });
      } catch {
        continue;
      }
    }
    return plugins;
  } catch {
    return [];
  }
}

export function registerSwarmRoutes(app: Hono): void {
  app.post("/swarm/create", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const name = typeof payload.name === "string" ? payload.name : "";
    const rawAgents = Array.isArray(payload.agents) ? payload.agents : [];
    if (!name.trim() || rawAgents.length === 0) {
      return c.json({ error: "name and agents are required" }, 400);
    }

    const agents = rawAgents.map((item) => normalizeAgentSpec(item as Record<string, unknown>));
    const nameSet = new Set(agents.map((agent) => agent.name));
    if (nameSet.size !== agents.length) {
      return c.json({ error: "Agent names must be unique" }, 400);
    }
    for (const spec of agents) {
      if (spec.depends_on) {
        for (const dep of spec.depends_on) {
          if (!nameSet.has(dep.agent)) {
            return c.json(
              { error: `Agent '${spec.name}' depends on unknown agent '${dep.agent}'` },
              400,
            );
          }
        }
      }
    }
    const cycle = detectDependencyCycle(agents);
    if (cycle) {
      return c.json({ error: `Circular dependency detected: ${cycle.join(" -> ")}` }, 400);
    }

    const parentSessionId =
      typeof payload.parent_session_id === "number" ? payload.parent_session_id : null;
    const description = typeof payload.description === "string" ? payload.description : null;
    const gitBranchPrefix =
      typeof payload.git_branch_prefix === "string" ? payload.git_branch_prefix : null;
    const autoSynthesize = Boolean(payload.auto_synthesize);
    const synthesisPrompt =
      typeof payload.synthesis_prompt === "string" ? payload.synthesis_prompt : null;
    const skipSynthesisOnFailure = Boolean(payload.skip_synthesis_on_failure);
    const autoSupervise = Boolean(payload.auto_supervise);
    const supervisorWarnSeconds =
      typeof payload.supervisor_warn_seconds === "number" ? payload.supervisor_warn_seconds : 600;
    const supervisorCancelSeconds =
      typeof payload.supervisor_cancel_seconds === "number"
        ? payload.supervisor_cancel_seconds
        : 1800;

    const db = await getDb();
    let workingDir =
      typeof payload.working_dir === "string" && payload.working_dir.trim()
        ? payload.working_dir
        : null;
    if (!workingDir && parentSessionId) {
      const parent = await db
        .selectFrom("sessions")
        .select(["working_dir"])
        .where("id", "=", parentSessionId)
        .executeTakeFirst();
      workingDir = parent?.working_dir ?? null;
    }
    if (!workingDir) {
      workingDir = process.cwd();
    }

    let baseBranch: string | null =
      typeof payload.base_branch === "string" ? payload.base_branch : null;
    if (gitBranchPrefix && !baseBranch) {
      try {
        baseBranch = await getCurrentBranch(workingDir);
      } catch {
        baseBranch = null;
      }
    }

    const swarm = await db
      .insertInto("swarms")
      .values({
        name,
        description,
        parent_session_id: parentSessionId,
        working_dir: workingDir,
        git_branch_prefix: gitBranchPrefix,
        base_branch: baseBranch,
        status: STATUS.PENDING,
        auto_synthesize: autoSynthesize,
        synthesis_prompt: synthesisPrompt,
        skip_synthesis_on_failure: skipSynthesisOnFailure,
        synthesis_output: null,
        synthesis_summary: null,
        auto_supervise: autoSupervise,
        supervisor_warn_seconds: supervisorWarnSeconds,
        supervisor_cancel_seconds: supervisorCancelSeconds,
        created_at: nowDate(),
        started_at: null,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const nameToAgentId = new Map<string, number>();
    const createdAgents: Array<{ id: number; name: string; status: string }> = [];

    for (const spec of agents) {
      const gitBranch = gitBranchPrefix ? `${gitBranchPrefix}${spec.name}` : null;
      const prompt =
        spec.mode === "assigned"
          ? `${buildMemoryPromptPrefix(name, description, spec.name)}\n\n${spec.prompt}`.trim()
          : spec.prompt;

      const agentRow = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: spec.name,
          role: spec.role,
          is_synthesis_agent: false,
          mode: spec.mode,
          prompt,
          goal: spec.goal,
          capabilities: spec.capabilities,
          task_types: spec.task_types,
          max_tasks: spec.max_tasks,
          max_duration_seconds: spec.max_duration_seconds,
          idle_timeout_seconds: spec.idle_timeout_seconds,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: spec.personality,
          plugins: spec.plugins,
          git_branch: gitBranch,
          allowed_tools: spec.allowed_tools,
          thinking_budget: spec.thinking_budget,
          model: spec.model,
          sandbox_mode: spec.sandbox_mode,
          depends_on: null,
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();

      nameToAgentId.set(spec.name, agentRow.id);
      createdAgents.push({ id: agentRow.id, name: agentRow.name, status: agentRow.status });
    }

    for (const spec of agents) {
      if (!spec.depends_on || spec.depends_on.length === 0) {
        continue;
      }
      const agentId = nameToAgentId.get(spec.name);
      if (!agentId) {
        continue;
      }
      const deps = spec.depends_on
        .map((dep) => {
          const depId = nameToAgentId.get(dep.agent);
          if (!depId) {
            return null;
          }
          return {
            agent_id: depId,
            include: dep.include,
            condition: dep.condition ?? null,
          };
        })
        .filter(Boolean) as Array<{ agent_id: number; include: string; condition?: string | null }>;

      await db
        .updateTable("swarm_agents")
        .set({ depends_on: deps })
        .where("id", "=", agentId)
        .execute();
    }

    if (autoSynthesize) {
      const deps = createdAgents.map((agent) => ({
        agent_id: agent.id,
        include: "full",
      }));
      const synthesisAgent = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: "synthesis",
          role: "synthesis",
          is_synthesis_agent: true,
          mode: "assigned",
          prompt: synthesisPrompt ?? buildDefaultSynthesisPrompt(name),
          goal: null,
          capabilities: null,
          task_types: null,
          max_tasks: null,
          max_duration_seconds: null,
          idle_timeout_seconds: 60,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: null,
          plugins: ["dere_core"],
          git_branch: null,
          allowed_tools: null,
          thinking_budget: null,
          model: null,
          sandbox_mode: true,
          depends_on: deps,
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();
      createdAgents.push({
        id: synthesisAgent.id,
        name: synthesisAgent.name,
        status: synthesisAgent.status,
      });
    }

    if (autoSupervise) {
      const supervisorPrompt = buildSupervisorPrompt(
        name,
        agents.map((agent) => agent.name),
        supervisorWarnSeconds,
        supervisorCancelSeconds,
      );
      const supervisorAgent = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: "supervisor",
          role: "supervisor",
          is_synthesis_agent: false,
          mode: "assigned",
          prompt: supervisorPrompt,
          goal: null,
          capabilities: null,
          task_types: null,
          max_tasks: null,
          max_duration_seconds: null,
          idle_timeout_seconds: 60,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: null,
          plugins: ["dere_core"],
          git_branch: null,
          allowed_tools: null,
          thinking_budget: null,
          model: null,
          sandbox_mode: true,
          depends_on: null,
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();
      createdAgents.push({
        id: supervisorAgent.id,
        name: supervisorAgent.name,
        status: supervisorAgent.status,
      });
    }

    if (!nameToAgentId.has(MEMORY_STEWARD_NAME)) {
      const deps = createdAgents.map((agent) => ({
        agent_id: agent.id,
        include: agent.name === "synthesis" ? "full" : "summary",
      }));
      const memoryAgent = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: MEMORY_STEWARD_NAME,
          role: "generic",
          is_synthesis_agent: false,
          mode: "assigned",
          prompt: buildMemoryStewardPrompt(name),
          goal: null,
          capabilities: null,
          task_types: null,
          max_tasks: null,
          max_duration_seconds: null,
          idle_timeout_seconds: 60,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: null,
          plugins: ["dere_core"],
          git_branch: null,
          allowed_tools: null,
          thinking_budget: null,
          model: null,
          sandbox_mode: true,
          depends_on: deps,
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();
      createdAgents.push({
        id: memoryAgent.id,
        name: memoryAgent.name,
        status: memoryAgent.status,
      });
    }

    if (payload.auto_start !== false) {
      await db
        .updateTable("swarms")
        .set({ status: STATUS.RUNNING, started_at: nowDate() })
        .where("id", "=", swarm.id)
        .execute();
      void startSwarmExecution(swarm.id);
    }

    return c.json({
      swarm_id: swarm.id,
      name: swarm.name,
      status: payload.auto_start === false ? STATUS.PENDING : STATUS.RUNNING,
      agents: createdAgents,
    });
  });

  app.get("/swarm", async (c) => {
    const status = c.req.query("status");
    const limit = Math.max(1, Number(c.req.query("limit") ?? 50));

    const db = await getDb();
    let query = db
      .selectFrom("swarms as s")
      .leftJoin("swarm_agents as a", "a.swarm_id", "s.id")
      .select([
        "s.id",
        "s.name",
        "s.description",
        "s.status",
        "s.created_at",
        "s.started_at",
        "s.completed_at",
        db.fn.count("a.id").as("agent_count"),
      ])
      .groupBy("s.id")
      .orderBy("s.created_at", "desc")
      .limit(limit);

    if (status) {
      query = query.where("s.status", "=", status);
    }

    const rows = await query.execute();
    return c.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        agent_count: Number(row.agent_count ?? 0),
        created_at: row.created_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
      })),
    );
  });

  app.get("/swarm/personalities", async (c) => {
    const personalities = await listPersonalityInfos();
    return c.json({ personalities: personalities.map((p) => p.name) });
  });

  app.get("/swarm/plugins", async (c) => {
    const plugins = await listPlugins();
    return c.json({ plugins });
  });

  app.get("/swarm/:swarm_id", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const result = await getSwarmWithAgents(swarmId);
    if (!result) {
      return c.json({ error: "Swarm not found" }, 404);
    }

    const criticalPath = computeCriticalPath(result.agents);
    return c.json({
      swarm_id: result.swarm.id,
      name: result.swarm.name,
      description: result.swarm.description,
      status: result.swarm.status,
      working_dir: result.swarm.working_dir,
      git_branch_prefix: result.swarm.git_branch_prefix,
      base_branch: result.swarm.base_branch,
      agents: result.agents.map((agent) => ({
        agent_id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        output_text: agent.output_text,
        output_summary: agent.output_summary,
        error_message: agent.error_message,
        tool_count: agent.tool_count,
        started_at: agent.started_at,
        completed_at: agent.completed_at,
      })),
      created_at: result.swarm.created_at,
      started_at: result.swarm.started_at,
      completed_at: result.swarm.completed_at,
      auto_synthesize: result.swarm.auto_synthesize,
      synthesis_output: result.swarm.synthesis_output,
      synthesis_summary: result.swarm.synthesis_summary,
      critical_path: criticalPath,
    });
  });

  app.get("/swarm/:swarm_id/dag", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const format = c.req.query("format") ?? "json";
    const result = await getSwarmWithAgents(swarmId);
    if (!result) {
      return c.json({ error: "Swarm not found" }, 404);
    }

    const agents = result.agents;
    const idToAgent = new Map<number, SwarmAgentRow>();
    agents.forEach((agent) => idToAgent.set(agent.id, agent));

    const levels = new Map<number, number>();
    const computeLevel = (agent: SwarmAgentRow): number => {
      if (levels.has(agent.id)) {
        return levels.get(agent.id) as number;
      }
      if (!agent.depends_on || agent.depends_on.length === 0) {
        levels.set(agent.id, 0);
        return 0;
      }
      let maxDep = 0;
      for (const dep of agent.depends_on) {
        const depAgent = idToAgent.get(dep.agent_id);
        if (depAgent) {
          maxDep = Math.max(maxDep, computeLevel(depAgent) + 1);
        }
      }
      levels.set(agent.id, maxDep);
      return maxDep;
    };

    agents.forEach((agent) => computeLevel(agent));

    const nodes = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      level: levels.get(agent.id) ?? 0,
      started_at: agent.started_at,
      completed_at: agent.completed_at,
      error_message: agent.error_message,
    }));

    const edges: Array<{ source: string; target: string; include_mode: string }> = [];
    for (const agent of agents) {
      if (!agent.depends_on) {
        continue;
      }
      for (const dep of agent.depends_on) {
        const depAgent = idToAgent.get(dep.agent_id);
        if (!depAgent) {
          continue;
        }
        edges.push({
          source: depAgent.name,
          target: agent.name,
          include_mode: dep.include ?? "summary",
        });
      }
    }

    if (format === "dot") {
      const lines = [
        `digraph "${result.swarm.name}" {`,
        "  rankdir=LR;",
        "  node [shape=box, style=rounded];",
        "",
      ];
      const colors: Record<string, string> = {
        pending: "gray",
        running: "dodgerblue",
        completed: "green",
        failed: "red",
        cancelled: "orange",
        skipped: "lightgray",
      };
      for (const node of nodes) {
        const color = colors[node.status] ?? "gray";
        const label = `${node.name}\\n[${node.status}]`;
        lines.push(`  "${node.name}" [label="${label}", color=${color}, style=rounded];`);
      }
      lines.push("");
      for (const edge of edges) {
        const style = edge.include_mode === "none" ? "dashed" : "solid";
        const label = edge.include_mode === "summary" ? "" : ` [${edge.include_mode}]`;
        lines.push(`  "${edge.source}" -> "${edge.target}" [style=${style}, label="${label}"];`);
      }
      lines.push("}");
      return new Response(lines.join("\n"), { headers: { "content-type": "text/vnd.graphviz" } });
    }

    return c.json({
      swarm_id: result.swarm.id,
      name: result.swarm.name,
      status: result.swarm.status,
      nodes,
      edges,
    });
  });

  app.post("/swarm/:swarm_id/start", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const db = await getDb();
    const swarm = await db
      .selectFrom("swarms")
      .selectAll()
      .where("id", "=", swarmId)
      .executeTakeFirst();
    if (!swarm) {
      return c.json({ error: "Swarm not found" }, 404);
    }
    if (swarm.status !== STATUS.PENDING) {
      return c.json({ error: "Swarm is not in pending state" }, 400);
    }

    await db
      .updateTable("swarms")
      .set({ status: STATUS.RUNNING, started_at: nowDate() })
      .where("id", "=", swarmId)
      .execute();

    if (swarm.git_branch_prefix) {
      const agents = await db
        .selectFrom("swarm_agents")
        .select(["git_branch"])
        .where("swarm_id", "=", swarmId)
        .execute();
      for (const agent of agents) {
        if (!agent.git_branch) {
          continue;
        }
        try {
          await createBranch(swarm.working_dir, agent.git_branch, swarm.base_branch ?? "HEAD");
        } catch {
          // ignore git errors
        }
      }
    }

    void startSwarmExecution(swarmId);
    return c.json({ status: "started", swarm_id: swarmId });
  });

  app.post("/swarm/:swarm_id/resume", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const fromAgents = Array.isArray(payload?.from_agents) ? payload.from_agents.map(String) : null;
    const resetFailed = payload?.reset_failed !== false;

    const db = await getDb();
    const agents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    const targets = agents.filter((agent) => {
      if (fromAgents && fromAgents.length > 0) {
        return fromAgents.includes(agent.name);
      }
      if (resetFailed) {
        return agent.status === STATUS.FAILED || agent.status === STATUS.CANCELLED;
      }
      return agent.status === STATUS.FAILED;
    });

    for (const agent of targets) {
      await db
        .updateTable("swarm_agents")
        .set({
          status: STATUS.PENDING,
          error_message: null,
          output_text: null,
          output_summary: null,
          completed_at: null,
          started_at: null,
        })
        .where("id", "=", agent.id)
        .execute();
    }

    await db
      .updateTable("swarms")
      .set({ status: STATUS.RUNNING, completed_at: null })
      .where("id", "=", swarmId)
      .execute();

    void startSwarmExecution(swarmId);
    return c.json({ status: "resumed", swarm_id: swarmId });
  });

  app.post("/swarm/:swarm_id/wait", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const agentNames = Array.isArray(payload?.agent_names) ? payload.agent_names.map(String) : null;
    const timeoutSeconds =
      typeof payload?.timeout_seconds === "number" ? payload.timeout_seconds : null;

    const db = await getDb();
    const agents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    const targets =
      agentNames && agentNames.length > 0
        ? agents.filter((agent) => agentNames.includes(agent.name))
        : agents;

    const promises = targets.map((agent) => getCompletionSignal(agent.id).promise);
    let timedOut = false;
    if (timeoutSeconds && timeoutSeconds > 0) {
      await Promise.race([
        Promise.all(promises),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutSeconds * 1000),
        ),
      ]);
    } else {
      await Promise.all(promises);
    }

    if (timedOut) {
      return c.json({ error: "Timeout waiting for agents" }, 408);
    }

    const updatedAgents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    const selected =
      agentNames && agentNames.length > 0
        ? updatedAgents.filter((agent) => agentNames.includes(agent.name))
        : updatedAgents;

    return c.json(
      selected.map((agent) => ({
        agent_id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        output_text: agent.output_text,
        output_summary: agent.output_summary,
        error_message: agent.error_message,
        tool_count: agent.tool_count,
        started_at: agent.started_at,
        completed_at: agent.completed_at,
      })),
    );
  });

  app.get("/swarm/:swarm_id/agent/:agent_name", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const agentName = c.req.param("agent_name");
    if (!Number.isFinite(swarmId) || !agentName) {
      return c.json({ error: "Invalid swarm_id or agent_name" }, 400);
    }

    const db = await getDb();
    const agent = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("name", "=", agentName)
      .executeTakeFirst();
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({
      agent_id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      output_text: agent.output_text,
      output_summary: agent.output_summary,
      error_message: agent.error_message,
      tool_count: agent.tool_count,
      started_at: agent.started_at,
      completed_at: agent.completed_at,
    });
  });

  app.post("/swarm/:swarm_id/cancel", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const run = swarmRuns.get(swarmId);
    if (run) {
      run.cancelled = true;
    }

    const db = await getDb();
    await db
      .updateTable("swarms")
      .set({ status: STATUS.CANCELLED, completed_at: nowDate() })
      .where("id", "=", swarmId)
      .execute();

    await db
      .updateTable("swarm_agents")
      .set({ status: STATUS.CANCELLED, completed_at: nowDate() })
      .where("swarm_id", "=", swarmId)
      .where("status", "in", [STATUS.PENDING, STATUS.RUNNING])
      .execute();

    return c.json({ status: "cancelled", swarm_id: swarmId });
  });

  app.post("/swarm/:swarm_id/merge", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const targetBranch =
      typeof payload?.target_branch === "string" ? payload.target_branch : "main";
    const strategy = typeof payload?.strategy === "string" ? payload.strategy : "sequential";

    const db = await getDb();
    const swarm = await db
      .selectFrom("swarms")
      .selectAll()
      .where("id", "=", swarmId)
      .executeTakeFirst();
    if (!swarm) {
      return c.json({ error: "Swarm not found" }, 404);
    }

    const agents = await db
      .selectFrom("swarm_agents")
      .select(["git_branch", "name", "status"])
      .where("swarm_id", "=", swarmId)
      .execute();

    const completedAgents = agents.filter(
      (agent) => agent.git_branch && agent.status === STATUS.COMPLETED,
    );
    const merged: string[] = [];
    const failed: string[] = [];
    const conflicts: string[] = [];

    for (const agent of completedAgents) {
      try {
        const result = await mergeBranch(
          swarm.working_dir,
          agent.git_branch as string,
          targetBranch,
          strategy === "sequential",
          `Merge swarm agent '${agent.name}' (${swarm.name})`,
        );
        if (result.success) {
          merged.push(agent.git_branch as string);
        } else {
          failed.push(agent.git_branch as string);
          if (result.error && result.error.includes("conflict")) {
            conflicts.push(agent.git_branch as string);
          }
        }
      } catch {
        failed.push(agent.git_branch as string);
      }
    }

    return c.json({
      success: failed.length === 0,
      merged_branches: merged,
      failed_branches: failed,
      conflicts,
      error: failed.length > 0 ? "Some branches failed to merge" : null,
    });
  });

  app.get("/swarm/:swarm_id/scratchpad", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const prefix = c.req.query("prefix");
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const db = await getDb();
    let query = db.selectFrom("swarm_scratchpad").selectAll().where("swarm_id", "=", swarmId);
    if (prefix) {
      query = query.where("key", "like", `${prefix}%`);
    }

    const entries = await query.orderBy("key", "asc").execute();
    return c.json(
      entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        set_by_agent_id: entry.set_by_agent_id,
        set_by_agent_name: entry.set_by_agent_name,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      })),
    );
  });

  app.get("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const db = await getDb();
    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();
    if (!entry) {
      return c.json({ error: `Key '${key}' not found in swarm ${swarmId}` }, 404);
    }

    return c.json({
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.set_by_agent_id,
      set_by_agent_name: entry.set_by_agent_name,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  });

  app.put("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const db = await getDb();
    const existing = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();

    const now = nowDate();
    if (existing) {
      await db
        .updateTable("swarm_scratchpad")
        .set({
          value: payload.value ?? null,
          set_by_agent_id: typeof payload.agent_id === "number" ? payload.agent_id : null,
          set_by_agent_name: typeof payload.agent_name === "string" ? payload.agent_name : null,
          updated_at: now,
        })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await db
        .insertInto("swarm_scratchpad")
        .values({
          swarm_id: swarmId,
          key,
          value: payload.value ?? null,
          set_by_agent_id: typeof payload.agent_id === "number" ? payload.agent_id : null,
          set_by_agent_name: typeof payload.agent_name === "string" ? payload.agent_name : null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirstOrThrow();

    return c.json({
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.set_by_agent_id,
      set_by_agent_name: entry.set_by_agent_name,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  });

  app.delete("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const db = await getDb();
    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();

    if (!entry) {
      return c.json({ error: `Key '${key}' not found in swarm ${swarmId}` }, 404);
    }

    await db.deleteFrom("swarm_scratchpad").where("id", "=", entry.id).execute();
    return c.json({ deleted: true, key });
  });
}
