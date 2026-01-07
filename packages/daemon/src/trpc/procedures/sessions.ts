import { z } from "zod";
import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";
import { getDb } from "../../db.js";
import { processCuriosityTriggers } from "../../ambient/triggers/index.js";
import { bufferEmotionStimulus, flushGlobalEmotionBatch } from "../../emotions/runtime.js";
import { router, publicProcedure } from "../init.js";
import { log } from "../../logger.js";

const DEFAULT_SUMMARY_MODEL = "claude-opus-4-5";
const SUMMARY_WINDOW_SECONDS = 1800;
const SUMMARY_LIMIT = 50;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function nowDate(): Date {
  return new Date();
}

function getTextClient(): TextResponseClient {
  const workingDirectory = process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions";
  const transport = new ClaudeAgentTransport({ workingDirectory });
  return new TextResponseClient({
    transport,
    model: process.env.DERE_SUMMARY_MODEL ?? DEFAULT_SUMMARY_MODEL,
  });
}

async function generateSummary(content: string): Promise<string | null> {
  if (process.env.DERE_DISABLE_SUMMARY === "1") {
    return null;
  }

  const prompt = `Summarize in 1-2 sentences. No headers or preambles, just the summary.\n\n${content.slice(
    0,
    2000,
  )}`;

  try {
    const client = getTextClient();
    const summary = await client.generate(prompt);
    return summary.trim();
  } catch {
    return null;
  }
}

export const sessionsRouter = router({
  lastInteraction: publicProcedure
    .input(z.object({ user_id: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      let query = db
        .selectFrom("conversations")
        .select(["created_at"])
        .orderBy("created_at", "desc")
        .limit(1);

      if (input?.user_id) {
        query = query.where("user_id", "=", input.user_id);
      }

      const row = await query.executeTakeFirst();
      const timestamp = row?.created_at ? Math.floor(row.created_at.getTime() / 1000) : null;

      return { last_interaction_time: timestamp };
    }),

  create: publicProcedure
    .input(
      z.object({
        working_dir: z.string(),
        personality: z.string().nullable().optional(),
        medium: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      const now = nowDate();
      const inserted = await db
        .insertInto("sessions")
        .values({
          working_dir: input.working_dir,
          start_time: nowSeconds(),
          personality: input.personality ?? null,
          medium: input.medium ?? "cli",
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

      return { session_id: inserted.id };
    }),

  findOrCreate: publicProcedure
    .input(
      z.object({
        working_dir: z.string(),
        personality: z.string().nullable().optional(),
        medium: z.string().optional(),
        max_age_hours: z.number().nullable().optional(),
        user_id: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      let query = db
        .selectFrom("sessions")
        .select(["id", "claude_session_id", "start_time"])
        .where("working_dir", "=", input.working_dir)
        .orderBy("start_time", "desc");

      if (input.max_age_hours !== null && input.max_age_hours !== undefined) {
        const cutoff = nowSeconds() - input.max_age_hours * 3600;
        query = query.where("start_time", ">=", cutoff);
      }

      const existing = await query.executeTakeFirst();
      if (existing) {
        return {
          session_id: existing.id,
          resumed: true,
          claude_session_id: existing.claude_session_id,
        };
      }

      const now = nowDate();
      const inserted = await db
        .insertInto("sessions")
        .values({
          working_dir: input.working_dir,
          start_time: nowSeconds(),
          continued_from: null,
          personality: input.personality ?? null,
          medium: input.medium ?? "cli",
          user_id: input.user_id ?? null,
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

      return { session_id: inserted.id, resumed: false, claude_session_id: null };
    }),

  setClaudeSession: publicProcedure
    .input(
      z.object({
        session_id: z.number(),
        claude_session_id: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db
        .updateTable("sessions")
        .set({ claude_session_id: input.claude_session_id })
        .where("id", "=", input.session_id)
        .execute();

      return { status: "updated" };
    }),

  addMessage: publicProcedure
    .input(
      z.object({
        session_id: z.number(),
        message: z.string(),
        role: z.string().optional(),
        personality: z.string().nullable().optional(),
        is_command: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      const sessionMeta = await db
        .selectFrom("sessions")
        .select(["personality", "working_dir", "user_id", "start_time"])
        .where("id", "=", input.session_id)
        .executeTakeFirst();

      const personality = input.personality ?? sessionMeta?.personality ?? null;

      const inserted = await db
        .insertInto("conversations")
        .values({
          session_id: input.session_id,
          prompt: input.message,
          message_type: input.role ?? "user",
          personality,
          timestamp: nowSeconds(),
          medium: null,
          user_id: null,
          ttft_ms: null,
          response_ms: null,
          thinking_ms: null,
          tool_uses: null,
          tool_names: null,
          created_at: nowDate(),
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      void processCuriosityTriggers({
        db,
        prompt: input.message,
        sessionId: input.session_id,
        conversationId: inserted.id,
        userId: sessionMeta?.user_id ?? null,
        workingDir: sessionMeta?.working_dir ?? process.cwd(),
        personality,
        speakerName: null,
        isCommand: input.is_command ?? false,
        messageType: input.role ?? "user",
        kgNodes: null,
      }).catch((error) => {
        log.ambient.warn("Curiosity detection failed", { error: String(error) });
      });

      const sessionStart = sessionMeta?.start_time ?? nowSeconds();
      const sessionDurationMinutes = Math.max(0, Math.floor((nowSeconds() - sessionStart) / 60));

      void bufferEmotionStimulus({
        sessionId: input.session_id,
        prompt: input.message,
        personality,
        workingDir: sessionMeta?.working_dir ?? process.cwd(),
        messageType: input.role ?? "user",
        conversationId: inserted.id,
        sessionDurationMinutes,
      }).catch((error) => {
        log.emotion.warn("Emotion buffer failed", { error: String(error) });
      });

      return { message_id: inserted.id };
    }),

  history: publicProcedure
    .input(
      z.object({
        session_id: z.number(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const limit = input.limit ?? 50;

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
        .where("session_id", "=", input.session_id)
        .orderBy("timestamp", "desc")
        .limit(Math.max(1, limit))
        .execute();

      return { messages };
    }),

  lastMessageTime: publicProcedure
    .input(z.object({ session_id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const row = await db
        .selectFrom("conversations")
        .select(["created_at"])
        .where("session_id", "=", input.session_id)
        .orderBy("created_at", "desc")
        .limit(1)
        .executeTakeFirst();

      const timestamp = row?.created_at ? Math.floor(row.created_at.getTime() / 1000) : null;

      return { session_id: input.session_id, last_message_time: timestamp };
    }),

  end: publicProcedure
    .input(z.object({ session_id: z.number() }))
    .mutation(async ({ input }) => {
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
        .where("session_id", "=", input.session_id)
        .where("timestamp", ">=", cutoff)
        .orderBy("timestamp", "desc")
        .limit(SUMMARY_LIMIT)
        .execute();

      const endTime = nowSeconds();

      if (rows.length === 0) {
        await db
          .updateTable("sessions")
          .set({ end_time: endTime })
          .where("id", "=", input.session_id)
          .execute();

        return { status: "ended", summary_generated: false, reason: "no_content" };
      }

      const content = rows
        .slice()
        .reverse()
        .map((row) => `${row.message_type}: ${row.prompt}`)
        .join("\n");

      const summary = await generateSummary(content);
      const updateValues: Record<string, unknown> = { end_time: endTime };
      if (summary) {
        updateValues.summary = summary;
        updateValues.summary_updated_at = nowDate();
      }

      await db
        .updateTable("sessions")
        .set(updateValues)
        .where("id", "=", input.session_id)
        .execute();

      return { status: "ended", summary_generated: Boolean(summary) };
    }),

  context: publicProcedure.query(async () => {
    const db = await getDb();
    const context = await db
      .selectFrom("summary_context")
      .select(["summary", "session_ids", "created_at"])
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!context) {
      return { summary: null, session_ids: [] as number[], created_at: null };
    }

    return {
      summary: context.summary,
      session_ids: (context.session_ids ?? []) as number[],
      created_at: context.created_at ? context.created_at.toISOString() : null,
    };
  }),
});
