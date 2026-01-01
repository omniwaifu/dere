import { createBunWebSocket } from "hono/bun";
import type { Hono } from "hono";
import { sql } from "kysely";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  Query,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

import { getDb } from "./db.js";
import { buildSessionContextXml } from "./prompt-context.js";
import { extractCitedEntityUuids } from "./context-tracking.js";
import { trackEntityCitations } from "./graph-store.js";
import { bufferInteractionStimulus } from "./emotion-runtime.js";
import { processCuriosityTriggers } from "./ambient-triggers/index.js";

const { upgradeWebSocket, websocket } = createBunWebSocket();

type SessionConfig = {
  working_dir: string;
  output_style?: string;
  personality?: string | string[];
  model?: string | null;
  user_id?: string | null;
  allowed_tools?: string[] | null;
  include_context?: boolean;
  enable_streaming?: boolean;
  thinking_budget?: number | null;
  sandbox_mode?: boolean;
  sandbox_mount_type?: string;
  sandbox_settings?: Record<string, unknown> | null;
  sandbox_network_mode?: string;
  mission_id?: number | null;
  session_name?: string | null;
  auto_approve?: boolean;
  lean_mode?: boolean;
  swarm_agent_id?: number | null;
  plugins?: string[] | null;
  env?: Record<string, string> | null;
  output_format?: Record<string, unknown> | null;
};

type PendingPermission = {
  resolve: (value: PermissionResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  input: Record<string, unknown>;
};

type WsState = {
  localSeq: number;
  sessionId: number | null;
  config: SessionConfig | null;
  currentQuery: Query | null;
  queryTask: Promise<void> | null;
  pendingPermissions: Map<string, PendingPermission>;
  cancelRequested: boolean;
};

type StreamEvent = {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  seq: number;
};

type SessionEventLog = {
  seq: number;
  events: StreamEvent[];
};

const MAX_EVENT_LOG = 500;
const sessionEventLogs = new Map<number, SessionEventLog>();

function nowDate(): Date {
  return new Date();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function getSessionLog(sessionId: number): SessionEventLog {
  const existing = sessionEventLogs.get(sessionId);
  if (existing) {
    return existing;
  }
  const created: SessionEventLog = { seq: 0, events: [] };
  sessionEventLogs.set(sessionId, created);
  return created;
}

function nextSeq(state: WsState): number {
  if (state.sessionId) {
    const log = getSessionLog(state.sessionId);
    log.seq += 1;
    return log.seq;
  }
  state.localSeq += 1;
  return state.localSeq;
}

function recordEvent(sessionId: number, payload: StreamEvent): void {
  const log = getSessionLog(sessionId);
  log.events.push(payload);
  if (log.events.length > MAX_EVENT_LOG) {
    log.events = log.events.slice(-MAX_EVENT_LOG);
  }
}

function sendEvent(
  ws: { send: (data: string) => void },
  state: WsState,
  type: string,
  data: Record<string, unknown>,
) {
  const payload: StreamEvent = {
    type,
    data,
    timestamp: Date.now() / 1000,
    seq: nextSeq(state),
  };
  ws.send(JSON.stringify(payload));
  if (state.sessionId) {
    recordEvent(state.sessionId, payload);
  }
}

function sendError(
  ws: { send: (data: string) => void },
  state: WsState,
  message: string,
  recoverable = true,
) {
  sendEvent(ws, state, "error", { message, recoverable });
}

function replayEvents(
  ws: { send: (data: string) => void },
  sessionId: number,
  lastSeq: number | null,
) {
  if (lastSeq === null) {
    return;
  }

  const log = sessionEventLogs.get(sessionId);
  if (!log || log.events.length === 0) {
    return;
  }
  for (const event of log.events) {
    if (event.seq > lastSeq && event.type !== "session_ready") {
      ws.send(JSON.stringify(event));
    }
  }
}

function normalizeConfig(raw: Record<string, unknown>): SessionConfig | null {
  const workingDir = raw.working_dir;
  if (typeof workingDir !== "string" || !workingDir.trim()) {
    return null;
  }

  const toStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) {
      return null;
    }
    const items = value.filter((item) => typeof item === "string") as string[];
    return items;
  };

  return {
    working_dir: workingDir,
    output_style: typeof raw.output_style === "string" ? raw.output_style : "default",
    personality:
      typeof raw.personality === "string" || Array.isArray(raw.personality)
        ? (raw.personality as string | string[])
        : "",
    model: typeof raw.model === "string" ? raw.model : null,
    user_id: typeof raw.user_id === "string" ? raw.user_id : null,
    allowed_tools: toStringArray(raw.allowed_tools),
    include_context: typeof raw.include_context === "boolean" ? raw.include_context : true,
    enable_streaming: typeof raw.enable_streaming === "boolean" ? raw.enable_streaming : false,
    thinking_budget: typeof raw.thinking_budget === "number" ? raw.thinking_budget : null,
    sandbox_mode: typeof raw.sandbox_mode === "boolean" ? raw.sandbox_mode : false,
    sandbox_mount_type:
      typeof raw.sandbox_mount_type === "string" ? raw.sandbox_mount_type : "copy",
    sandbox_settings:
      raw.sandbox_settings && typeof raw.sandbox_settings === "object"
        ? (raw.sandbox_settings as Record<string, unknown>)
        : null,
    sandbox_network_mode:
      typeof raw.sandbox_network_mode === "string" ? raw.sandbox_network_mode : "bridge",
    mission_id: typeof raw.mission_id === "number" ? raw.mission_id : null,
    session_name: typeof raw.session_name === "string" ? raw.session_name : null,
    auto_approve: typeof raw.auto_approve === "boolean" ? raw.auto_approve : false,
    lean_mode: typeof raw.lean_mode === "boolean" ? raw.lean_mode : false,
    swarm_agent_id: typeof raw.swarm_agent_id === "number" ? raw.swarm_agent_id : null,
    plugins: toStringArray(raw.plugins),
    env: raw.env && typeof raw.env === "object" ? (raw.env as Record<string, string>) : null,
    output_format:
      raw.output_format && typeof raw.output_format === "object"
        ? (raw.output_format as Record<string, unknown>)
        : null,
  };
}

function resolvePersonalityName(personality: string | string[] | undefined): string | null {
  if (!personality) {
    return null;
  }
  if (Array.isArray(personality)) {
    return personality[0] ?? null;
  }
  return personality;
}

async function createSession(config: SessionConfig): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const inserted = await db
    .insertInto("sessions")
    .values({
      name: config.session_name ?? null,
      working_dir: config.working_dir,
      start_time: nowSeconds(),
      personality: resolvePersonalityName(config.personality),
      medium: "agent_api",
      user_id: config.user_id ?? null,
      thinking_budget: config.thinking_budget ?? null,
      sandbox_mode: Boolean(config.sandbox_mode),
      sandbox_settings: config.sandbox_settings ?? null,
      mission_id: config.mission_id ?? null,
      last_activity: now,
      is_locked: false,
      continued_from: null,
      project_type: null,
      claude_session_id: null,
      created_at: now,
      summary: null,
      summary_updated_at: null,
      end_time: null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return inserted.id;
}

async function loadSessionConfig(sessionId: number): Promise<SessionConfig | null> {
  const db = await getDb();
  const row = await db
    .selectFrom("sessions")
    .select([
      "working_dir",
      "personality",
      "user_id",
      "thinking_budget",
      "sandbox_mode",
      "sandbox_settings",
      "mission_id",
      "name",
    ])
    .where("id", "=", sessionId)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    working_dir: row.working_dir,
    output_style: "default",
    personality: row.personality ?? "",
    model: null,
    user_id: row.user_id ?? null,
    allowed_tools: null,
    include_context: true,
    enable_streaming: false,
    thinking_budget: row.thinking_budget ?? null,
    sandbox_mode: row.sandbox_mode,
    sandbox_mount_type: "copy",
    sandbox_settings: row.sandbox_settings ?? null,
    sandbox_network_mode: "bridge",
    mission_id: row.mission_id ?? null,
    session_name: row.name ?? null,
    auto_approve: false,
    lean_mode: false,
    swarm_agent_id: null,
    plugins: null,
    env: null,
    output_format: null,
  };
}

function resolvePluginPaths(
  plugins: string[] | null | undefined,
): Array<{ type: "local"; path: string }> | undefined {
  const resolved = plugins ?? ["dere_core"];
  if (resolved.length === 0) {
    return undefined;
  }
  const base = `${process.cwd()}/src/dere_plugins`;
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

function extractAssistantBlocks(message: SDKAssistantMessage) {
  const content = (message.message as { content?: unknown }).content;
  const blocks: Array<Record<string, unknown>> = [];
  const toolNames: string[] = [];

  if (!content) {
    return { blocks, toolNames };
  }

  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
    return { blocks, toolNames };
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        if (typeof block === "string") {
          blocks.push({ type: "text", text: block });
        }
        continue;
      }
      const record = block as Record<string, unknown>;
      const type = record.type;
      if (type === "text") {
        const text = typeof record.text === "string" ? record.text : collectText(record);
        if (text) {
          blocks.push({ type: "text", text });
        }
        continue;
      }
      if (type === "thinking") {
        const text = typeof record.thinking === "string" ? record.thinking : collectText(record);
        if (text) {
          blocks.push({ type: "thinking", text });
        }
        continue;
      }
      if (type === "tool_use") {
        const name = typeof record.name === "string" ? record.name : "";
        if (name) {
          toolNames.push(name);
        }
        blocks.push({
          type: "tool_use",
          id: record.id,
          name,
          input: record.input,
        });
        continue;
      }
      if (type === "tool_result") {
        blocks.push({
          type: "tool_result",
          tool_use_id: record.tool_use_id,
          name: record.name,
          output: collectText(record.content ?? record),
          is_error: Boolean(record.is_error),
        });
        continue;
      }
      const fallbackText = collectText(record);
      if (fallbackText) {
        blocks.push({ type: "text", text: fallbackText });
      }
    }
  }

  return { blocks, toolNames };
}

async function persistAssistantMessage(args: {
  sessionId: number;
  blocks: Array<Record<string, unknown>>;
  responseText: string;
  toolNames: string[];
  toolCount: number;
  personality: string | null;
  userId: string | null;
  metrics: { ttftMs: number | null; responseMs: number | null; thinkingMs: number | null };
}): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const conv = await db
    .insertInto("conversations")
    .values({
      session_id: args.sessionId,
      prompt: args.responseText,
      message_type: "assistant",
      personality: args.personality,
      timestamp: nowSeconds(),
      medium: "agent_api",
      user_id: args.userId,
      ttft_ms: args.metrics.ttftMs,
      response_ms: args.metrics.responseMs,
      thinking_ms: args.metrics.thinkingMs,
      tool_uses: args.toolCount,
      tool_names: args.toolNames.length > 0 ? args.toolNames : null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  let ordinal = 0;
  for (const block of args.blocks) {
    const type = block.type;
    if (type === "text" || type === "thinking") {
      const text = typeof block.text === "string" ? block.text : "";
      if (!text) {
        continue;
      }
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conv.id,
          ordinal,
          block_type: type,
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

    if (type === "tool_use") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conv.id,
          ordinal,
          block_type: "tool_use",
          tool_use_id: typeof block.id === "string" ? block.id : null,
          tool_name: typeof block.name === "string" ? block.name : null,
          tool_input:
            block.input && typeof block.input === "object"
              ? (block.input as Record<string, unknown>)
              : null,
          text: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (type === "tool_result") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conv.id,
          ordinal,
          block_type: "tool_result",
          tool_use_id: typeof block.tool_use_id === "string" ? block.tool_use_id : null,
          tool_name: typeof block.name === "string" ? block.name : null,
          tool_input: null,
          text: typeof block.output === "string" ? block.output : "",
          is_error: Boolean(block.is_error),
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
    }
  }

  return conv.id;
}

async function trackCitedEntities(sessionId: number, responseText: string): Promise<void> {
  if (!responseText.trim()) {
    return;
  }

  const db = await getDb();
  const cache = await db
    .selectFrom("context_cache")
    .select(["context_metadata"])
    .where("session_id", "=", sessionId)
    .executeTakeFirst();

  if (!cache || !cache.context_metadata || typeof cache.context_metadata !== "object") {
    return;
  }

  const cited = extractCitedEntityUuids(
    responseText,
    cache.context_metadata as Record<string, unknown>,
  );
  if (cited.length === 0) {
    return;
  }

  await trackEntityCitations(cited);
}

async function dequeueShareableFinding(
  sessionId: number,
  userId: string | null,
): Promise<string | null> {
  if (!userId) {
    return null;
  }

  try {
    const db = await getDb();
    const surfacedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const finding = await db
      .selectFrom("exploration_findings as ef")
      .select(["ef.id", "ef.finding", "ef.share_message"])
      .where("ef.worth_sharing", "=", true)
      .where("ef.confidence", ">=", 0.8)
      .where("ef.user_id", "=", userId)
      .where(
        sql`not exists (select 1 from surfaced_findings sf where sf.finding_id = ef.id and sf.surfaced_at > ${surfacedCutoff} and sf.session_id = ${sessionId})`,
      )
      .orderBy("ef.created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!finding || !finding.id) {
      return null;
    }

    await db
      .insertInto("surfaced_findings")
      .values({
        finding_id: finding.id,
        session_id: sessionId,
        surfaced_at: nowDate(),
      })
      .execute();

    const text = finding.share_message ?? finding.finding ?? "";
    return text.trim() ? text : null;
  } catch (error) {
    console.log(`[ambient] failed to surface exploration finding: ${String(error)}`);
    return null;
  }
}

async function persistUserMessage(
  sessionId: number,
  prompt: string,
  config: SessionConfig,
): Promise<void> {
  const db = await getDb();
  const now = nowDate();
  const conv = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt,
      message_type: "user",
      personality: resolvePersonalityName(config.personality),
      timestamp: nowSeconds(),
      medium: "agent_api",
      user_id: config.user_id ?? null,
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
        conversation_id: conv.id,
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
}

export function registerAgentWebSocket(app: Hono) {
  app.get(
    "/agent/ws",
    upgradeWebSocket(() => {
      const state: WsState = {
        localSeq: 0,
        sessionId: null,
        config: null,
        currentQuery: null,
        queryTask: null,
        pendingPermissions: new Map(),
        cancelRequested: false,
      };

      const onMessage = async (event: MessageEvent, ws: { send: (data: string) => void }) => {
        let message: Record<string, unknown> | null = null;
        try {
          const raw =
            typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf-8");
          message = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          sendError(ws, state, "Invalid JSON payload", true);
          return;
        }

        const type = message.type;
        if (typeof type !== "string") {
          sendError(ws, state, "Missing message type", true);
          return;
        }

        if (type === "new_session") {
          const configRaw = message.config;
          if (!configRaw || typeof configRaw !== "object") {
            sendError(ws, state, "new_session requires config", true);
            return;
          }
          const config = normalizeConfig(configRaw as Record<string, unknown>);
          if (!config) {
            sendError(ws, state, "Invalid session config", true);
            return;
          }
          try {
            const sessionId = await createSession(config);
            sessionEventLogs.set(sessionId, { seq: 0, events: [] });
            state.sessionId = sessionId;
            state.config = config;
            sendEvent(ws, state, "session_ready", {
              session_id: sessionId,
              config,
              is_locked: false,
              name: config.session_name ?? null,
            });
          } catch (error) {
            sendError(ws, state, `Failed to create session: ${String(error)}`, true);
          }
          return;
        }

        if (type === "resume_session") {
          const sessionId = typeof message.session_id === "number" ? message.session_id : null;
          const lastSeq = typeof message.last_seq === "number" ? message.last_seq : null;
          if (!sessionId) {
            sendError(ws, state, "resume_session requires session_id", true);
            return;
          }
          const config = await loadSessionConfig(sessionId);
          if (!config) {
            sendError(ws, state, `Session ${sessionId} not found`, true);
            return;
          }
          state.sessionId = sessionId;
          state.config = config;
          sendEvent(ws, state, "session_ready", {
            session_id: sessionId,
            config,
            is_locked: false,
            name: config.session_name ?? null,
          });
          replayEvents(ws, sessionId, lastSeq);
          return;
        }

        if (type === "update_config") {
          const configRaw = message.config;
          if (!configRaw || typeof configRaw !== "object") {
            sendError(ws, state, "update_config requires config", true);
            return;
          }
          if (state.queryTask) {
            sendError(ws, state, "Cannot update config while query is running", true);
            return;
          }
          const config = normalizeConfig(configRaw as Record<string, unknown>);
          if (!config) {
            sendError(ws, state, "Invalid session config", true);
            return;
          }
          state.config = config;
          if (state.sessionId) {
            const db = await getDb();
            await db
              .updateTable("sessions")
              .set({
                working_dir: config.working_dir,
                personality: resolvePersonalityName(config.personality),
                user_id: config.user_id ?? null,
                thinking_budget: config.thinking_budget ?? null,
                sandbox_mode: Boolean(config.sandbox_mode),
                sandbox_settings: config.sandbox_settings ?? null,
                mission_id: config.mission_id ?? null,
                name: config.session_name ?? null,
                last_activity: nowDate(),
              })
              .where("id", "=", state.sessionId)
              .execute();
            sendEvent(ws, state, "session_ready", {
              session_id: state.sessionId,
              config,
              is_locked: false,
              name: config.session_name ?? null,
            });
          }
          return;
        }

        if (type === "permission_response") {
          const requestId = typeof message.request_id === "string" ? message.request_id : null;
          if (!requestId) {
            return;
          }
          const allowed = Boolean(message.allowed);
          const denyMessage = typeof message.deny_message === "string" ? message.deny_message : "";
          const pending = state.pendingPermissions.get(requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            state.pendingPermissions.delete(requestId);
            if (allowed) {
              pending.resolve({ behavior: "allow", updatedInput: pending.input });
            } else {
              pending.resolve({
                behavior: "deny",
                message: denyMessage || "Permission denied",
                interrupt: true,
              });
            }
          }
          return;
        }

        if (type === "ping") {
          ws.send(
            JSON.stringify({
              type: "pong",
              timestamp: Date.now() / 1000,
            }),
          );
          return;
        }

        if (type === "cancel") {
          if (state.currentQuery) {
            state.cancelRequested = true;
            void state.currentQuery.interrupt();
            sendEvent(ws, state, "cancelled", { message: "Query cancelled by user" });
          } else {
            sendError(ws, state, "No active query to cancel", true);
          }
          return;
        }

        if (type === "query") {
          const prompt = typeof message.prompt === "string" ? message.prompt : null;
          if (!prompt) {
            sendError(ws, state, "query requires prompt", true);
            return;
          }
          if (!state.sessionId || !state.config) {
            sendError(ws, state, "No active session", true);
            return;
          }
          if (state.queryTask) {
            sendError(ws, state, "Query already in progress", true);
            return;
          }

          const sessionId = state.sessionId;
          const config = state.config;
          state.cancelRequested = false;

          state.queryTask = (async () => {
            try {
              await persistUserMessage(sessionId, prompt, config);
            } catch (error) {
              sendError(ws, state, `Failed to persist user message: ${String(error)}`, true);
              return;
            }

            let promptForModel = prompt;
            const findingText = await dequeueShareableFinding(sessionId, config.user_id ?? null);
            if (findingText) {
              promptForModel = `${prompt}\n\nAssistant context (ambient exploration; share if relevant):\n${findingText}`;
            }

            let contextXml = "";
            try {
              contextXml = await buildSessionContextXml({
                sessionId,
                personalityOverride: resolvePersonalityName(config.personality),
                includeContext: config.include_context && !config.lean_mode,
              });
            } catch {
              contextXml = "";
            }

            const systemPrompt = contextXml || undefined;
            const plugins = resolvePluginPaths(config.plugins);
            const toolNames = new Set<string>();
            const blocks: Array<Record<string, unknown>> = [];
            let responseText = "";
            let toolCount = 0;
            let structuredOutput: unknown = null;
            let firstTokenTime: number | null = null;
            const startTime = performance.now();

            const canUseTool = async (
              toolName: string,
              input: Record<string, unknown>,
              options: { toolUseID: string; suggestions?: unknown },
            ): Promise<PermissionResult> => {
              if (config.auto_approve) {
                return { behavior: "allow", updatedInput: input };
              }

              const requestId = crypto.randomUUID();
              sendEvent(ws, state, "permission_request", {
                request_id: requestId,
                tool_name: toolName,
                tool_input: input,
              });

              return await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                  state.pendingPermissions.delete(requestId);
                  resolve({
                    behavior: "deny",
                    message: "Permission request timed out",
                    interrupt: true,
                  });
                }, 300_000);
                state.pendingPermissions.set(requestId, { resolve, timeout, input });
              });
            };

            try {
              const options: Record<string, unknown> = {
                cwd: config.working_dir,
                model: config.model ?? undefined,
                includePartialMessages: Boolean(config.enable_streaming),
                permissionMode: config.auto_approve ? "bypassPermissions" : "default",
                allowDangerouslySkipPermissions: Boolean(config.auto_approve),
                persistSession: false,
                settingSources: ["project"],
              };

              if (config.allowed_tools && config.allowed_tools.length > 0) {
                options.tools = config.allowed_tools;
                options.allowedTools = config.allowed_tools;
              }
              if (plugins && plugins.length > 0) {
                options.plugins = plugins;
              }
              if (systemPrompt) {
                options.systemPrompt = {
                  type: "preset",
                  preset: "claude_code",
                  append: systemPrompt,
                };
              }
              if (config.output_format) {
                options.outputFormat = config.output_format;
              }
              const env = { ...(config.env ?? {}) } as Record<string, string>;
              if (!("DERE_SESSION_ID" in env)) {
                env.DERE_SESSION_ID = String(sessionId);
              }
              if (Object.keys(env).length > 0) {
                options.env = env;
              }
              if (!config.auto_approve) {
                options.canUseTool = canUseTool;
              }
              if (config.sandbox_mode) {
                options.sandbox = {
                  ...(config.sandbox_settings ?? {}),
                  enabled: true,
                };
              } else {
                options.sandbox = { enabled: false };
              }

              const q = query({ prompt: promptForModel, options });
              state.currentQuery = q;

              for await (const message of q) {
                if (message.type === "stream_event") {
                  const streamEvent = message as SDKPartialAssistantMessage;
                  const raw = streamEvent.event as Record<string, unknown>;
                  if (raw.type === "content_block_delta") {
                    const delta = raw.delta as Record<string, unknown>;
                    if (delta.type === "text_delta" && typeof delta.text === "string") {
                      if (firstTokenTime === null) {
                        firstTokenTime = performance.now();
                      }
                      sendEvent(ws, state, "text", { text: delta.text });
                    } else if (
                      delta.type === "thinking_delta" &&
                      typeof delta.thinking === "string"
                    ) {
                      if (firstTokenTime === null) {
                        firstTokenTime = performance.now();
                      }
                      sendEvent(ws, state, "thinking", { text: delta.thinking });
                    }
                  }
                  continue;
                }

                if (message.type === "assistant") {
                  const { blocks: assistantBlocks, toolNames: assistantTools } =
                    extractAssistantBlocks(message as SDKAssistantMessage);
                  if (assistantBlocks.length > 0) {
                    blocks.push(...assistantBlocks);
                  }
                  for (const name of assistantTools) {
                    toolNames.add(name);
                  }
                  for (const block of assistantBlocks) {
                    if (block.type === "tool_use") {
                      toolCount += 1;
                      sendEvent(ws, state, "tool_use", {
                        id: block.id ?? null,
                        name: block.name ?? null,
                        input: block.input ?? {},
                      });
                    }
                    if (block.type === "tool_result") {
                      sendEvent(ws, state, "tool_result", {
                        tool_use_id: block.tool_use_id ?? null,
                        name: block.name ?? null,
                        output: block.output ?? "",
                        is_error: Boolean(block.is_error),
                      });
                    }
                  }
                  continue;
                }

                if (message.type === "result") {
                  const resultMessage = message as SDKResultMessage;
                  if ("structured_output" in resultMessage && resultMessage.structured_output) {
                    structuredOutput = resultMessage.structured_output;
                  }
                  if ("result" in resultMessage && typeof resultMessage.result === "string") {
                    responseText = resultMessage.result;
                  }
                }
              }
            } catch (error) {
              if (!state.cancelRequested) {
                sendError(ws, state, `Query failed: ${String(error)}`, true);
              }
              return;
            } finally {
              state.currentQuery = null;
            }

            if (state.cancelRequested) {
              return;
            }

            if (!responseText && blocks.length > 0) {
              responseText = blocks
                .filter((block) => block.type === "text")
                .map((block) => (typeof block.text === "string" ? block.text : ""))
                .join("");
            }

            const endTime = performance.now();
            const responseMs = endTime - startTime;
            const ttftMs = firstTokenTime ? firstTokenTime - startTime : null;
            sendEvent(ws, state, "done", {
              response_text: responseText,
              tool_count: toolCount,
              timings: {
                time_to_first_token: ttftMs ? Math.round(ttftMs) : 0,
                response_time: Math.round(responseMs),
              },
              structured_output: structuredOutput ?? undefined,
            });

            const assistantConversationId = await persistAssistantMessage({
              sessionId,
              blocks,
              responseText,
              toolNames: Array.from(toolNames),
              toolCount,
              personality: resolvePersonalityName(config.personality),
              userId: config.user_id ?? null,
              metrics: {
                ttftMs: ttftMs ? Math.round(ttftMs) : null,
                responseMs: Math.round(responseMs),
                thinkingMs: null,
              },
            });

            void trackCitedEntities(sessionId, responseText).catch((error) => {
              console.log(`[kg] citation tracking failed: ${String(error)}`);
            });

            if (assistantConversationId) {
              const db = await getDb();
              void processCuriosityTriggers({
                db,
                prompt: responseText,
                sessionId,
                conversationId: assistantConversationId,
                userId: config.user_id ?? null,
                workingDir: config.working_dir,
                personality: resolvePersonalityName(config.personality),
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
              responseText,
              toolCount,
              personality: resolvePersonalityName(config.personality),
              workingDir: config.working_dir,
            }).catch((error) => {
              console.log(`[emotion] buffer failed: ${String(error)}`);
            });
          })()
            .catch((error) => {
              sendError(ws, state, `Query failed: ${String(error)}`, true);
            })
            .finally(() => {
              state.queryTask = null;
              state.cancelRequested = false;
            });
          return;
        }

        if (type === "close") {
          return;
        }

        sendError(ws, state, `Unknown message type: ${type}`, true);
      };

      return {
        onMessage,
        onClose: () => {
          for (const pending of state.pendingPermissions.values()) {
            clearTimeout(pending.timeout);
          }
          state.pendingPermissions.clear();
          if (state.currentQuery) {
            state.cancelRequested = true;
            void state.currentQuery.interrupt();
          }
          state.currentQuery = null;
          state.queryTask = null;
        },
      };
    }),
  );
}

export { websocket, upgradeWebSocket };
