import type { Hono } from "hono";
import { sql } from "kysely";

import { getDb } from "./db.js";

const STATUSES = [
  "backlog",
  "ready",
  "claimed",
  "in_progress",
  "done",
  "blocked",
  "cancelled",
] as const;

function toNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function registerMetricsRoutes(app: Hono): void {
  app.get("/metrics/exploration", async (c) => {
    const userId = c.req.query("user_id");
    const daysBack = Math.max(1, toNumber(c.req.query("days_back"), 30));
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const db = await getDb();

    let tasksQuery = db
      .selectFrom("project_tasks")
      .select(["status"])
      .where("task_type", "=", "curiosity")
      .where("created_at", ">=", cutoff);

    let findingsQuery = db
      .selectFrom("exploration_findings")
      .select(["worth_sharing", "confidence"])
      .where("created_at", ">=", cutoff);

    let surfacedQuery = db
      .selectFrom("surfaced_findings")
      .select(["id"])
      .where("surfaced_at", ">=", cutoff);

    if (userId) {
      tasksQuery = tasksQuery.where(sql`extra->>'user_id' = ${userId}`);
      findingsQuery = findingsQuery.where("user_id", "=", userId);
    }

    const [tasks, findings, surfaced] = await Promise.all([
      tasksQuery.execute(),
      findingsQuery.execute(),
      surfacedQuery.execute(),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const status of STATUSES) {
      statusCounts[status] = 0;
    }
    for (const task of tasks) {
      if (!task.status) {
        continue;
      }
      statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    }

    const shareable = findings.filter((finding) => Boolean(finding.worth_sharing));
    let avgConfidence: number | null = null;
    if (findings.length > 0) {
      const total = findings.reduce((sum, finding) => sum + (finding.confidence ?? 0), 0);
      avgConfidence = total / findings.length;
    }

    return c.json({
      window_days: daysBack,
      curiosity_tasks: {
        total: tasks.length,
        by_status: statusCounts,
      },
      findings: {
        total: findings.length,
        shareable: shareable.length,
        avg_confidence: avgConfidence,
      },
      surfaced: {
        total: surfaced.length,
      },
    });
  });
}
