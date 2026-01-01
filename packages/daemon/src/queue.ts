import type { Hono } from "hono";

import { getDb } from "./db.js";

const STATUSES = ["pending", "processing", "completed", "failed"] as const;

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

export function registerQueueRoutes(app: Hono): void {
  app.post("/queue/add", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const taskType = payload.task_type;
    const modelName = payload.model_name;
    const content = payload.content;
    if (
      typeof taskType !== "string" ||
      typeof modelName !== "string" ||
      typeof content !== "string"
    ) {
      return c.json({ error: "task_type, model_name, and content are required" }, 400);
    }

    const db = await getDb();
    const inserted = await db
      .insertInto("task_queue")
      .values({
        task_type: taskType,
        model_name: modelName,
        content,
        metadata:
          payload.metadata && typeof payload.metadata === "object" ? payload.metadata : null,
        priority: typeof payload.priority === "number" ? payload.priority : 5,
        status: "pending",
        session_id: typeof payload.session_id === "number" ? payload.session_id : null,
        created_at: nowDate(),
        processed_at: null,
        retry_count: 0,
        error_message: null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return c.json({ task_id: inserted.id, status: "queued" });
  });

  app.get("/queue/status", async (c) => {
    const db = await getDb();
    const rows = await db
      .selectFrom("task_queue")
      .select(["status"])
      .select(db.fn.countAll().as("count"))
      .groupBy("status")
      .execute();

    const stats: Record<string, number> = {};
    for (const row of rows) {
      stats[String(row.status)] = Number(row.count ?? 0);
    }
    for (const status of STATUSES) {
      stats[status] ??= 0;
    }

    return c.json(stats);
  });
}
