import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "kysely";
import { router, publicProcedure } from "../init.js";
import { getDb } from "../../db.js";
import { getRecallEmbedder, vectorLiteral } from "../../recall-embeddings.js";

const CORE_MEMORY_BLOCK_TYPES = new Set(["persona", "human", "task"]);
const DEFAULT_CHAR_LIMIT = 8192;

type CoreMemoryBlockRow = {
  id: number;
  block_type: string;
  content: string;
  scope: "user" | "session";
  session_id: number | null;
  user_id: string | null;
  char_limit: number;
  version: number;
  updated_at: Date | null;
};

function nowDate(): Date {
  return new Date();
}

function normalizeBlockType(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return CORE_MEMORY_BLOCK_TYPES.has(normalized) ? normalized : null;
}

function validateContent(content: string, charLimit: number): string | null {
  if (charLimit <= 0) {
    return "char_limit must be positive";
  }
  if (content.length > charLimit) {
    return `Content exceeds char_limit (${content.length}/${charLimit})`;
  }
  return null;
}

function toBlockResponse(block: CoreMemoryBlockRow) {
  return {
    id: block.id,
    block_type: block.block_type,
    content: block.content,
    scope: block.scope,
    session_id: block.session_id,
    user_id: block.user_id,
    char_limit: block.char_limit,
    version: block.version,
    updated_at: block.updated_at,
  };
}

async function resolveUserId(
  sessionId: number | null,
  userId: string | null,
): Promise<string | null> {
  if (userId) {
    return userId;
  }
  if (sessionId === null) {
    return null;
  }
  const db = await getDb();
  const session = await db
    .selectFrom("sessions")
    .select(["user_id"])
    .where("id", "=", sessionId)
    .executeTakeFirst();
  return session?.user_id ?? null;
}

async function resolveBlock(args: {
  blockType: string;
  scope: "user" | "session";
  sessionId: number | null;
  userId: string | null;
}) {
  const db = await getDb();
  if (args.scope === "session") {
    if (args.sessionId === null) {
      return null;
    }
    return db
      .selectFrom("core_memory_blocks")
      .selectAll()
      .where("session_id", "=", args.sessionId)
      .where("block_type", "=", args.blockType)
      .executeTakeFirst();
  }

  if (!args.userId) {
    return null;
  }

  return db
    .selectFrom("core_memory_blocks")
    .selectAll()
    .where("user_id", "=", args.userId)
    .where("session_id", "is", null)
    .where("block_type", "=", args.blockType)
    .executeTakeFirst();
}

const blockTypeSchema = z.enum(["persona", "human", "task"]);
const scopeSchema = z.enum(["user", "session"]).default("user");

export const memoryRouter = router({
  core: publicProcedure
    .input(
      z
        .object({
          session_id: z.number().optional(),
          user_id: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const sessionId = input?.session_id ?? null;
      const userIdParam = input?.user_id ?? null;

      let resolvedUserId = userIdParam;
      if (sessionId !== null) {
        const sessionUserId = await resolveUserId(sessionId, null);
        if (sessionUserId) {
          resolvedUserId = sessionUserId;
        }
      }

      if (sessionId === null && !resolvedUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "session_id or user_id required",
        });
      }

      const db = await getDb();
      const blocks = new Map<string, CoreMemoryBlockRow>();

      if (sessionId !== null) {
        const sessionBlocks = await db
          .selectFrom("core_memory_blocks")
          .selectAll()
          .where("session_id", "=", sessionId)
          .where("block_type", "in", Array.from(CORE_MEMORY_BLOCK_TYPES))
          .execute();

        for (const block of sessionBlocks) {
          blocks.set(block.block_type, {
            id: block.id,
            block_type: block.block_type,
            content: block.content,
            scope: "session",
            session_id: block.session_id,
            user_id: block.user_id,
            char_limit: block.char_limit,
            version: block.version,
            updated_at: block.updated_at,
          });
        }
      }

      if (resolvedUserId) {
        const userBlocks = await db
          .selectFrom("core_memory_blocks")
          .selectAll()
          .where("user_id", "=", resolvedUserId)
          .where("session_id", "is", null)
          .where("block_type", "in", Array.from(CORE_MEMORY_BLOCK_TYPES))
          .execute();

        for (const block of userBlocks) {
          if (!blocks.has(block.block_type)) {
            blocks.set(block.block_type, {
              id: block.id,
              block_type: block.block_type,
              content: block.content,
              scope: "user",
              session_id: block.session_id,
              user_id: block.user_id,
              char_limit: block.char_limit,
              version: block.version,
              updated_at: block.updated_at,
            });
          }
        }
      }

      const response: Array<ReturnType<typeof toBlockResponse>> = [];
      for (const blockType of ["persona", "human", "task"]) {
        const block = blocks.get(blockType);
        if (!block) {
          continue;
        }
        response.push(toBlockResponse(block));
      }

      return response;
    }),

  editCore: publicProcedure
    .input(
      z.object({
        block_type: blockTypeSchema,
        content: z.string(),
        reason: z.string().optional(),
        scope: scopeSchema,
        session_id: z.number().optional(),
        user_id: z.string().optional(),
        char_limit: z.number().positive().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const blockType = normalizeBlockType(input.block_type);
      if (!blockType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid block_type" });
      }

      const scope = input.scope;
      const sessionId = input.session_id ?? null;
      let userId = input.user_id ?? null;
      const charLimit = input.char_limit ?? null;
      const reason = input.reason ?? null;

      if (scope === "session") {
        if (sessionId === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "session_id required for session scope",
          });
        }
      } else {
        if (!userId && sessionId === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "user_id or session_id required",
          });
        }
        if (!userId && sessionId !== null) {
          userId = await resolveUserId(sessionId, null);
        }
        if (!userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "user_id not found for session",
          });
        }
      }

      const block = await resolveBlock({ blockType, scope, sessionId, userId });
      const now = nowDate();
      let created = false;
      let updatedBlock: CoreMemoryBlockRow;

      const db = await getDb();
      if (block) {
        const limit = charLimit ?? block.char_limit ?? DEFAULT_CHAR_LIMIT;
        const validationError = validateContent(input.content, limit);
        if (validationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
        }
        const nextVersion = (block.version ?? 1) + 1;
        await db
          .updateTable("core_memory_blocks")
          .set({
            content: input.content,
            char_limit: limit,
            version: nextVersion,
            updated_at: now,
          })
          .where("id", "=", block.id)
          .execute();

        updatedBlock = {
          id: block.id,
          block_type: block.block_type,
          content: input.content,
          scope,
          session_id: block.session_id,
          user_id: block.user_id,
          char_limit: limit,
          version: nextVersion,
          updated_at: now,
        };
      } else {
        created = true;
        const limit = charLimit ?? DEFAULT_CHAR_LIMIT;
        const validationError = validateContent(input.content, limit);
        if (validationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
        }

        const inserted = await db
          .insertInto("core_memory_blocks")
          .values({
            user_id: scope === "session" ? null : userId,
            session_id: scope === "session" ? sessionId : null,
            block_type: blockType,
            content: input.content,
            char_limit: limit,
            version: 1,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        updatedBlock = {
          id: inserted.id,
          block_type: inserted.block_type,
          content: inserted.content,
          scope,
          session_id: inserted.session_id,
          user_id: inserted.user_id,
          char_limit: inserted.char_limit,
          version: inserted.version,
          updated_at: inserted.updated_at,
        };
      }

      await db
        .insertInto("core_memory_versions")
        .values({
          block_id: updatedBlock.id,
          version: updatedBlock.version,
          content: updatedBlock.content,
          reason,
          created_at: now,
        })
        .execute();

      return { block: toBlockResponse(updatedBlock), created };
    }),

  history: publicProcedure
    .input(
      z.object({
        block_type: blockTypeSchema,
        limit: z.number().positive().optional().default(20),
        scope: scopeSchema,
        session_id: z.number().optional(),
        user_id: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const blockType = normalizeBlockType(input.block_type);
      if (!blockType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid block_type" });
      }

      const scope = input.scope;
      const sessionId = input.session_id ?? null;
      let userId = input.user_id ?? null;

      if (scope === "session") {
        if (sessionId === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "session_id required for session scope",
          });
        }
      } else {
        if (!userId && sessionId === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "user_id or session_id required",
          });
        }
        if (!userId && sessionId !== null) {
          userId = await resolveUserId(sessionId, null);
        }
        if (!userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "user_id not found for session",
          });
        }
      }

      const block = await resolveBlock({ blockType, scope, sessionId, userId });
      if (!block) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Core memory block not found",
        });
      }

      const db = await getDb();
      const versions = await db
        .selectFrom("core_memory_versions")
        .select(["block_id", "version", "content", "reason", "created_at"])
        .where("block_id", "=", block.id)
        .orderBy("version", "desc")
        .limit(input.limit)
        .execute();

      return versions.map((version) => ({
        block_id: version.block_id,
        version: version.version,
        content: version.content,
        reason: version.reason,
        created_at: version.created_at,
      }));
    }),

  rollback: publicProcedure
    .input(
      z.object({
        block_type: blockTypeSchema,
        target_version: z.number().positive(),
        reason: z.string().optional(),
        scope: scopeSchema,
        session_id: z.number().optional(),
        user_id: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const blockType = normalizeBlockType(input.block_type);
      if (!blockType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid block_type" });
      }

      const scope = input.scope;
      const sessionId = input.session_id ?? null;
      let userId = input.user_id ?? null;
      const reason = input.reason ?? null;

      if (scope === "session") {
        if (sessionId === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "session_id required for session scope",
          });
        }
      } else {
        if (!userId && sessionId === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "user_id or session_id required",
          });
        }
        if (!userId && sessionId !== null) {
          userId = await resolveUserId(sessionId, null);
        }
        if (!userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "user_id not found for session",
          });
        }
      }

      const block = await resolveBlock({ blockType, scope, sessionId, userId });
      if (!block) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Core memory block not found",
        });
      }

      const db = await getDb();
      const target = await db
        .selectFrom("core_memory_versions")
        .selectAll()
        .where("block_id", "=", block.id)
        .where("version", "=", input.target_version)
        .executeTakeFirst();

      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target version not found",
        });
      }

      const validationError = validateContent(target.content, block.char_limit);
      if (validationError) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
      }

      const now = nowDate();
      const nextVersion = (block.version ?? 1) + 1;
      await db
        .updateTable("core_memory_blocks")
        .set({
          content: target.content,
          version: nextVersion,
          updated_at: now,
        })
        .where("id", "=", block.id)
        .execute();

      await db
        .insertInto("core_memory_versions")
        .values({
          block_id: block.id,
          version: nextVersion,
          content: target.content,
          reason: reason ?? `rollback to v${input.target_version}`,
          created_at: now,
        })
        .execute();

      const updatedBlock: CoreMemoryBlockRow = {
        id: block.id,
        block_type: block.block_type,
        content: target.content,
        scope,
        session_id: block.session_id,
        user_id: block.user_id,
        char_limit: block.char_limit,
        version: nextVersion,
        updated_at: now,
      };

      return {
        block: toBlockResponse(updatedBlock),
        rolled_back_to: input.target_version,
      };
    }),

  consolidationRuns: publicProcedure
    .input(
      z
        .object({
          user_id: z.string().optional(),
          status: z.string().optional(),
          limit: z.number().min(1).max(100).optional().default(20),
          offset: z.number().min(0).optional().default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const userId = input?.user_id;
      const status = input?.status;
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const db = await getDb();
      let query = db.selectFrom("consolidation_runs");
      let countQuery = db.selectFrom("consolidation_runs");

      if (userId) {
        query = query.where("user_id", "=", userId);
        countQuery = countQuery.where("user_id", "=", userId);
      }
      if (status) {
        query = query.where("status", "=", status);
        countQuery = countQuery.where("status", "=", status);
      }

      const count = await countQuery.select(db.fn.countAll().as("count")).executeTakeFirst();
      const total = Number(count?.count ?? 0);

      const runs = await query
        .selectAll()
        .orderBy("started_at", "desc")
        .offset(offset)
        .limit(limit)
        .execute();

      return {
        runs: runs.map((run) => ({
          id: run.id,
          user_id: run.user_id,
          task_id: run.task_id,
          status: run.status,
          started_at: run.started_at,
          finished_at: run.finished_at,
          recency_days: run.recency_days,
          community_resolution: run.community_resolution,
          update_core_memory: run.update_core_memory,
          triggered_by: run.triggered_by,
          stats: run.stats as Record<string, unknown> | null,
          error_message: run.error_message,
        })),
        total,
        offset,
        limit,
      };
    }),
});

type RecallResult = {
  result_id: string;
  result_type: "conversation" | "exploration_finding";
  score: number;
  text: string;
  timestamp: number;
  user_id: string | null;
  message_type?: string | null;
  medium?: string | null;
  session_id?: number | null;
  conversation_id?: number | null;
  block_id?: number | null;
  finding_id?: number | null;
  task_id?: number | null;
  confidence?: number | null;
};

function rrfScores(resultLists: string[][], rankConst = 60): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const results of resultLists) {
    results.forEach((id, idx) => {
      scores[id] = (scores[id] ?? 0) + 1.0 / (idx + rankConst);
    });
  }
  return scores;
}

export const recallRouter = router({
  search: publicProcedure
    .input(
      z.object({
        query: z.string(),
        limit: z.number().positive().optional().default(10),
        days_back: z.number().positive().optional(),
        session_id: z.number().optional(),
        user_id: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const query = input.query;
      if (!query.trim()) {
        return { query, results: [] };
      }

      const limit = input.limit;
      const daysBack = input.days_back;
      const sessionId = input.session_id;
      const userId = input.user_id;

      const cutoffSeconds =
        daysBack && daysBack > 0
          ? Math.floor(Date.now() / 1000) - daysBack * 86400
          : null;
      const cutoffDate =
        daysBack && daysBack > 0
          ? new Date(Date.now() - daysBack * 86400 * 1000)
          : null;

      const db = await getDb();

      let convoQuery = db
        .selectFrom("conversation_blocks as cb")
        .innerJoin("conversations as c", "c.id", "cb.conversation_id")
        .select([
          "cb.id as block_id",
          "cb.text as text",
          "c.id as conversation_id",
          "c.session_id as session_id",
          "c.message_type as message_type",
          "c.timestamp as timestamp",
          "c.medium as medium",
          "c.user_id as user_id",
          sql<number>`ts_rank_cd(to_tsvector('english', cb.text), websearch_to_tsquery('english', ${query}))`.as(
            "score",
          ),
        ])
        .where("cb.block_type", "=", "text")
        .where("cb.text", "is not", null)
        .where(sql<boolean>`cb.text <> ''`)
        .where("c.message_type", "in", ["user", "assistant", "system"])
        .where(
          sql<boolean>`to_tsvector('english', cb.text) @@ websearch_to_tsquery('english', ${query})`,
        )
        .orderBy("score", "desc")
        .limit(limit * 2);

      if (sessionId !== undefined) {
        convoQuery = convoQuery.where("c.session_id", "=", sessionId);
      }
      if (userId) {
        convoQuery = convoQuery.where("c.user_id", "=", userId);
      }
      if (cutoffSeconds !== null) {
        convoQuery = convoQuery.where("c.timestamp", ">=", cutoffSeconds);
      }

      const fulltextRows = await convoQuery.execute();
      const fulltextIds = fulltextRows.map((row) => `conv:${row.block_id}`);

      let vectorRows: typeof fulltextRows = [];
      let vectorIds: string[] = [];
      const embedder = await getRecallEmbedder();
      if (embedder) {
        try {
          const queryEmbedding = await embedder.create(query.replace(/\n/g, " "));
          const vector = vectorLiteral(queryEmbedding);

          let vectorQuery = db
            .selectFrom("conversation_blocks as cb")
            .innerJoin("conversations as c", "c.id", "cb.conversation_id")
            .select([
              "cb.id as block_id",
              "cb.text as text",
              "c.id as conversation_id",
              "c.session_id as session_id",
              "c.message_type as message_type",
              "c.timestamp as timestamp",
              "c.medium as medium",
              "c.user_id as user_id",
              sql<number>`1 - (cb.content_embedding <=> ${vector}::vector)`.as("score"),
            ])
            .where("cb.block_type", "=", "text")
            .where("cb.text", "is not", null)
            .where(sql<boolean>`cb.text <> ''`)
            .where("c.message_type", "in", ["user", "assistant", "system"])
            .where("cb.content_embedding", "is not", null)
            .orderBy(sql`cb.content_embedding <=> ${vector}::vector`)
            .limit(limit * 2);

          if (sessionId !== undefined) {
            vectorQuery = vectorQuery.where("c.session_id", "=", sessionId);
          }
          if (userId) {
            vectorQuery = vectorQuery.where("c.user_id", "=", userId);
          }
          if (cutoffSeconds !== null) {
            vectorQuery = vectorQuery.where("c.timestamp", ">=", cutoffSeconds);
          }

          vectorRows = await vectorQuery.execute();
          vectorIds = vectorRows.map((row) => `conv:${row.block_id}`);
        } catch (error) {
          console.log(`[recall] vector search failed: ${String(error)}`);
        }
      }

      const surfacedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const surfacedClause =
        sessionId !== undefined
          ? sql<boolean>`not exists (select 1 from surfaced_findings sf where sf.finding_id = f.id and (sf.surfaced_at > ${surfacedCutoff} or sf.session_id = ${sessionId}))`
          : sql<boolean>`not exists (select 1 from surfaced_findings sf where sf.finding_id = f.id and sf.surfaced_at > ${surfacedCutoff})`;

      let findingQuery = db
        .selectFrom("exploration_findings as f")
        .select([
          "f.id as finding_id",
          "f.task_id as task_id",
          "f.finding as text",
          "f.share_message as share_message",
          "f.worth_sharing as worth_sharing",
          "f.user_id as user_id",
          "f.confidence as confidence",
          "f.created_at as created_at",
          sql<number>`ts_rank_cd(to_tsvector('english', f.finding), websearch_to_tsquery('english', ${query}))`.as(
            "score",
          ),
        ])
        .where(sql<boolean>`f.finding <> ''`)
        .where(surfacedClause)
        .where(
          sql<boolean>`to_tsvector('english', f.finding) @@ websearch_to_tsquery('english', ${query})`,
        )
        .orderBy("score", "desc")
        .limit(limit * 2);

      if (userId) {
        findingQuery = findingQuery.where("f.user_id", "=", userId);
      }
      if (cutoffDate) {
        findingQuery = findingQuery.where("f.created_at", ">=", cutoffDate);
      }

      const findingRows = await findingQuery.execute();
      const findingIds = findingRows.map((row) => `finding:${row.finding_id}`);

      const scores = rrfScores([fulltextIds, vectorIds, findingIds]);
      const ranked = Object.keys(scores)
        .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))
        .slice(0, limit);

      const rowMap = new Map<string, Record<string, unknown>>();
      for (const row of fulltextRows) {
        rowMap.set(`conv:${row.block_id}`, row as Record<string, unknown>);
      }
      for (const row of vectorRows) {
        rowMap.set(`conv:${row.block_id}`, row as Record<string, unknown>);
      }
      for (const row of findingRows) {
        rowMap.set(`finding:${row.finding_id}`, row as Record<string, unknown>);
      }

      const results: RecallResult[] = [];
      for (const resultId of ranked) {
        const row = rowMap.get(resultId);
        if (!row) {
          continue;
        }
        if (resultId.startsWith("conv:")) {
          results.push({
            result_id: resultId,
            result_type: "conversation",
            block_id: row.block_id as number,
            conversation_id: row.conversation_id as number,
            session_id: row.session_id as number,
            message_type: row.message_type as string,
            timestamp: row.timestamp as number,
            medium: row.medium as string | null,
            user_id: row.user_id as string | null,
            text: String(row.text ?? ""),
            score: scores[resultId] ?? 0,
          });
        } else {
          const createdAt = row.created_at instanceof Date ? row.created_at : null;
          const timestamp = createdAt ? Math.floor(createdAt.getTime() / 1000) : 0;
          const displayText = row.worth_sharing && row.share_message ? row.share_message : row.text;
          results.push({
            result_id: resultId,
            result_type: "exploration_finding",
            finding_id: row.finding_id as number,
            task_id: row.task_id as number,
            user_id: row.user_id as string | null,
            text: String(displayText ?? ""),
            timestamp,
            message_type: "exploration",
            confidence: (row.confidence as number | null) ?? null,
            score: scores[resultId] ?? 0,
          });
        }
      }

      return { query, results };
    }),
});
