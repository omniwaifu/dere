import type { Hono } from "hono";

import { loadConfig } from "@dere/shared-config";
import { addEpisode } from "@dere/graph";

import { getDb } from "../db.js";
import { bufferEmotionStimulus } from "../emotions/runtime.js";
import { log } from "../logger.js";

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

export function registerConversationRoutes(app: Hono): void {
  app.post("/conversation/capture", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    const personality = typeof payload.personality === "string" ? payload.personality : null;
    const projectPath = typeof payload.project_path === "string" ? payload.project_path : "";
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    const messageType = typeof payload.message_type === "string" ? payload.message_type : "user";
    const medium = typeof payload.medium === "string" ? payload.medium : null;
    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const isCommand = Boolean(payload.is_command);
    const speakerName = typeof payload.speaker_name === "string" ? payload.speaker_name : null;

    if (!sessionId || !personality || !projectPath) {
      return c.json({ error: "session_id, personality, and project_path are required" }, 400);
    }

    const db = await getDb();
    const now = nowDate();

    const existing = await db
      .selectFrom("sessions")
      .select(["id", "working_dir", "start_time"])
      .where("id", "=", sessionId)
      .executeTakeFirst();

    const sessionStart = existing?.start_time ?? nowSeconds();
    if (!existing) {
      await db
        .insertInto("sessions")
        .values({
          id: sessionId,
          working_dir: projectPath || "",
          start_time: sessionStart,
          personality,
          medium: medium ?? "cli",
          last_activity: now,
          sandbox_mode: false,
          sandbox_mount_type: "none",
          is_locked: false,
          sandbox_settings: null,
          continued_from: null,
          project_type: null,
          claude_session_id: null,
          user_id: userId,
          thinking_budget: null,
          mission_id: null,
          created_at: now,
          summary: null,
          summary_updated_at: null,
          name: null,
          end_time: null,
        })
        .execute();
    }

    const inserted = await db
      .insertInto("conversations")
      .values({
        session_id: sessionId,
        prompt,
        message_type: messageType,
        personality,
        timestamp: nowSeconds(),
        medium,
        user_id: userId,
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
          conversation_id: inserted.id,
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

    const workingDir = projectPath || existing?.working_dir || "/workspace";
    const sessionDurationMinutes = Math.max(0, Math.floor((nowSeconds() - sessionStart) / 60));

    void (async () => {
      let kgNodes: Array<Record<string, unknown>> | null = null;
      if (messageType === "user" && prompt.trim()) {
        try {
          const config = await loadConfig();
          const canonicalUserName =
            typeof config.user?.name === "string" && config.user.name ? config.user.name : "User";
          const episodeResult = await addEpisode({
            episodeBody: prompt,
            sourceDescription: `${medium ?? "cli"} conversation`,
            referenceTime: now,
            source: "message",
            groupId: userId ?? "default",
            speakerId: userId ?? null,
            speakerName: canonicalUserName,
            personality,
          });
          kgNodes = episodeResult.nodes.map((node) => ({
            uuid: node.uuid,
            name: node.name,
            labels: node.labels,
            summary: node.summary,
          }));
        } catch (error) {
          log.kg.warn("Graph ingestion failed", { error: String(error) });
        }
      }

      void bufferEmotionStimulus({
        sessionId,
        prompt,
        personality,
        workingDir,
        messageType,
        conversationId: inserted.id,
        sessionDurationMinutes,
      }).catch((error) => {
        log.emotion.warn("Emotion buffer failed", { error: String(error) });
      });

    })();

    return c.json({ status: "stored" });
  });

  app.get("/conversations/last_dm/:user_id", async (c) => {
    const userId = c.req.param("user_id");
    if (!userId) {
      return c.json({ message: null }, 400);
    }

    const db = await getDb();
    const row = await db
      .selectFrom("conversations")
      .select(["prompt", "message_type", "timestamp", "session_id"])
      .where("user_id", "=", userId)
      .where("medium", "=", "discord")
      .orderBy("timestamp", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!row) {
      return c.json({ message: null });
    }

    const minutesAgo = Math.floor((Date.now() / 1000 - row.timestamp) / 60);
    return c.json({
      message: row.prompt,
      message_type: row.message_type,
      timestamp: row.timestamp,
      minutes_ago: minutesAgo,
      session_id: row.session_id,
    });
  });
}
