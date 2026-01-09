import type { Hono } from "hono";

import { getDb } from "../db.js";
import { bufferEmotionStimulus, flushGlobalEmotionBatch } from "../emotions/runtime.js";
import { log } from "../logger.js";
import { generateShortSummary } from "../utils/summary.js";
import { insertConversation } from "../utils/conversations.js";

const SUMMARY_WINDOW_SECONDS = 1800;
const SUMMARY_LIMIT = 50;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function nowDate(): Date {
  return new Date();
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function registerSessionRoutes(app: Hono): void {
  app.get("/sessions/last_interaction", async (c) => {
    const userId = c.req.query("user_id");
    const db = await getDb();

    let query = db
      .selectFrom("conversations")
      .select(["created_at"])
      .orderBy("created_at", "desc")
      .limit(1);

    if (userId) {
      query = query.where("user_id", "=", userId);
    }

    const row = await query.executeTakeFirst();
    const timestamp = row?.created_at ? Math.floor(row.created_at.getTime() / 1000) : null;

    return c.json({ last_interaction_time: timestamp });
  });

  app.post("/sessions/create", async (c) => {
    const payload = await parseJson<{
      working_dir?: string;
      personality?: string | null;
      medium?: string;
    }>(c.req.raw);

    if (!payload?.working_dir) {
      return c.json({ error: "working_dir is required" }, 400);
    }

    const db = await getDb();
    const now = nowDate();
    const inserted = await db
      .insertInto("sessions")
      .values({
        working_dir: payload.working_dir,
        start_time: nowSeconds(),
        personality: payload.personality ?? null,
        medium: payload.medium ?? "cli",
        last_activity: now,
        sandbox_mode: false,
        sandbox_mount_type: "none",
        is_locked: false,
        sandbox_settings: null,
        continued_from: null,
        project_type: null,
        claude_session_id: null,
        user_id: null,
        thinking_budget: null,
        mission_id: null,
        created_at: now,
        summary: null,
        summary_updated_at: null,
        name: null,
        end_time: null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return c.json({ session_id: inserted.id });
  });

  app.post("/sessions/find_or_create", async (c) => {
    const payload = await parseJson<{
      working_dir?: string;
      personality?: string | null;
      medium?: string;
      max_age_hours?: number | null;
      user_id?: string | null;
    }>(c.req.raw);

    if (!payload?.working_dir) {
      return c.json({ error: "working_dir is required" }, 400);
    }

    const db = await getDb();
    let query = db
      .selectFrom("sessions")
      .select(["id", "claude_session_id", "start_time"])
      .where("working_dir", "=", payload.working_dir)
      .orderBy("start_time", "desc");

    if (payload.max_age_hours !== null && payload.max_age_hours !== undefined) {
      const cutoff = nowSeconds() - payload.max_age_hours * 3600;
      query = query.where("start_time", ">=", cutoff);
    }

    const existing = await query.executeTakeFirst();
    if (existing) {
      return c.json({
        session_id: existing.id,
        resumed: true,
        claude_session_id: existing.claude_session_id,
      });
    }

    const now = nowDate();
    const inserted = await db
      .insertInto("sessions")
      .values({
        working_dir: payload.working_dir,
        start_time: nowSeconds(),
        continued_from: null,
        personality: payload.personality ?? null,
        medium: payload.medium ?? "cli",
        user_id: payload.user_id ?? null,
        last_activity: now,
        sandbox_mode: false,
        sandbox_mount_type: "none",
        is_locked: false,
        sandbox_settings: null,
        project_type: null,
        claude_session_id: null,
        thinking_budget: null,
        mission_id: null,
        created_at: now,
        summary: null,
        summary_updated_at: null,
        name: null,
        end_time: null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return c.json({ session_id: inserted.id, resumed: false, claude_session_id: null });
  });

  app.post("/sessions/:session_id/claude_session", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const payload = await parseJson<unknown>(c.req.raw);
    let claudeSessionId: string | null = null;

    if (typeof payload === "string") {
      claudeSessionId = payload;
    } else if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (typeof record.claude_session_id === "string") {
        claudeSessionId = record.claude_session_id;
      }
    }

    if (!claudeSessionId) {
      return c.json({ error: "claude_session_id is required" }, 400);
    }

    const db = await getDb();
    await db
      .updateTable("sessions")
      .set({ claude_session_id: claudeSessionId })
      .where("id", "=", sessionId)
      .execute();

    return c.json({ status: "updated" });
  });

  app.post("/sessions/:session_id/message", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const payload = await parseJson<{
      message?: string;
      role?: string;
      personality?: string | null;
      is_command?: boolean;
    }>(c.req.raw);

    if (!payload?.message) {
      return c.json({ error: "message is required" }, 400);
    }

    const db = await getDb();
    const sessionMeta = await db
      .selectFrom("sessions")
      .select(["personality", "working_dir", "user_id", "start_time"])
      .where("id", "=", sessionId)
      .executeTakeFirst();

    const personality = payload.personality ?? sessionMeta?.personality ?? null;

    const conversationId = await insertConversation({
      sessionId,
      messageType: payload.role ?? "user",
      prompt: payload.message,
      personality,
      medium: null,
      updateLastActivity: false,
    });

    const sessionStart = sessionMeta?.start_time ?? nowSeconds();
    const sessionDurationMinutes = Math.max(0, Math.floor((nowSeconds() - sessionStart) / 60));

    void bufferEmotionStimulus({
      sessionId,
      prompt: payload.message,
      personality,
      workingDir: sessionMeta?.working_dir ?? process.cwd(),
      messageType: payload.role ?? "user",
      conversationId,
      sessionDurationMinutes,
    }).catch((error) => {
      log.emotion.warn("Emotion buffer failed", { error: String(error) });
    });

    return c.json({ message_id: conversationId });
  });

  app.get("/sessions/:session_id/history", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const limitParam = c.req.query("limit");
    const parsedLimit = limitParam ? Number(limitParam) : 50;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 50;

    const db = await getDb();
    const messages = await db
      .selectFrom("conversations")
      .select([
        "id",
        "prompt",
        "message_type",
        "timestamp",
        "personality",
        "ttft_ms",
        "response_ms",
        "thinking_ms",
        "tool_uses",
        "tool_names",
      ])
      .where("session_id", "=", sessionId)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .execute();

    return c.json({ messages });
  });

  app.get("/sessions/:session_id/last_message_time", async (c) => {
    const sessionId = Number(c.req.param("session_id"));
    if (!Number.isFinite(sessionId)) {
      return c.json({ error: "Invalid session_id" }, 400);
    }

    const db = await getDb();
    const row = await db
      .selectFrom("conversations")
      .select(["created_at"])
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    const timestamp = row?.created_at ? Math.floor(row.created_at.getTime() / 1000) : null;

    return c.json({ session_id: sessionId, last_message_time: timestamp });
  });

  app.post("/sessions/end", async (c) => {
    const payload = await parseJson<{ session_id?: number }>(c.req.raw);
    const sessionId = payload?.session_id;
    if (!sessionId || !Number.isFinite(sessionId)) {
      return c.json({ error: "session_id is required" }, 400);
    }

    try {
      await flushGlobalEmotionBatch();
    } catch (error) {
      log.emotion.warn("Emotion flush failed", { error: String(error) });
    }

    const db = await getDb();
    const cutoff = nowSeconds() - SUMMARY_WINDOW_SECONDS;

    const rows = await db
      .selectFrom("conversations")
      .select(["prompt", "message_type", "timestamp"])
      .where("session_id", "=", sessionId)
      .where("timestamp", ">=", cutoff)
      .orderBy("timestamp", "desc")
      .limit(SUMMARY_LIMIT)
      .execute();

    const endTime = nowSeconds();

    if (rows.length === 0) {
      await db
        .updateTable("sessions")
        .set({ end_time: endTime })
        .where("id", "=", sessionId)
        .execute();

      return c.json({ status: "ended", summary_generated: false, reason: "no_content" });
    }

    const content = rows
      .slice()
      .reverse()
      .map((row) => `${row.message_type}: ${row.prompt}`)
      .join("\n");

    const summary = await generateShortSummary(content);
    const updateValues: Record<string, unknown> = { end_time: endTime };
    if (summary) {
      updateValues.summary = summary;
      updateValues.summary_updated_at = nowDate();
    }

    await db.updateTable("sessions").set(updateValues).where("id", "=", sessionId).execute();

    return c.json({ status: "ended", summary_generated: Boolean(summary) });
  });

  app.get("/sessions/context", async (c) => {
    const db = await getDb();
    const context = await db
      .selectFrom("summary_context")
      .select(["summary", "session_ids", "created_at"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!context) {
      return c.json({ summary: null, session_ids: [], created_at: null });
    }

    return c.json({
      summary: context.summary,
      session_ids: context.session_ids ?? [],
      created_at: context.created_at ? context.created_at.toISOString() : null,
    });
  });
}
