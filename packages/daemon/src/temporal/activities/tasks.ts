/**
 * Task CRUD operations for temporal exploration activities.
 */

import { sql } from "kysely";

import { getDb } from "../../db.js";
import { toJsonRecord } from "./helpers.js";
import type { CuriosityTask } from "./types.js";

/**
 * Get a task by ID (idempotent read).
 * Used by workflows that receive task ID as input.
 */
export async function getTaskById(taskId: number): Promise<CuriosityTask | null> {
  const db = await getDb();
  const task = await db
    .selectFrom("project_tasks")
    .select(["id", "title", "working_dir", "description", "context_summary", "extra"])
    .where("id", "=", taskId)
    .executeTakeFirst();

  if (!task) {
    return null;
  }

  return {
    ...task,
    extra: toJsonRecord(task.extra),
  };
}

/**
 * Claim a specific task by ID.
 * Called by starter before launching workflow.
 */
export async function claimTaskById(taskId: number): Promise<CuriosityTask | null> {
  const db = await getDb();
  let claimed: CuriosityTask | null = null;

  await db.transaction().execute(async (trx) => {
    const task = await trx
      .selectFrom("project_tasks")
      .select(["id", "title", "working_dir", "description", "context_summary", "extra", "status"])
      .where("id", "=", taskId)
      .forUpdate()
      .executeTakeFirst();

    if (!task || task.status !== "ready") {
      return;
    }

    const now = new Date();
    await trx
      .updateTable("project_tasks")
      .set({
        status: "in_progress",
        started_at: now,
        updated_at: now,
        attempt_count: sql<number>`attempt_count + 1`,
      })
      .where("id", "=", task.id)
      .execute();

    claimed = {
      id: task.id,
      title: task.title,
      working_dir: task.working_dir,
      description: task.description,
      context_summary: task.context_summary,
      extra: toJsonRecord(task.extra),
    };
  });

  return claimed;
}

/**
 * Release a claimed task back to ready status.
 * Called if workflow start fails after claiming.
 */
export async function releaseTask(taskId: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("project_tasks")
    .set({
      status: "ready",
      started_at: null,
      updated_at: new Date(),
    })
    .where("id", "=", taskId)
    .execute();
}

/**
 * Claim the next available curiosity task from the queue.
 * Uses SELECT FOR UPDATE SKIP LOCKED for atomic claiming.
 * @deprecated Use claimTaskById + getTaskById for workflow-safe claiming
 */
export async function claimNextTask(): Promise<CuriosityTask | null> {
  const db = await getDb();
  let claimed: CuriosityTask | null = null;

  await db.transaction().execute(async (trx) => {
    const task = await trx
      .selectFrom("project_tasks")
      .select(["id", "title", "working_dir", "description", "context_summary", "extra"])
      .where("task_type", "=", "curiosity")
      .where("status", "=", "ready")
      .orderBy("priority", "desc")
      .orderBy("created_at", "asc")
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!task) {
      return;
    }

    const now = new Date();
    await trx
      .updateTable("project_tasks")
      .set({
        status: "in_progress",
        started_at: now,
        updated_at: now,
        attempt_count: sql<number>`attempt_count + 1`,
      })
      .where("id", "=", task.id)
      .execute();

    claimed = {
      ...task,
      extra: toJsonRecord(task.extra),
    };
  });

  return claimed;
}
