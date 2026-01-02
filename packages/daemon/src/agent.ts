import type { Hono } from "hono";

import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  SessionTitleResultSchema,
} from "@dere/shared-llm";

import { getDb } from "./db.js";

const SESSION_LIST_LIMIT = 50;
const MESSAGE_LIMIT_DEFAULT = 100;
const METRICS_LIMIT_DEFAULT = 300;
const TITLE_MODEL = "claude-haiku-4-5";

function nowDate(): Date {
  return new Date();
}

type JsonRecord = Record<string, unknown>;

function toJsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function buildSessionConfig(row: {
  working_dir: string;
  personality: string | null;
  user_id: string | null;
  thinking_budget: number | null;
  sandbox_mode: boolean;
  sandbox_settings: unknown;
}): Record<string, unknown> {
  const sandboxSettings = toJsonRecord(row.sandbox_settings);
  return {
    working_dir: row.working_dir,
    output_style: "default",
    personality: row.personality ?? "",
    user_id: row.user_id ?? undefined,
    thinking_budget: row.thinking_budget ?? undefined,
    sandbox_mode: row.sandbox_mode,
    sandbox_settings: sandboxSettings ?? undefined,
  };
}

function resolveLimit(value: string | null | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizePersonality(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? (value[0] ?? null) : null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

async function generateSessionTitle(prompt: string): Promise<string> {
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  const client = new StructuredOutputClient({
    transport,
    model: process.env.DERE_TITLE_MODEL ?? TITLE_MODEL,
  });

  const response = await client.generate(prompt, SessionTitleResultSchema, {
    schemaName: "session_title",
  });

  return response.title.trim();
}

export function registerAgentRoutes(app: Hono): void {
  app.get("/agent/sessions", async (c) => {
    const db = await getDb();
    const rows = await db
      .selectFrom("sessions")
      .select([
        "id",
        "working_dir",
        "personality",
        "user_id",
        "claude_session_id",
        "name",
        "sandbox_mode",
        "is_locked",
        "mission_id",
        "thinking_budget",
        "sandbox_settings",
      ])
      .where("medium", "=", "agent_api")
      .orderBy("start_time", "desc")
      .limit(SESSION_LIST_LIMIT)
      .execute();

    return c.json({
      sessions: rows.map((row) => ({
        session_id: row.id,
        config: buildSessionConfig(row),
        claude_session_id: row.claude_session_id,
        name: row.name,
        sandbox_mode: row.sandbox_mode,
        is_locked: row.is_locked,
        mission_id: row.mission_id,
      })),
    });
  });

  app.get("/agent/sessions/:session_id", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const db = await getDb();
    const row = await db
      .selectFrom("sessions")
      .select([
        "id",
        "working_dir",
        "personality",
        "user_id",
        "claude_session_id",
        "sandbox_mode",
        "thinking_budget",
        "sandbox_settings",
      ])
      .where("id", "=", sessionId)
      .executeTakeFirst();

    if (!row) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({
      session_id: row.id,
      config: buildSessionConfig(row),
      claude_session_id: row.claude_session_id,
      sandbox_mode: row.sandbox_mode,
    });
  });

  app.get("/agent/sessions/:session_id/messages", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const limit = resolveLimit(c.req.query("limit"), MESSAGE_LIMIT_DEFAULT);
    const beforeTimestampRaw = c.req.query("before_timestamp");
    const beforeTimestamp = beforeTimestampRaw ? Number(beforeTimestampRaw) : null;
    const db = await getDb();
    let query = db
      .selectFrom("conversations")
      .select(["id", "prompt", "message_type", "created_at", "timestamp"])
      .where("session_id", "=", sessionId)
      .where("medium", "=", "agent_api")
      .orderBy("created_at", "asc");

    if (beforeTimestamp !== null && Number.isFinite(beforeTimestamp)) {
      query = query.where("timestamp", "<", beforeTimestamp);
    }

    const rows = await query.execute();

    if (rows.length === 0) {
      return c.json({ messages: [], has_more: false });
    }

    const trimmed = rows.length > limit ? rows.slice(rows.length - limit) : rows;
    const conversationIds = trimmed.map((row) => row.id);

    const blocks = await db
      .selectFrom("conversation_blocks")
      .select([
        "conversation_id",
        "ordinal",
        "block_type",
        "text",
        "tool_use_id",
        "tool_name",
        "tool_input",
        "is_error",
      ])
      .where("conversation_id", "in", conversationIds)
      .orderBy("conversation_id", "asc")
      .orderBy("ordinal", "asc")
      .execute();

    const blocksByConversation = new Map<number, Array<(typeof blocks)[number]>>();
    for (const block of blocks) {
      const list = blocksByConversation.get(block.conversation_id) ?? [];
      list.push(block);
      blocksByConversation.set(block.conversation_id, list);
    }

    const messages = trimmed
      .map((row) => {
        const ts = row.created_at
          ? row.created_at.toISOString()
          : new Date(row.timestamp * 1000).toISOString();
        const role = row.message_type;
        if (role !== "user" && role !== "assistant") {
          return null;
        }

        const convBlocks = blocksByConversation.get(row.id) ?? [];
        if (convBlocks.length === 0 || role === "user") {
          return {
            id: String(row.id),
            role,
            content: row.prompt,
            timestamp: ts,
            thinking: null,
            tool_uses: [],
            tool_results: [],
            blocks: [{ type: "text", text: row.prompt }],
          };
        }

        const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        const toolResults: Array<{
          tool_use_id: string;
          name: string;
          output: string;
          is_error: boolean;
        }> = [];
        const blocksPayload: Array<Record<string, unknown>> = [];
        const textSegments: string[] = [];
        let thinkingText: string | null = null;

        for (const block of convBlocks) {
          if (block.block_type === "thinking") {
            if (block.text) {
              const text = block.text;
              blocksPayload.push({ type: "thinking", text });
              if (!thinkingText) {
                thinkingText = text;
              }
            }
          } else if (block.block_type === "text") {
            if (block.text) {
              const text = block.text;
              blocksPayload.push({ type: "text", text });
              textSegments.push(text);
            }
          } else if (block.block_type === "tool_use") {
            const toolId = block.tool_use_id ?? "";
            const toolName = block.tool_name ?? "";
            toolUses.push({
              id: toolId,
              name: toolName,
              input: (block.tool_input as Record<string, unknown>) ?? {},
            });
            blocksPayload.push({
              type: "tool_use",
              id: toolId,
              name: toolName,
              input: (block.tool_input as Record<string, unknown>) ?? {},
            });
          } else if (block.block_type === "tool_result") {
            toolResults.push({
              tool_use_id: block.tool_use_id ?? "",
              name: block.tool_name ?? "",
              output: block.text ?? "",
              is_error: Boolean(block.is_error),
            });
            blocksPayload.push({
              type: "tool_result",
              tool_use_id: block.tool_use_id ?? "",
              name: block.tool_name ?? "",
              output: block.text ?? "",
              is_error: Boolean(block.is_error),
            });
          }
        }

        const content = textSegments.length > 0 ? textSegments.join("\n\n") : row.prompt;
        const thinking = thinkingText;

        return {
          id: String(row.id),
          role,
          content,
          timestamp: ts,
          thinking,
          tool_uses: toolUses,
          tool_results: toolResults,
          blocks: blocksPayload.length > 0 ? blocksPayload : null,
        };
      })
      .filter(Boolean);

    return c.json({ messages, has_more: false });
  });

  app.get("/agent/sessions/:session_id/metrics", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const limit = resolveLimit(c.req.query("limit"), METRICS_LIMIT_DEFAULT);
    const db = await getDb();
    const rows = await db
      .selectFrom("conversations")
      .select([
        "id",
        "message_type",
        "timestamp",
        "created_at",
        "personality",
        "ttft_ms",
        "response_ms",
        "thinking_ms",
        "tool_uses",
        "tool_names",
      ])
      .where("session_id", "=", sessionId)
      .where("medium", "=", "agent_api")
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();

    return c.json({
      messages: rows.map((row) => ({
        id: row.id,
        message_type: row.message_type,
        timestamp: row.timestamp,
        created_at: row.created_at ? row.created_at.getTime() : null,
        personality: row.personality,
        ttft_ms: row.ttft_ms,
        response_ms: row.response_ms,
        thinking_ms: row.thinking_ms,
        tool_uses: row.tool_uses,
        tool_names: row.tool_names,
      })),
    });
  });

  app.get("/agent/recent-directories", async (c) => {
    const limit = resolveLimit(c.req.query("limit"), 10);
    const db = await getDb();
    const rows = await db
      .selectFrom("sessions")
      .select(["working_dir", db.fn.max("start_time").as("last_start")])
      .where("medium", "=", "agent_api")
      .groupBy("working_dir")
      .orderBy("last_start", "desc")
      .limit(limit)
      .execute();

    return c.json({ directories: rows.map((row) => row.working_dir) });
  });

  app.patch("/agent/sessions/:session_id/name", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const payload = await parseJson<{ name?: string }>(c.req.raw);
    const name = payload?.name?.trim();
    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }

    const truncated = name.slice(0, 50);
    const db = await getDb();
    const result = await db
      .updateTable("sessions")
      .set({ name: truncated })
      .where("id", "=", sessionId)
      .returning(["id"])
      .executeTakeFirst();

    if (!result) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({ name: truncated });
  });

  app.post("/agent/sessions/:session_id/generate-name", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const db = await getDb();
    const session = await db
      .selectFrom("sessions")
      .select(["id", "name"])
      .where("id", "=", sessionId)
      .executeTakeFirst();

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (session.name) {
      return c.json({ name: session.name, generated: false });
    }

    const rows = await db
      .selectFrom("conversations")
      .select(["prompt", "message_type", "created_at"])
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .limit(2)
      .execute();

    const userMessage = rows.find((row) => row.message_type === "user");
    const assistantMessage = rows.find((row) => row.message_type === "assistant");

    if (!userMessage) {
      return c.json({ error: "No user message found" }, 400);
    }

    let prompt =
      "Generate a 2-4 word title for this conversation. " +
      "Return structured output with a single field, title. " +
      "No explanation, no quotes, no punctuation except spaces.\n\n" +
      `User message: ${userMessage.prompt.slice(0, 300)}\n`;

    if (assistantMessage) {
      prompt += `Assistant response: ${assistantMessage.prompt.slice(0, 200)}\n`;
    }

    try {
      const title = await generateSessionTitle(prompt);
      const cleaned = title
        .replace(/^title[:\s]+/i, "")
        .replace(/^["']|["']$/g, "")
        .trim();
      const finalTitle = cleaned.slice(0, 50);
      await db
        .updateTable("sessions")
        .set({ name: finalTitle })
        .where("id", "=", sessionId)
        .execute();
      return c.json({ name: finalTitle, generated: true });
    } catch {
      return c.json({ error: "Failed to generate name" }, 500);
    }
  });

  app.post("/agent/sessions", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const workingDir = payload.working_dir;
    if (typeof workingDir !== "string" || !workingDir.trim()) {
      return c.json({ error: "working_dir is required" }, 400);
    }

    const personality = normalizePersonality(payload.personality as string | string[] | null);
    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const thinkingBudget =
      typeof payload.thinking_budget === "number" ? payload.thinking_budget : null;
    const sandboxMode = Boolean(payload.sandbox_mode);
    const sandboxMountType = sandboxMode ? "copy" : "none";
    const sandboxSettings =
      payload.sandbox_settings && typeof payload.sandbox_settings === "object"
        ? (payload.sandbox_settings as Record<string, unknown>)
        : null;
    const missionId = typeof payload.mission_id === "number" ? payload.mission_id : null;
    const sessionName = typeof payload.session_name === "string" ? payload.session_name : null;

    const now = nowDate();
    const db = await getDb();
    const inserted = await db
      .insertInto("sessions")
      .values({
        working_dir: workingDir,
        start_time: Math.floor(now.getTime() / 1000),
        personality,
        medium: "agent_api",
        user_id: userId,
        thinking_budget: thinkingBudget,
        sandbox_mode: sandboxMode,
        sandbox_mount_type: sandboxMountType,
        sandbox_settings: sandboxSettings,
        mission_id: missionId,
        name: sessionName,
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
      .returning([
        "id",
        "working_dir",
        "personality",
        "user_id",
        "sandbox_mode",
        "sandbox_settings",
        "thinking_budget",
        "claude_session_id",
        "name",
        "is_locked",
        "mission_id",
      ])
      .executeTakeFirstOrThrow();

    return c.json({
      session_id: inserted.id,
      config: buildSessionConfig(inserted),
      claude_session_id: inserted.claude_session_id,
      name: inserted.name,
      sandbox_mode: inserted.sandbox_mode,
      is_locked: inserted.is_locked,
      mission_id: inserted.mission_id,
    });
  });

  app.patch("/agent/sessions/:session_id", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const updates: Record<string, unknown> = { last_activity: nowDate() };
    if (typeof payload.working_dir === "string") {
      updates.working_dir = payload.working_dir;
    }
    if ("personality" in payload) {
      updates.personality = normalizePersonality(payload.personality as string | string[] | null);
    }
    if (typeof payload.user_id === "string" || payload.user_id === null) {
      updates.user_id = payload.user_id as string | null;
    }
    if (typeof payload.thinking_budget === "number" || payload.thinking_budget === null) {
      updates.thinking_budget = payload.thinking_budget as number | null;
    }
    if (typeof payload.sandbox_mode === "boolean") {
      updates.sandbox_mode = payload.sandbox_mode;
    }
    if (payload.sandbox_settings && typeof payload.sandbox_settings === "object") {
      updates.sandbox_settings = payload.sandbox_settings as Record<string, unknown>;
    }
    if (typeof payload.mission_id === "number" || payload.mission_id === null) {
      updates.mission_id = payload.mission_id as number | null;
    }
    if (typeof payload.session_name === "string") {
      updates.name = payload.session_name;
    }

    const db = await getDb();
    const result = await db
      .updateTable("sessions")
      .set(updates)
      .where("id", "=", sessionId)
      .returning([
        "id",
        "working_dir",
        "personality",
        "user_id",
        "sandbox_mode",
        "sandbox_settings",
        "thinking_budget",
        "claude_session_id",
        "name",
        "is_locked",
        "mission_id",
      ])
      .executeTakeFirst();

    if (!result) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({
      session_id: result.id,
      config: buildSessionConfig(result),
      claude_session_id: result.claude_session_id,
      name: result.name,
      sandbox_mode: result.sandbox_mode,
      is_locked: result.is_locked,
      mission_id: result.mission_id,
    });
  });

  app.delete("/agent/sessions/:session_id", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const db = await getDb();
    const session = await db
      .selectFrom("sessions")
      .select(["id"])
      .where("id", "=", sessionId)
      .executeTakeFirst();

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await db
      .deleteFrom("conversation_blocks")
      .where(
        "conversation_id",
        "in",
        db.selectFrom("conversations").select("id").where("session_id", "=", sessionId),
      )
      .execute();

    await db.deleteFrom("conversations").where("session_id", "=", sessionId).execute();
    await db.deleteFrom("sessions").where("id", "=", sessionId).execute();

    return c.json({ status: "deleted", session_id: sessionId });
  });
}
