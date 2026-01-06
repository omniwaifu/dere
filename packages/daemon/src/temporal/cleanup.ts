/**
 * Cleanup utilities for temporal workflows.
 *
 * Handles edge cases like worker crashes where the workflow
 * can't release the task itself.
 */

import { getDb } from "../db.js";
import { log } from "../logger.js";

const STALE_THRESHOLD_HOURS = 6;

/**
 * Release tasks that have been in_progress for too long.
 *
 * Called on daemon startup to handle cases where:
 * - Worker died mid-activity (no catch block runs)
 * - Workflow timed out without cleanup
 * - Any other edge case that leaves tasks orphaned
 */
export async function cleanupStaleTasks(): Promise<number> {
  const db = await getDb();

  // Calculate threshold in JS to avoid Kysely type issues
  const threshold = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

  const result = await db
    .updateTable("project_tasks")
    .set({
      status: "ready",
      started_at: null,
      updated_at: new Date(),
    })
    .where("status", "=", "in_progress")
    .where("updated_at", "<", threshold)
    .returning(["id", "title"])
    .execute();

  if (result.length > 0) {
    log.ambient.info("Released stale in_progress tasks", {
      count: result.length,
      tasks: result.map((t) => ({ id: t.id, title: t.title })),
    });
  }

  return result.length;
}
