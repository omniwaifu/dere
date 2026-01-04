import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  SessionTitleResultSchema,
} from "@dere/shared-llm";
import { getDb } from "../../db.js";
import { router, publicProcedure } from "../init.js";

const SESSION_LIST_LIMIT = 50;
const MESSAGE_LIMIT_DEFAULT = 100;
const METRICS_LIMIT_DEFAULT = 300;
const TITLE_MODEL = "claude-haiku-4-5";

type MessageBlock =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; name: string; output: string; is_error: boolean };

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
  const workingDirectory = process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions";
  const model = process.env.DERE_TITLE_MODEL ?? TITLE_MODEL;

  console.log(`[generateSessionTitle] Using model: ${model}, cwd: ${workingDirectory}`);

  const transport = new ClaudeAgentTransport({ workingDirectory });
  const client = new StructuredOutputClient({ transport, model });

  const response = await client.generate(prompt, SessionTitleResultSchema, {
    schemaName: "session_title",
  });

  console.log(`[generateSessionTitle] Got title: ${response.title}`);
  return response.title.trim();
}

export const agentRouter = router({
  list: publicProcedure.query(async () => {
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

    return {
      sessions: rows.map((row) => ({
        session_id: row.id,
        config: buildSessionConfig(row),
        claude_session_id: row.claude_session_id,
        name: row.name,
        sandbox_mode: row.sandbox_mode,
        is_locked: row.is_locked,
        mission_id: row.mission_id,
      })),
    };
  }),

  get: publicProcedure
    .input(z.object({ session_id: z.number() }))
    .query(async ({ input }) => {
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
        .where("id", "=", input.session_id)
        .executeTakeFirst();

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      return {
        session_id: row.id,
        config: buildSessionConfig(row),
        claude_session_id: row.claude_session_id,
        sandbox_mode: row.sandbox_mode,
      };
    }),

  messages: publicProcedure
    .input(
      z.object({
        session_id: z.number(),
        limit: z.number().optional(),
        before_timestamp: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      const limit = input.limit ?? MESSAGE_LIMIT_DEFAULT;
      const beforeTimestamp = input.before_timestamp ?? null;

      const db = await getDb();
      let query = db
        .selectFrom("conversations")
        .select(["id", "prompt", "message_type", "created_at", "timestamp"])
        .where("session_id", "=", input.session_id)
        .where("medium", "=", "agent_api")
        .orderBy("created_at", "asc");

      if (beforeTimestamp !== null) {
        query = query.where("timestamp", "<", beforeTimestamp);
      }

      const rows = await query.execute();

      if (rows.length === 0) {
        return { messages: [], has_more: false };
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
              tool_uses: [] as Array<{ id: string; name: string; input: Record<string, unknown> }>,
              tool_results: [] as Array<{
                tool_use_id: string;
                name: string;
                output: string;
                is_error: boolean;
              }>,
              blocks: [{ type: "text" as const, text: row.prompt }],
            };
          }

          const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          const toolResults: Array<{
            tool_use_id: string;
            name: string;
            output: string;
            is_error: boolean;
          }> = [];
          const blocksPayload: MessageBlock[] = [];
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

      return { messages, has_more: false };
    }),

  metrics: publicProcedure
    .input(z.object({ session_id: z.number(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      const limit = input.limit ?? METRICS_LIMIT_DEFAULT;
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
        .where("session_id", "=", input.session_id)
        .where("medium", "=", "agent_api")
        .orderBy("created_at", "asc")
        .limit(limit)
        .execute();

      return {
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
      };
    }),

  recentDirectories: publicProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      const db = await getDb();
      const rows = await db
        .selectFrom("sessions")
        .select(["working_dir", db.fn.max("start_time").as("last_start")])
        .where("medium", "=", "agent_api")
        .groupBy("working_dir")
        .orderBy("last_start", "desc")
        .limit(limit)
        .execute();

      return { directories: rows.map((row) => row.working_dir) };
    }),

  rename: publicProcedure
    .input(z.object({ session_id: z.number(), name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const truncated = input.name.trim().slice(0, 50);
      const db = await getDb();
      const result = await db
        .updateTable("sessions")
        .set({ name: truncated })
        .where("id", "=", input.session_id)
        .returning(["id"])
        .executeTakeFirst();

      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      return { name: truncated };
    }),

  generateName: publicProcedure
    .input(z.object({ session_id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const session = await db
        .selectFrom("sessions")
        .select(["id", "name"])
        .where("id", "=", input.session_id)
        .executeTakeFirst();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      if (session.name) {
        return { name: session.name, generated: false };
      }

      const rows = await db
        .selectFrom("conversations")
        .select(["prompt", "message_type", "created_at"])
        .where("session_id", "=", input.session_id)
        .orderBy("created_at", "asc")
        .limit(2)
        .execute();

      const userMessage = rows.find((row) => row.message_type === "user");
      const assistantMessage = rows.find((row) => row.message_type === "assistant");

      if (!userMessage) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No user message found" });
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
          .where("id", "=", input.session_id)
          .execute();
        return { name: finalTitle, generated: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[generateName] Failed for session ${input.session_id}:`, message);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to generate name: ${message}` });
      }
    }),

  create: publicProcedure
    .input(
      z.object({
        working_dir: z.string().min(1),
        personality: z.union([z.string(), z.array(z.string())]).nullable().optional(),
        user_id: z.string().nullable().optional(),
        thinking_budget: z.number().nullable().optional(),
        sandbox_mode: z.boolean().optional(),
        sandbox_settings: z.record(z.string(), z.unknown()).nullable().optional(),
        mission_id: z.number().nullable().optional(),
        session_name: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const personality = normalizePersonality(input.personality);
      const userId = input.user_id ?? null;
      const thinkingBudget = input.thinking_budget ?? null;
      const sandboxMode = input.sandbox_mode ?? false;
      const sandboxMountType = sandboxMode ? "copy" : "none";
      const sandboxSettings = input.sandbox_settings ?? null;
      const missionId = input.mission_id ?? null;
      const sessionName = input.session_name ?? null;

      const now = nowDate();
      const db = await getDb();
      const inserted = await db
        .insertInto("sessions")
        .values({
          working_dir: input.working_dir,
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

      return {
        session_id: inserted.id,
        config: buildSessionConfig(inserted),
        claude_session_id: inserted.claude_session_id,
        name: inserted.name,
        sandbox_mode: inserted.sandbox_mode,
        is_locked: inserted.is_locked,
        mission_id: inserted.mission_id,
      };
    }),

  update: publicProcedure
    .input(
      z.object({
        session_id: z.number(),
        working_dir: z.string().optional(),
        personality: z.union([z.string(), z.array(z.string())]).nullable().optional(),
        user_id: z.string().nullable().optional(),
        thinking_budget: z.number().nullable().optional(),
        sandbox_mode: z.boolean().optional(),
        sandbox_settings: z.record(z.string(), z.unknown()).nullable().optional(),
        mission_id: z.number().nullable().optional(),
        session_name: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const updates: Record<string, unknown> = { last_activity: nowDate() };
      if (input.working_dir !== undefined) {
        updates.working_dir = input.working_dir;
      }
      if (input.personality !== undefined) {
        updates.personality = normalizePersonality(input.personality);
      }
      if (input.user_id !== undefined) {
        updates.user_id = input.user_id;
      }
      if (input.thinking_budget !== undefined) {
        updates.thinking_budget = input.thinking_budget;
      }
      if (input.sandbox_mode !== undefined) {
        updates.sandbox_mode = input.sandbox_mode;
      }
      if (input.sandbox_settings !== undefined) {
        updates.sandbox_settings = input.sandbox_settings;
      }
      if (input.mission_id !== undefined) {
        updates.mission_id = input.mission_id;
      }
      if (input.session_name !== undefined) {
        updates.name = input.session_name;
      }

      const db = await getDb();
      const result = await db
        .updateTable("sessions")
        .set(updates)
        .where("id", "=", input.session_id)
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      return {
        session_id: result.id,
        config: buildSessionConfig(result),
        claude_session_id: result.claude_session_id,
        name: result.name,
        sandbox_mode: result.sandbox_mode,
        is_locked: result.is_locked,
        mission_id: result.mission_id,
      };
    }),

  delete: publicProcedure
    .input(z.object({ session_id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const session = await db
        .selectFrom("sessions")
        .select(["id"])
        .where("id", "=", input.session_id)
        .executeTakeFirst();

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      await db
        .deleteFrom("conversation_blocks")
        .where(
          "conversation_id",
          "in",
          db.selectFrom("conversations").select("id").where("session_id", "=", input.session_id),
        )
        .execute();

      await db.deleteFrom("conversations").where("session_id", "=", input.session_id).execute();
      await db.deleteFrom("sessions").where("id", "=", input.session_id).execute();

      return { status: "deleted", session_id: input.session_id };
    }),
});
