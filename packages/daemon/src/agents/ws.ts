import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  Options as SDKOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { trackEntityCitations } from "@dere/graph";

import { getDb } from "../db.js";
import { log } from "../logger.js";
import { buildSessionContextXml } from "../context/prompt.js";
import { extractCitedEntityUuids } from "../context/tracking.js";
import { bufferInteractionStimulus } from "../emotions/runtime.js";
import {
  DockerSandboxRunner,
  type SandboxMountType,
  type SandboxNetworkMode,
} from "../sandbox/docker-runner.js";

const { upgradeWebSocket, websocket } = createBunWebSocket();

// Virtual paths (telegram://, discord://, etc.) can't be used as cwd by the SDK
// Fall back to a dedicated directory for chat mediums
const CHAT_FALLBACK_CWD = join(homedir(), ".dere", "chats");
const VIRTUAL_PATH_PATTERN = /^(telegram|discord|matrix):\/\//;

let chatFallbackInitialized = false;
async function ensureChatFallbackDir(): Promise<void> {
  if (chatFallbackInitialized) return;
  await mkdir(CHAT_FALLBACK_CWD, { recursive: true });
  chatFallbackInitialized = true;
}

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
  sandbox_mount_type?: SandboxMountType;
  sandbox_settings?: Record<string, unknown> | null;
  sandbox_network_mode?: SandboxNetworkMode;
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
  isLocked: boolean;
  claudeSessionId: string | null;
  currentQuery: Query | null;
  currentSandbox: DockerSandboxRunner | null;
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

const SANDBOX_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SANDBOX_CLEANUP_INTERVAL_MS = 60 * 1000;

type SandboxSession = {
  sessionId: number;
  runner: DockerSandboxRunner;
  lastActivity: number;
  createdAt: number;
  claudeSessionId: string | null;
  isLocked: boolean;
  config: SessionConfig;
  activeQueries: number; // Prevent cleanup while queries are running
};

const sandboxSessions = new Map<number, SandboxSession>();
let sandboxCleanupStarted = false;

function nowDate(): Date {
  return new Date();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function nowMs(): number {
  return Date.now();
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeSandboxMountType(value: unknown): SandboxMountType {
  if (value === "direct" || value === "copy" || value === "none") {
    return value;
  }
  return "copy";
}

function normalizeSandboxNetworkMode(value: unknown): SandboxNetworkMode {
  return value === "host" ? "host" : "bridge";
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

async function updateClaudeSessionId(sessionId: number, claudeSessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("sessions")
    .set({ claude_session_id: claudeSessionId })
    .where("id", "=", sessionId)
    .execute();
}

async function lockSandboxSession(sessionId: number): Promise<void> {
  const db = await getDb();
  await db.updateTable("sessions").set({ is_locked: true }).where("id", "=", sessionId).execute();
}

async function ensureSandboxSession(args: {
  sessionId: number;
  config: SessionConfig;
  claudeSessionId: string | null;
  systemPrompt: string;
}): Promise<SandboxSession> {
  const existing = sandboxSessions.get(args.sessionId);
  if (existing && !existing.isLocked) {
    existing.config = args.config;
    existing.lastActivity = nowMs();
    return existing;
  }

  if (existing && existing.isLocked) {
    return existing;
  }

  const env = { ...args.config.env } as Record<string, string>;
  if (!("DERE_SESSION_ID" in env)) {
    env.DERE_SESSION_ID = String(args.sessionId);
  }

  const runner = new DockerSandboxRunner({
    workingDir: args.config.working_dir,
    outputStyle: args.config.output_style ?? "default",
    systemPrompt: args.systemPrompt,
    model: args.config.model ?? null,
    thinkingBudget: args.config.thinking_budget ?? null,
    allowedTools: args.config.allowed_tools ?? null,
    resumeSessionId: args.claudeSessionId ?? null,
    autoApprove: args.config.auto_approve ?? false,
    outputFormat: args.config.output_format ?? null,
    sandboxSettings: args.config.sandbox_settings ?? null,
    plugins: args.config.plugins ?? null,
    env,
    sandboxNetworkMode: args.config.sandbox_network_mode ?? "bridge",
    mountType: args.config.sandbox_mount_type ?? "copy",
  });

  await runner.start();

  const created: SandboxSession = {
    sessionId: args.sessionId,
    runner,
    lastActivity: nowMs(),
    createdAt: nowMs(),
    claudeSessionId: runner.claudeSessionId ?? args.claudeSessionId,
    isLocked: false,
    config: args.config,
    activeQueries: 0,
  };

  sandboxSessions.set(args.sessionId, created);

  if (runner.claudeSessionId && runner.claudeSessionId !== args.claudeSessionId) {
    await updateClaudeSessionId(args.sessionId, runner.claudeSessionId);
  }

  return created;
}

async function cleanupIdleSandboxes(): Promise<void> {
  const now = nowMs();
  for (const [sessionId, session] of sandboxSessions.entries()) {
    if (session.isLocked) {
      sandboxSessions.delete(sessionId);
      continue;
    }
    // Don't clean up sessions with active queries
    if (session.activeQueries > 0) {
      continue;
    }
    if (now - session.lastActivity < SANDBOX_IDLE_TIMEOUT_MS) {
      continue;
    }
    try {
      await session.runner.close();
    } catch {
      // ignore
    }
    session.isLocked = true;
    sandboxSessions.delete(sessionId);
    await lockSandboxSession(sessionId);
  }
}

function startSandboxCleanupLoop(): void {
  if (sandboxCleanupStarted) {
    return;
  }
  sandboxCleanupStarted = true;
  setInterval(() => {
    void cleanupIdleSandboxes();
  }, SANDBOX_CLEANUP_INTERVAL_MS);
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
    sandbox_mount_type: normalizeSandboxMountType(raw.sandbox_mount_type),
    sandbox_settings: toJsonRecord(raw.sandbox_settings),
    sandbox_network_mode: normalizeSandboxNetworkMode(raw.sandbox_network_mode),
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
      sandbox_mount_type: config.sandbox_mount_type ?? "copy",
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

type LoadedSessionState = {
  config: SessionConfig;
  isLocked: boolean;
  claudeSessionId: string | null;
  userId: string | null; // For ownership verification
};

async function loadSessionState(sessionId: number): Promise<LoadedSessionState | null> {
  const db = await getDb();
  const row = await db
    .selectFrom("sessions")
    .select([
      "working_dir",
      "personality",
      "user_id",
      "thinking_budget",
      "sandbox_mode",
      "sandbox_mount_type",
      "sandbox_settings",
      "mission_id",
      "name",
      "is_locked",
      "claude_session_id",
    ])
    .where("id", "=", sessionId)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    config: {
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
      sandbox_mount_type: normalizeSandboxMountType(row.sandbox_mount_type),
      sandbox_settings: toJsonRecord(row.sandbox_settings),
      sandbox_network_mode: "bridge",
      mission_id: row.mission_id ?? null,
      session_name: row.name ?? null,
      auto_approve: false,
      lean_mode: false,
      swarm_agent_id: null,
      plugins: null,
      env: null,
      output_format: null,
    },
    isLocked: row.is_locked,
    claudeSessionId: row.claude_session_id ?? null,
    userId: row.user_id ?? null,
  };
}

function resolvePluginPaths(
  plugins: string[] | null | undefined,
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

function extractAssistantBlocks(message: SDKAssistantMessage) {
  const content = (message.message as { content?: unknown }).content;
  const blocks: Array<Record<string, unknown>> = [];
  const toolNames: string[] = [];

  // Debug: log the raw content structure
  log.agent.debug("extractAssistantBlocks content type", { contentType: typeof content });
  if (Array.isArray(content)) {
    log.agent.debug("extractAssistantBlocks content blocks", {
      blocks: content.map((b) => {
        const record = b as Record<string, unknown>;
        return {
          type: record?.type,
          hasThinking: record && "thinking" in record,
          hasText: record && "text" in record,
          keys: record ? Object.keys(record) : [],
        };
      }),
    });
  }

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
  const timestamp = nowSeconds();

  // Use transaction to ensure conversation and blocks are persisted atomically
  return await db.transaction().execute(async (trx) => {
    const conv = await trx
      .insertInto("conversations")
      .values({
        session_id: args.sessionId,
        prompt: args.responseText,
        message_type: "assistant",
        personality: args.personality,
        timestamp,
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
        await trx
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
        await trx
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
        await trx
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
  });
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
        sql<boolean>`not exists (select 1 from surfaced_findings sf where sf.finding_id = ef.id and sf.surfaced_at > ${surfacedCutoff} and sf.session_id = ${sessionId})`,
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
    log.ambient.warn("Failed to surface exploration finding", { error: String(error) });
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
  const timestamp = nowSeconds();

  // Use transaction to ensure conversation and block are persisted atomically
  await db.transaction().execute(async (trx) => {
    const conv = await trx
      .insertInto("conversations")
      .values({
        session_id: sessionId,
        prompt,
        message_type: "user",
        personality: resolvePersonalityName(config.personality),
        timestamp,
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
      await trx
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
  });
}

export function registerAgentWebSocket(app: Hono) {
  app.get(
    "/agent/ws",
    upgradeWebSocket(() => {
      const state: WsState = {
        localSeq: 0,
        sessionId: null,
        config: null,
        isLocked: false,
        claudeSessionId: null,
        currentQuery: null,
        currentSandbox: null,
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
        log.agent.debug("WS message received", { type });
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
            state.isLocked = false;
            state.claudeSessionId = null;
            if (config.sandbox_mode) {
              const systemPrompt = await buildSessionContextXml({
                sessionId,
                personalityOverride: resolvePersonalityName(config.personality),
                includeContext: (config.include_context ?? true) && !config.lean_mode,
              });
              try {
                const sandboxSession = await ensureSandboxSession({
                  sessionId,
                  config,
                  claudeSessionId: null,
                  systemPrompt,
                });
                state.currentSandbox = sandboxSession.runner;
              } catch (error) {
                await lockSandboxSession(sessionId);
                state.isLocked = true;
                sendError(ws, state, `Failed to start sandbox: ${String(error)}`, true);
                return;
              }
            }
            sendEvent(ws, state, "session_ready", {
              session_id: sessionId,
              config,
              is_locked: state.isLocked,
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
          const requestingUserId = typeof message.user_id === "string" ? message.user_id : null;
          if (!sessionId) {
            sendError(ws, state, "resume_session requires session_id", true);
            return;
          }
          const loaded = await loadSessionState(sessionId);
          if (!loaded) {
            sendError(ws, state, `Session ${sessionId} not found`, true);
            return;
          }
          // Verify ownership: if session has a user_id, requesting user must match
          if (loaded.userId && loaded.userId !== requestingUserId) {
            sendError(ws, state, "Session belongs to different user", true);
            return;
          }
          state.sessionId = sessionId;
          state.config = loaded.config;
          state.isLocked = loaded.isLocked;
          state.claudeSessionId = loaded.claudeSessionId;
          if (loaded.config.sandbox_mode && !loaded.isLocked) {
            const systemPrompt = await buildSessionContextXml({
              sessionId,
              personalityOverride: resolvePersonalityName(loaded.config.personality),
              includeContext: (loaded.config.include_context ?? true) && !loaded.config.lean_mode,
            });
            try {
              const sandboxSession = await ensureSandboxSession({
                sessionId,
                config: loaded.config,
                claudeSessionId: loaded.claudeSessionId,
                systemPrompt,
              });
              state.currentSandbox = sandboxSession.runner;
            } catch (error) {
              await lockSandboxSession(sessionId);
              state.isLocked = true;
              sendError(ws, state, `Failed to resume sandbox: ${String(error)}`, true);
              return;
            }
          }
          sendEvent(ws, state, "session_ready", {
            session_id: sessionId,
            config: loaded.config,
            is_locked: loaded.isLocked,
            name: loaded.config.session_name ?? null,
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
                sandbox_mount_type: config.sandbox_mount_type ?? "copy",
                sandbox_settings: config.sandbox_settings ?? null,
                mission_id: config.mission_id ?? null,
                name: config.session_name ?? null,
                last_activity: nowDate(),
              })
              .where("id", "=", state.sessionId)
              .execute();
            if (config.sandbox_mode) {
              const sandboxSession = sandboxSessions.get(state.sessionId);
              if (sandboxSession && !sandboxSession.isLocked) {
                sandboxSession.config = config;
                sandboxSession.lastActivity = nowMs();
              }
            } else {
              const sandboxSession = sandboxSessions.get(state.sessionId);
              if (sandboxSession) {
                await sandboxSession.runner.close();
                sandboxSessions.delete(state.sessionId);
              }
            }
            sendEvent(ws, state, "session_ready", {
              session_id: state.sessionId,
              config,
              is_locked: state.isLocked,
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
          } else if (state.currentSandbox) {
            state.cancelRequested = true;
            sendEvent(ws, state, "cancelled", { message: "Query cancelled by user" });
          } else {
            sendError(ws, state, "No active query to cancel", true);
          }
          return;
        }

        if (type === "query") {
          log.agent.debug("Query request received");
          const prompt = typeof message.prompt === "string" ? message.prompt : null;
          if (!prompt) {
            log.agent.debug("Query rejected: no prompt");
            sendError(ws, state, "query requires prompt", true);
            return;
          }
          if (!state.sessionId || !state.config) {
            log.agent.debug("Query rejected: no active session");
            sendError(ws, state, "No active session", true);
            return;
          }
          if (state.isLocked) {
            log.agent.debug("Query rejected: session locked");
            sendError(ws, state, "Session locked (sandbox container stopped)", true);
            return;
          }
          if (state.queryTask) {
            log.agent.debug("Query rejected: query already in progress");
            sendError(ws, state, "Query already in progress", true);
            return;
          }
          log.agent.info("Starting query", { sessionId: state.sessionId, promptPreview: prompt.slice(0, 50) });

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
                includeContext: (config.include_context ?? true) && !config.lean_mode,
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
            let accumulatedThinking = ""; // Accumulate thinking from streaming for SDK path
            let textStreamedFromDeltas = false; // Track if text was streamed (to avoid duplication)
            let thinkingStreamedFromDeltas = false; // Track if thinking was streamed (to avoid duplication)

            const canUseTool = async (
              toolName: string,
              input: Record<string, unknown>,
              _options: { toolUseID: string; suggestions?: unknown },
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

            let sandboxRunner: DockerSandboxRunner | null = null;
            let sandboxFailed = false;
            try {
              if (config.sandbox_mode) {
                const sandboxSession = await ensureSandboxSession({
                  sessionId,
                  config,
                  claudeSessionId: state.claudeSessionId,
                  systemPrompt: systemPrompt ?? "",
                });
                if (sandboxSession.isLocked) {
                  state.isLocked = true;
                  sendError(ws, state, "Session locked (sandbox container stopped)", true);
                  return;
                }
                sandboxRunner = sandboxSession.runner;
                state.currentSandbox = sandboxRunner;
                sandboxSession.lastActivity = nowMs();
                sandboxSession.activeQueries++; // Prevent cleanup during query
                await sandboxRunner.query(promptForModel);

                const appendText = (text: string) => {
                  if (!text) {
                    return;
                  }
                  const last = blocks[blocks.length - 1];
                  if (last && last.type === "text") {
                    last.text = `${last.text ?? ""}${text}`;
                  } else {
                    blocks.push({ type: "text", text });
                  }
                };

                for await (const event of sandboxRunner.receiveResponse()) {
                  if (event.type === "session_id") {
                    const sessionValue =
                      typeof event.data?.session_id === "string" ? event.data.session_id : null;
                    if (sessionValue && sessionValue !== state.claudeSessionId) {
                      state.claudeSessionId = sessionValue;
                      sandboxSession.claudeSessionId = sessionValue;
                      await updateClaudeSessionId(sessionId, sessionValue);
                    }
                    continue;
                  }
                  if (state.cancelRequested) {
                    if (event.type === "done") {
                      break;
                    }
                    continue;
                  }
                  if (event.type === "text") {
                    const text = typeof event.data?.text === "string" ? event.data.text : "";
                    if (text) {
                      if (firstTokenTime === null) {
                        firstTokenTime = performance.now();
                      }
                      sendEvent(ws, state, "text", { text });
                      appendText(text);
                      responseText += text;
                    }
                    continue;
                  }
                  if (event.type === "thinking") {
                    const thinkingText =
                      typeof event.data?.text === "string" ? event.data.text : "";
                    if (thinkingText) {
                      if (firstTokenTime === null) {
                        firstTokenTime = performance.now();
                      }
                      blocks.push({ type: "thinking", text: thinkingText });
                      sendEvent(ws, state, "thinking", { text: thinkingText });
                    }
                    continue;
                  }
                  if (event.type === "tool_use") {
                    toolCount += 1;
                    const id = typeof event.data?.id === "string" ? event.data.id : null;
                    const name = typeof event.data?.name === "string" ? event.data.name : null;
                    const input =
                      event.data?.input && typeof event.data.input === "object"
                        ? (event.data.input as Record<string, unknown>)
                        : {};
                    blocks.push({
                      type: "tool_use",
                      id: id ?? undefined,
                      name: name ?? undefined,
                      input,
                    });
                    if (name) {
                      toolNames.add(name);
                    }
                    sendEvent(ws, state, "tool_use", {
                      id,
                      name,
                      input,
                    });
                    continue;
                  }
                  if (event.type === "tool_result") {
                    const toolUseId =
                      typeof event.data?.tool_use_id === "string" ? event.data.tool_use_id : null;
                    const name = typeof event.data?.name === "string" ? event.data.name : null;
                    const output = typeof event.data?.output === "string" ? event.data.output : "";
                    const isError = Boolean(event.data?.is_error);
                    blocks.push({
                      type: "tool_result",
                      tool_use_id: toolUseId ?? undefined,
                      name: name ?? undefined,
                      output,
                      is_error: isError,
                    });
                    if (name) {
                      toolNames.add(name);
                    }
                    sendEvent(ws, state, "tool_result", {
                      tool_use_id: toolUseId,
                      name,
                      output,
                      is_error: isError,
                    });
                    continue;
                  }
                  if (event.type === "done") {
                    if (typeof event.data?.response_text === "string" && event.data.response_text) {
                      responseText = event.data.response_text;
                    }
                    if (event.data?.structured_output !== undefined) {
                      structuredOutput = event.data.structured_output;
                    }
                    break;
                  }
                  if (event.type === "error") {
                    const message =
                      typeof event.data?.message === "string"
                        ? event.data.message
                        : "Sandbox error";
                    throw new Error(message);
                  }
                }
                sandboxSession.lastActivity = nowMs();
              } else {
                const isVirtualPath = VIRTUAL_PATH_PATTERN.test(config.working_dir);
                if (isVirtualPath) {
                  await ensureChatFallbackDir();
                  log.agent.debug("Using chat fallback cwd", { originalPath: config.working_dir, fallback: CHAT_FALLBACK_CWD });
                }
                const effectiveCwd = isVirtualPath ? CHAT_FALLBACK_CWD : config.working_dir;
                const options: SDKOptions = {
                  cwd: effectiveCwd,
                  includePartialMessages: Boolean(config.enable_streaming),
                  permissionMode: config.auto_approve ? "bypassPermissions" : "default",
                  allowDangerouslySkipPermissions: Boolean(config.auto_approve),
                  persistSession: true,
                  settingSources: ["project"],
                };

                if (config.model) {
                  options.model = config.model;
                }
                if (state.claudeSessionId) {
                  options.resume = state.claudeSessionId;
                }

                // Add thinking budget for extended thinking
                if (config.thinking_budget && config.thinking_budget > 0) {
                  options.maxThinkingTokens = config.thinking_budget;
                  log.agent.debug("Enabled thinking", { budget: config.thinking_budget });
                }

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
                if (
                  config.output_format &&
                  typeof config.output_format === "object" &&
                  "type" in config.output_format &&
                  config.output_format.type === "json_schema" &&
                  "schema" in config.output_format
                ) {
                  options.outputFormat = {
                    type: "json_schema",
                    schema: config.output_format.schema as Record<string, unknown>,
                  };
                }
                // Inherit essential env vars from parent process, then overlay config
                const env: Record<string, string> = {
                  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
                  HOME: process.env.HOME ?? "",
                  USER: process.env.USER ?? "",
                  SHELL: process.env.SHELL ?? "/bin/sh",
                  ...config.env,
                  DERE_SESSION_ID: String(sessionId),
                };
                // Disable git credential prompts for chat sessions (no real project)
                if (isVirtualPath) {
                  env.GIT_TERMINAL_PROMPT = "0";
                }
                options.env = env;
                if (!config.auto_approve) {
                  options.canUseTool = canUseTool;
                }

                options.sandbox = { enabled: false };

                const q = query({ prompt: promptForModel, options });
                state.currentQuery = q;

                for await (const message of q) {
                  if (message.type === "system") {
                    const sysMsg = message as Record<string, unknown>;
                    if (sysMsg.subtype === "init" && typeof sysMsg.session_id === "string") {
                      if (sysMsg.session_id !== state.claudeSessionId) {
                        state.claudeSessionId = sysMsg.session_id;
                        await updateClaudeSessionId(sessionId, sysMsg.session_id);
                      }
                    }
                    continue;
                  }

                  if (message.type === "stream_event") {
                    const streamEvent = message as SDKPartialAssistantMessage;
                    const raw = streamEvent.event as Record<string, unknown>;
                    log.agent.debug("Stream event", { eventType: raw.type });
                    if (raw.type === "content_block_delta") {
                      const delta = raw.delta as Record<string, unknown>;
                      log.agent.debug("Stream delta", { deltaType: delta.type, keys: Object.keys(delta) });
                      if (delta.type === "text_delta" && typeof delta.text === "string") {
                        textStreamedFromDeltas = true; // Mark that we streamed text
                        if (firstTokenTime === null) {
                          firstTokenTime = performance.now();
                        }
                        sendEvent(ws, state, "text", { text: delta.text });
                        responseText += delta.text;
                      } else if (
                        delta.type === "thinking_delta" &&
                        typeof delta.thinking === "string"
                      ) {
                        thinkingStreamedFromDeltas = true; // Mark that we streamed thinking
                        if (firstTokenTime === null) {
                          firstTokenTime = performance.now();
                        }
                        log.agent.debug("Thinking delta received", { length: delta.thinking.length });
                        // Accumulate thinking for persistence (SDK path)
                        accumulatedThinking += delta.thinking;
                        sendEvent(ws, state, "thinking", { text: delta.thinking });
                      }
                    }
                    continue;
                  }

                  if (message.type === "assistant") {
                    const { blocks: assistantBlocks, toolNames: assistantTools } =
                      extractAssistantBlocks(message as SDKAssistantMessage);
                    if (assistantBlocks.length > 0) {
                      // Filter out thinking blocks if we streamed them via thinking_delta events
                      const filteredBlocks = thinkingStreamedFromDeltas
                        ? assistantBlocks.filter((b) => b.type !== "thinking")
                        : assistantBlocks;
                      blocks.push(...filteredBlocks);
                    }
                    for (const name of assistantTools) {
                      toolNames.add(name);
                    }
                    for (const block of assistantBlocks) {
                      if (block.type === "text") {
                        const text = typeof block.text === "string" ? block.text : "";
                        // Only send text if we didn't stream it via text_delta events
                        if (text && !textStreamedFromDeltas) {
                          if (firstTokenTime === null) {
                            firstTokenTime = performance.now();
                          }
                          sendEvent(ws, state, "text", { text });
                          responseText = text;
                        }
                      }
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

                  // Handle user messages which contain tool_result blocks
                  if (message.type === "user") {
                    const userMessage = message as { message?: { content?: unknown } };
                    const content = userMessage.message?.content;
                    if (Array.isArray(content)) {
                      for (const block of content) {
                        if (
                          block &&
                          typeof block === "object" &&
                          (block as Record<string, unknown>).type === "tool_result"
                        ) {
                          const record = block as Record<string, unknown>;
                          const toolUseId =
                            typeof record.tool_use_id === "string" ? record.tool_use_id : null;
                          const name = typeof record.name === "string" ? record.name : null;
                          const contentField = record.content;
                          let output = "";
                          if (typeof contentField === "string") {
                            output = contentField;
                          } else if (Array.isArray(contentField)) {
                            output = contentField
                              .map((c) => {
                                if (typeof c === "string") return c;
                                if (c && typeof c === "object" && (c as Record<string, unknown>).type === "text") {
                                  return (c as Record<string, unknown>).text ?? "";
                                }
                                return JSON.stringify(c);
                              })
                              .join("\n");
                          }
                          const isError = Boolean(record.is_error);
                          blocks.push({
                            type: "tool_result",
                            tool_use_id: toolUseId ?? undefined,
                            name: name ?? undefined,
                            output,
                            is_error: isError,
                          });
                          sendEvent(ws, state, "tool_result", {
                            tool_use_id: toolUseId,
                            name,
                            output,
                            is_error: isError,
                          });
                        }
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
              }
            } catch (error) {
              if (!state.cancelRequested) {
                sendError(ws, state, `Query failed: ${String(error)}`, true);
              }
              sandboxFailed = true;
              return;
            } finally {
              state.currentQuery = null;
              // Decrement active queries counter for sandbox sessions
              const currentSandboxSession = sandboxSessions.get(sessionId);
              if (currentSandboxSession && currentSandboxSession.activeQueries > 0) {
                currentSandboxSession.activeQueries--;
              }
              if (sandboxFailed && sandboxRunner) {
                await sandboxRunner.close();
                if (state.currentSandbox === sandboxRunner) {
                  state.currentSandbox = null;
                }
                sandboxSessions.delete(sessionId);
                state.isLocked = true;
                await lockSandboxSession(sessionId);
              }
            }

            // Check cancel before post-query processing
            if (state.cancelRequested) {
              sendEvent(ws, state, "cancelled", { message: "Query cancelled" });
              return;
            }

            // Add accumulated thinking from streaming to blocks (SDK path only)
            if (accumulatedThinking) {
              log.agent.debug("Adding accumulated thinking", { length: accumulatedThinking.length });
              // Insert thinking at the beginning of blocks (before text)
              blocks.unshift({ type: "thinking", text: accumulatedThinking });
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

            // Only persist if there's actual content and not cancelled
            let assistantConversationId: number | null = null;
            if (!state.cancelRequested && (responseText || blocks.length > 0)) {
              assistantConversationId = await persistAssistantMessage({
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
            }

            // Skip background tasks if cancelled
            if (state.cancelRequested) {
              return;
            }

            void trackCitedEntities(sessionId, responseText).catch((error) => {
              log.kg.warn("Citation tracking failed", { error: String(error) });
            });

            void bufferInteractionStimulus({
              sessionId,
              prompt,
              responseText,
              toolCount,
              personality: resolvePersonalityName(config.personality),
              workingDir: config.working_dir,
            }).catch((error) => {
              log.emotion.warn("Emotion buffer failed", { error: String(error) });
            });
          })()
            .catch((error) => {
              log.agent.error("Query failed", { error: String(error) });
              sendError(ws, state, `Query failed: ${String(error)}`, true);
            })
            .finally(() => {
              log.agent.debug("Query task completed, clearing state");
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
          // Resolve all pending permissions with deny (don't leave SDK hanging)
          for (const pending of state.pendingPermissions.values()) {
            clearTimeout(pending.timeout);
            pending.resolve({
              behavior: "deny",
              message: "WebSocket connection closed",
              interrupt: true,
            });
          }
          state.pendingPermissions.clear();
          if (state.currentQuery) {
            state.cancelRequested = true;
            void state.currentQuery.interrupt();
          }
          state.currentQuery = null;
          state.currentSandbox = null;
          state.queryTask = null;
        },
      };
    }),
  );
}

startSandboxCleanupLoop();

export { websocket, upgradeWebSocket };
