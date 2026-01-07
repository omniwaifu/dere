import type { Hono } from "hono";
import { sql } from "kysely";

import { getDb } from "../db.js";

const STATUS = {
  BACKLOG: "backlog",
  READY: "ready",
  CLAIMED: "claimed",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  BLOCKED: "blocked",
  CANCELLED: "cancelled",
} as const;

function nowDate(): Date {
  return new Date();
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function toTaskResponse(task: Record<string, unknown>) {
  return task;
}

async function computeInitialStatus(blockedBy: number[] | null): Promise<string> {
  if (!blockedBy || blockedBy.length === 0) {
    return STATUS.READY;
  }

  const db = await getDb();
  const result = await db
    .selectFrom("project_tasks")
    .select(db.fn.countAll().as("count"))
    .where("id", "in", blockedBy)
    .where("status", "!=", STATUS.DONE)
    .executeTakeFirst();

  const count = Number(result?.count ?? 0);
  return count > 0 ? STATUS.BLOCKED : STATUS.READY;
}

async function refreshBlockedTasks(completedTaskId: number): Promise<void> {
  const db = await getDb();
  const now = nowDate();

  const blockedTasks = await db
    .selectFrom("project_tasks")
    .select(["id", "blocked_by"])
    .where(sql<boolean>`blocked_by @> ${[completedTaskId]}::int[]`)
    .where("status", "=", STATUS.BLOCKED)
    .execute();

  for (const task of blockedTasks) {
    const blockedBy = (task.blocked_by ?? []).filter((id) => id !== completedTaskId);
    if (blockedBy.length === 0) {
      await db
        .updateTable("project_tasks")
        .set({ blocked_by: null, status: STATUS.READY, updated_at: now })
        .where("id", "=", task.id)
        .execute();
      continue;
    }

    const remaining = await db
      .selectFrom("project_tasks")
      .select(db.fn.countAll().as("count"))
      .where("id", "in", blockedBy)
      .where("status", "!=", STATUS.DONE)
      .executeTakeFirst();

    const remainingCount = Number(remaining?.count ?? 0);
    await db
      .updateTable("project_tasks")
      .set({
        blocked_by: blockedBy,
        updated_at: now,
        status: remainingCount > 0 ? STATUS.BLOCKED : STATUS.READY,
      })
      .where("id", "=", task.id)
      .execute();
  }
}

export function registerWorkQueueRoutes(app: Hono): void {
  app.post("/work-queue/tasks", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const workingDir = payload.working_dir;
    const title = payload.title;
    if (typeof workingDir !== "string" || typeof title !== "string") {
      return c.json({ error: "working_dir and title are required" }, 400);
    }

    const blockedBy = Array.isArray(payload.blocked_by)
      ? payload.blocked_by.map(Number).filter(Number.isFinite)
      : null;
    const now = nowDate();
    const status = await computeInitialStatus(blockedBy);

    const db = await getDb();
    const inserted = await db
      .insertInto("project_tasks")
      .values({
        working_dir: workingDir,
        title,
        description: typeof payload.description === "string" ? payload.description : null,
        acceptance_criteria:
          typeof payload.acceptance_criteria === "string" ? payload.acceptance_criteria : null,
        context_summary:
          typeof payload.context_summary === "string" ? payload.context_summary : null,
        scope_paths: Array.isArray(payload.scope_paths) ? payload.scope_paths : null,
        required_tools: Array.isArray(payload.required_tools) ? payload.required_tools : null,
        task_type: typeof payload.task_type === "string" ? payload.task_type : null,
        tags: Array.isArray(payload.tags) ? payload.tags : null,
        estimated_effort:
          typeof payload.estimated_effort === "string" ? payload.estimated_effort : null,
        priority: typeof payload.priority === "number" ? payload.priority : 0,
        status,
        blocked_by: blockedBy,
        related_task_ids: Array.isArray(payload.related_task_ids) ? payload.related_task_ids : null,
        created_by_session_id:
          typeof payload.created_by_session_id === "number" ? payload.created_by_session_id : null,
        created_by_agent_id:
          typeof payload.created_by_agent_id === "number" ? payload.created_by_agent_id : null,
        discovered_from_task_id:
          typeof payload.discovered_from_task_id === "number"
            ? payload.discovered_from_task_id
            : null,
        discovery_reason:
          typeof payload.discovery_reason === "string" ? payload.discovery_reason : null,
        extra: toJsonRecord(payload.extra),
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        attempt_count: 0,
        outcome: null,
        completion_notes: null,
        files_changed: null,
        follow_up_task_ids: null,
        last_error: null,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return c.json(toTaskResponse(inserted));
  });

  app.get("/work-queue/tasks", async (c) => {
    const workingDir = c.req.query("working_dir");
    const status = c.req.query("status");
    const taskType = c.req.query("task_type");
    const limit = Number(c.req.query("limit") ?? 50);
    const offset = Number(c.req.query("offset") ?? 0);
    const tagsParam = c.req.query("tags");
    const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : null;

    const db = await getDb();
    let query = db.selectFrom("project_tasks");
    let countQuery = db.selectFrom("project_tasks");

    if (workingDir) {
      query = query.where("working_dir", "=", workingDir);
      countQuery = countQuery.where("working_dir", "=", workingDir);
    }
    if (status) {
      query = query.where("status", "=", status);
      countQuery = countQuery.where("status", "=", status);
    }
    if (taskType) {
      query = query.where("task_type", "=", taskType);
      countQuery = countQuery.where("task_type", "=", taskType);
    }
    if (tags && tags.length > 0) {
      const overlap = sql<boolean>`tags && ${tags}::text[]`;
      query = query.where(overlap);
      countQuery = countQuery.where(overlap);
    }

    const count = await countQuery.select(db.fn.countAll().as("count")).executeTakeFirst();
    const total = Number(count?.count ?? 0);

    const tasks = await query
      .selectAll()
      .orderBy("priority", "desc")
      .orderBy("created_at", "desc")
      .limit(Number.isFinite(limit) ? limit : 50)
      .offset(Number.isFinite(offset) ? offset : 0)
      .execute();

    return c.json({ tasks: tasks.map(toTaskResponse), total });
  });

  app.get("/work-queue/tasks/ready", async (c) => {
    const workingDir = c.req.query("working_dir");
    if (!workingDir) {
      return c.json({ error: "working_dir is required" }, 400);
    }

    const taskType = c.req.query("task_type");
    const limit = Number(c.req.query("limit") ?? 10);
    const requiredToolsParam = c.req.query("required_tools");
    const requiredTools = requiredToolsParam ? requiredToolsParam.split(",").filter(Boolean) : null;

    const db = await getDb();
    let query = db
      .selectFrom("project_tasks")
      .selectAll()
      .where("working_dir", "=", workingDir)
      .where("status", "=", STATUS.READY)
      .where("claimed_by_session_id", "is", null)
      .where("claimed_by_agent_id", "is", null)
      .orderBy("priority", "desc")
      .orderBy("created_at", "asc")
      .limit(Number.isFinite(limit) ? limit : 10);

    if (taskType) {
      query = query.where("task_type", "=", taskType);
    }

    if (requiredTools && requiredTools.length > 0) {
      query = query.where(sql<boolean>`required_tools <@ ${requiredTools}::text[]`);
    }

    const tasks = await query.execute();

    return c.json({ tasks: tasks.map(toTaskResponse), total: tasks.length });
  });

  app.get("/work-queue/tasks/:task_id", async (c) => {
    const taskId = Number(c.req.param("task_id"));
    if (!Number.isFinite(taskId)) {
      return c.json({ error: "Invalid task_id" }, 400);
    }

    const db = await getDb();
    const task = await db
      .selectFrom("project_tasks")
      .selectAll()
      .where("id", "=", taskId)
      .executeTakeFirst();

    if (!task) {
      return c.json({ error: `Task ${taskId} not found` }, 404);
    }

    return c.json(toTaskResponse(task));
  });

  app.post("/work-queue/tasks/:task_id/claim", async (c) => {
    const taskId = Number(c.req.param("task_id"));
    if (!Number.isFinite(taskId)) {
      return c.json({ error: "Invalid task_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const sessionId = typeof payload?.session_id === "number" ? payload.session_id : null;
    const agentId = typeof payload?.agent_id === "number" ? payload.agent_id : null;

    const db = await getDb();
    let claimedTask: Record<string, unknown> | null = null;

    await db.transaction().execute(async (trx) => {
      const task = await trx
        .selectFrom("project_tasks")
        .selectAll()
        .where("id", "=", taskId)
        .where("status", "=", STATUS.READY)
        .where("claimed_by_session_id", "is", null)
        .where("claimed_by_agent_id", "is", null)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();

      if (!task) {
        return;
      }

      const now = nowDate();
      const updated = await trx
        .updateTable("project_tasks")
        .set({
          status: STATUS.CLAIMED,
          claimed_by_session_id: sessionId,
          claimed_by_agent_id: agentId,
          claimed_at: now,
          updated_at: now,
          attempt_count: sql<number>`attempt_count + 1`,
        })
        .where("id", "=", taskId)
        .returningAll()
        .executeTakeFirst();

      claimedTask = updated ?? null;
    });

    if (!claimedTask) {
      const existing = await db
        .selectFrom("project_tasks")
        .select(["status"])
        .where("id", "=", taskId)
        .executeTakeFirst();
      if (!existing) {
        return c.json({ error: `Task ${taskId} not found` }, 404);
      }
      if (existing.status !== STATUS.READY) {
        return c.json({ error: `Task ${taskId} is not ready (status: ${existing.status})` }, 400);
      }
      return c.json({ error: `Task ${taskId} was claimed by another agent` }, 400);
    }

    return c.json(toTaskResponse(claimedTask));
  });

  app.post("/work-queue/tasks/:task_id/release", async (c) => {
    const taskId = Number(c.req.param("task_id"));
    if (!Number.isFinite(taskId)) {
      return c.json({ error: "Invalid task_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const reason = typeof payload?.reason === "string" ? payload.reason : null;

    const db = await getDb();
    const task = await db
      .selectFrom("project_tasks")
      .selectAll()
      .where("id", "=", taskId)
      .executeTakeFirst();
    if (!task) {
      return c.json({ error: `Task ${taskId} not found` }, 404);
    }

    const releaseable = new Set<string>([STATUS.CLAIMED, STATUS.IN_PROGRESS]);
    if (!releaseable.has(String(task.status))) {
      return c.json({ error: `Task ${taskId} cannot be released (status: ${task.status})` }, 400);
    }

    const now = nowDate();
    const updated = await db
      .updateTable("project_tasks")
      .set({
        status: STATUS.READY,
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        updated_at: now,
        last_error: reason ?? task.last_error,
      })
      .where("id", "=", taskId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return c.json(toTaskResponse(updated));
  });

  app.patch("/work-queue/tasks/:task_id", async (c) => {
    const taskId = Number(c.req.param("task_id"));
    if (!Number.isFinite(taskId)) {
      return c.json({ error: "Invalid task_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload || typeof payload !== "object") {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const updates: Record<string, unknown> = { updated_at: nowDate() };
    if (typeof payload.status === "string") {
      updates.status = payload.status;
      if (payload.status === STATUS.IN_PROGRESS) {
        updates.started_at = nowDate();
      }
      if (payload.status === STATUS.DONE) {
        updates.completed_at = nowDate();
      }
    }
    if (typeof payload.title === "string") updates.title = payload.title;
    if (typeof payload.description === "string") updates.description = payload.description;
    if (typeof payload.priority === "number") updates.priority = payload.priority;
    if (Array.isArray(payload.tags)) updates.tags = payload.tags;
    if (typeof payload.outcome === "string") updates.outcome = payload.outcome;
    if (typeof payload.completion_notes === "string")
      updates.completion_notes = payload.completion_notes;
    if (Array.isArray(payload.files_changed)) updates.files_changed = payload.files_changed;
    if (typeof payload.last_error === "string") updates.last_error = payload.last_error;

    const db = await getDb();
    const updated = await db
      .updateTable("project_tasks")
      .set(updates)
      .where("id", "=", taskId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return c.json({ error: `Task ${taskId} not found` }, 404);
    }

    if (payload.status === STATUS.DONE) {
      await refreshBlockedTasks(taskId);
    }

    return c.json(toTaskResponse(updated));
  });

  app.delete("/work-queue/tasks/:task_id", async (c) => {
    const taskId = Number(c.req.param("task_id"));
    if (!Number.isFinite(taskId)) {
      return c.json({ error: "Invalid task_id" }, 400);
    }

    const db = await getDb();
    const deleted = await db
      .deleteFrom("project_tasks")
      .where("id", "=", taskId)
      .executeTakeFirst();

    if (!deleted || deleted.numDeletedRows === 0n) {
      return c.json({ error: `Task ${taskId} not found` }, 404);
    }

    return c.json({ deleted: true });
  });
}
