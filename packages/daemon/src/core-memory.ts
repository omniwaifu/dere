import type { Hono } from "hono";

import { getDb } from "./db.js";

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

type ConsolidationRunRow = {
  id: number;
  user_id: string | null;
  task_id: number | null;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  recency_days: number | null;
  community_resolution: number | null;
  update_core_memory: boolean;
  triggered_by: string | null;
  stats: Record<string, unknown> | null;
  error_message: string | null;
};

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

function toNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBlockType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
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

function toRunResponse(run: ConsolidationRunRow) {
  return {
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
    stats: run.stats,
    error_message: run.error_message,
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

export function registerCoreMemoryRoutes(app: Hono): void {
  app.post("/memory/core/edit", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const blockType = normalizeBlockType(payload.block_type);
    if (!blockType) {
      return c.json({ error: "Invalid block_type" }, 400);
    }

    const content = payload.content;
    if (typeof content !== "string") {
      return c.json({ error: "content is required" }, 400);
    }

    const scope = payload.scope === "session" ? "session" : "user";
    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    let userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const charLimit = typeof payload.char_limit === "number" ? payload.char_limit : null;
    const reason = typeof payload.reason === "string" ? payload.reason : null;

    if (charLimit !== null && charLimit <= 0) {
      return c.json({ error: "char_limit must be positive" }, 400);
    }

    if (scope === "session") {
      if (sessionId === null) {
        return c.json({ error: "session_id required for session scope" }, 400);
      }
    } else {
      if (!userId && sessionId === null) {
        return c.json({ error: "user_id or session_id required" }, 400);
      }
      if (!userId && sessionId !== null) {
        userId = await resolveUserId(sessionId, null);
      }
      if (!userId) {
        return c.json({ error: "user_id not found for session" }, 400);
      }
    }

    const block = await resolveBlock({
      blockType,
      scope,
      sessionId,
      userId,
    });

    const now = nowDate();
    let created = false;
    let updatedBlock: CoreMemoryBlockRow;

    const db = await getDb();
    if (block) {
      const limit = charLimit ?? block.char_limit ?? DEFAULT_CHAR_LIMIT;
      const validationError = validateContent(content, limit);
      if (validationError) {
        return c.json({ error: validationError }, 400);
      }
      const nextVersion = (block.version ?? 1) + 1;
      await db
        .updateTable("core_memory_blocks")
        .set({
          content,
          char_limit: limit,
          version: nextVersion,
          updated_at: now,
        })
        .where("id", "=", block.id)
        .execute();

      updatedBlock = {
        id: block.id,
        block_type: block.block_type,
        content,
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
      const validationError = validateContent(content, limit);
      if (validationError) {
        return c.json({ error: validationError }, 400);
      }

      const inserted = await db
        .insertInto("core_memory_blocks")
        .values({
          user_id: scope === "session" ? null : userId,
          session_id: scope === "session" ? sessionId : null,
          block_type: blockType,
          content,
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

    return c.json({ block: toBlockResponse(updatedBlock), created });
  });

  app.get("/memory/core", async (c) => {
    const sessionId = parseNullableNumber(c.req.query("session_id"));
    const userIdParam = c.req.query("user_id");

    let resolvedUserId = typeof userIdParam === "string" ? userIdParam : null;
    if (sessionId !== null) {
      const sessionUserId = await resolveUserId(sessionId, null);
      if (sessionUserId) {
        resolvedUserId = sessionUserId;
      }
    }

    if (sessionId === null && !resolvedUserId) {
      return c.json({ error: "session_id or user_id required" }, 400);
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

    return c.json(response);
  });

  app.get("/memory/core/history", async (c) => {
    const blockType = normalizeBlockType(c.req.query("block_type"));
    if (!blockType) {
      return c.json({ error: "Invalid block_type" }, 400);
    }

    const scope = c.req.query("scope") === "session" ? "session" : "user";
    const sessionId = parseNullableNumber(c.req.query("session_id"));
    let userId = c.req.query("user_id") ?? null;

    if (scope === "session") {
      if (sessionId === null) {
        return c.json({ error: "session_id required for session scope" }, 400);
      }
    } else {
      if (!userId && sessionId === null) {
        return c.json({ error: "user_id not found for session" }, 400);
      }
      if (!userId && sessionId !== null) {
        userId = await resolveUserId(sessionId, null);
      }
      if (!userId) {
        return c.json({ error: "user_id not found for session" }, 400);
      }
    }

    const block = await resolveBlock({
      blockType,
      scope,
      sessionId,
      userId,
    });
    if (!block) {
      return c.json({ error: "Core memory block not found" }, 404);
    }

    const limit = Math.max(1, toNumber(c.req.query("limit"), 20));
    const db = await getDb();
    const versions = await db
      .selectFrom("core_memory_versions")
      .select(["block_id", "version", "content", "reason", "created_at"])
      .where("block_id", "=", block.id)
      .orderBy("version", "desc")
      .limit(limit)
      .execute();

    return c.json(
      versions.map((version) => ({
        block_id: version.block_id,
        version: version.version,
        content: version.content,
        reason: version.reason,
        created_at: version.created_at,
      })),
    );
  });

  app.post("/memory/core/rollback", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const blockType = normalizeBlockType(payload.block_type);
    if (!blockType) {
      return c.json({ error: "Invalid block_type" }, 400);
    }

    const targetVersion =
      typeof payload.target_version === "number" ? payload.target_version : null;
    if (!targetVersion || targetVersion <= 0) {
      return c.json({ error: "target_version must be positive" }, 400);
    }

    const scope = payload.scope === "session" ? "session" : "user";
    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    let userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const reason = typeof payload.reason === "string" ? payload.reason : null;

    if (scope === "session") {
      if (sessionId === null) {
        return c.json({ error: "session_id required for session scope" }, 400);
      }
    } else {
      if (!userId && sessionId === null) {
        return c.json({ error: "user_id not found for session" }, 400);
      }
      if (!userId && sessionId !== null) {
        userId = await resolveUserId(sessionId, null);
      }
      if (!userId) {
        return c.json({ error: "user_id not found for session" }, 400);
      }
    }

    const block = await resolveBlock({
      blockType,
      scope,
      sessionId,
      userId,
    });
    if (!block) {
      return c.json({ error: "Core memory block not found" }, 404);
    }

    const db = await getDb();
    const target = await db
      .selectFrom("core_memory_versions")
      .selectAll()
      .where("block_id", "=", block.id)
      .where("version", "=", targetVersion)
      .executeTakeFirst();

    if (!target) {
      return c.json({ error: "Target version not found" }, 404);
    }

    const validationError = validateContent(target.content, block.char_limit);
    if (validationError) {
      return c.json({ error: validationError }, 400);
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
        reason: reason ?? `rollback to v${targetVersion}`,
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

    return c.json({
      block: toBlockResponse(updatedBlock),
      rolled_back_to: targetVersion,
    });
  });

  app.get("/memory/consolidation/runs", async (c) => {
    const userId = c.req.query("user_id");
    const status = c.req.query("status");
    let limit = toNumber(c.req.query("limit"), 20);
    let offset = toNumber(c.req.query("offset"), 0);

    limit = Math.max(1, Math.min(limit, 100));
    offset = Math.max(0, offset);

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

    return c.json({
      runs: runs.map((run) =>
        toRunResponse({
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
        }),
      ),
      total,
      offset,
      limit,
    });
  });
}
