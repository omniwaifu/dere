import type { Hono } from "hono";

import { getDb } from "./db.js";

const STATUSES = ["pending", "processing", "completed", "failed"] as const;

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function registerStatusRoutes(app: Hono): void {
  app.post("/status/get", async (c) => {
    const payload = (await parseJson<Record<string, unknown>>(c.req.raw)) ?? {};

    const db = await getDb();
    const rows = await db
      .selectFrom("task_queue")
      .select(["status"])
      .select(db.fn.countAll().as("count"))
      .groupBy("status")
      .execute();

    const queueStats: Record<string, number> = {};
    for (const row of rows) {
      queueStats[String(row.status)] = Number(row.count ?? 0);
    }
    for (const status of STATUSES) {
      queueStats[status] ??= 0;
    }

    const status: Record<string, unknown> = { daemon: "running", queue: queueStats };

    if (typeof payload.personality === "string") {
      status.personality = payload.personality;
    }
    if (Array.isArray(payload.mcp_servers)) {
      status.mcp_servers = payload.mcp_servers;
    }
    if (payload.context) {
      status.context_enabled = true;
    }
    if (typeof payload.session_type === "string") {
      status.session_type = payload.session_type;
    }

    return c.json(status);
  });
}
