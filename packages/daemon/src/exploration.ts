import type { Hono } from "hono";
import { sql } from "kysely";

import { getDb } from "./db.js";

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function registerExplorationRoutes(app: Hono): void {
  app.post("/exploration/queue", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const sessionId =
      typeof payload.session_id === "number" && Number.isFinite(payload.session_id)
        ? payload.session_id
        : null;
    const limit =
      typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.max(1, payload.limit)
        : 1;

    const db = await getDb();
    const surfacedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const surfacedFilter =
      sessionId !== null
        ? sql`not exists (select 1 from surfaced_findings sf where sf.finding_id = ef.id and sf.surfaced_at > ${surfacedCutoff} and sf.session_id = ${sessionId})`
        : sql`not exists (select 1 from surfaced_findings sf where sf.finding_id = ef.id and sf.surfaced_at > ${surfacedCutoff})`;

    let query = db
      .selectFrom("exploration_findings as ef")
      .select([
        "ef.id",
        "ef.task_id",
        "ef.user_id",
        "ef.finding",
        "ef.share_message",
        "ef.confidence",
        "ef.created_at",
      ])
      .where("ef.worth_sharing", "=", true)
      .where("ef.confidence", ">=", 0.8)
      .where(surfacedFilter)
      .orderBy("ef.created_at", "desc")
      .limit(limit);

    if (userId) {
      query = query.where("ef.user_id", "=", userId);
    }

    const rows = await query.execute();
    const findings = rows.slice(0, limit).map((row) => ({
      finding_id: row.id,
      task_id: row.task_id,
      user_id: row.user_id,
      text: row.share_message ?? row.finding,
      confidence: row.confidence,
      created_at: row.created_at ? row.created_at.toISOString() : null,
    }));

    return c.json({ findings });
  });
}
