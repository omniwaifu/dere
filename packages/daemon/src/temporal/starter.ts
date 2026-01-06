/**
 * Workflow starters for use by daemon.
 *
 * Claims tasks BEFORE starting workflows to ensure retry-safe behavior.
 * If worker dies mid-workflow, Temporal retries from beginning with same taskId.
 */

import { getTemporalClient, TASK_QUEUES } from "./client.js";
import { log } from "../logger.js";
import { getDb } from "../db.js";
import { sql } from "kysely";

import type { ExplorationWorkflowResult } from "./workflows/index.js";

export interface StartExplorationOptions {
  taskId?: number; // If provided, use this task. Otherwise claim next available.
  personality?: string | null;
  user_id?: string | null;
  model?: string;
}

/**
 * Claim the next available curiosity task.
 * Returns null if no tasks available.
 */
async function claimNextCuriosityTask(): Promise<{ id: number; title: string } | null> {
  const db = await getDb();
  let claimed: { id: number; title: string } | null = null;

  await db.transaction().execute(async (trx) => {
    const task = await trx
      .selectFrom("project_tasks")
      .select(["id", "title"])
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

    claimed = task;
  });

  return claimed;
}

/**
 * Release a claimed task back to ready status.
 */
async function releaseTask(taskId: number): Promise<void> {
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
 * Start a single exploration workflow.
 * Claims task BEFORE starting workflow for retry safety.
 */
export async function startExplorationWorkflow(
  options: StartExplorationOptions = {},
): Promise<{ workflowId: string; runId: string; taskId: number } | null> {
  // Step 1: Claim task (outside workflow boundary)
  let taskId = options.taskId;
  let taskTitle = "provided task";

  if (!taskId) {
    const claimed = await claimNextCuriosityTask();
    if (!claimed) {
      log.ambient.info("No pending curiosity tasks found");
      return null;
    }
    taskId = claimed.id;
    taskTitle = claimed.title;
  }

  log.ambient.info("Claimed task for exploration", { taskId, title: taskTitle });

  // Step 2: Start workflow with claimed task ID
  const client = await getTemporalClient();
  const workflowId = `exploration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const handle = await client.workflow.start("explorationWorkflow", {
      taskQueue: TASK_QUEUES.EXPLORATION,
      workflowId,
      args: [
        {
          taskId,
          personality: options.personality ?? null,
          user_id: options.user_id ?? null,
          model: options.model ?? process.env.DERE_AMBIENT_MODEL ?? "claude-haiku-4-5",
        },
      ],
    });

    log.ambient.info("Started exploration workflow", {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      taskId,
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      taskId,
    };
  } catch (error) {
    // Workflow start failed - release the claimed task
    log.ambient.error("Failed to start workflow, releasing task", {
      taskId,
      error: String(error),
    });
    await releaseTask(taskId);
    throw error;
  }
}

/**
 * Start exploration and wait for result.
 * Blocks until workflow completes.
 * Returns null if no tasks available.
 */
export async function executeExploration(
  options: StartExplorationOptions = {},
): Promise<ExplorationWorkflowResult | null> {
  const started = await startExplorationWorkflow(options);
  if (!started) {
    return null;
  }

  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(started.workflowId);
  const result = (await handle.result()) as ExplorationWorkflowResult;
  return result;
}

/**
 * Claim multiple curiosity tasks for batch processing.
 */
async function claimMultipleCuriosityTasks(
  maxTasks: number,
): Promise<{ id: number; title: string }[]> {
  const db = await getDb();
  const claimed: { id: number; title: string }[] = [];

  // Claim tasks one at a time to respect SKIP LOCKED semantics
  for (let i = 0; i < maxTasks; i++) {
    let task: { id: number; title: string } | null = null;

    await db.transaction().execute(async (trx) => {
      const found = await trx
        .selectFrom("project_tasks")
        .select(["id", "title"])
        .where("task_type", "=", "curiosity")
        .where("status", "=", "ready")
        .orderBy("priority", "desc")
        .orderBy("created_at", "asc")
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();

      if (!found) {
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
        .where("id", "=", found.id)
        .execute();

      task = found;
    });

    if (!task) {
      break; // No more tasks available
    }
    claimed.push(task);
  }

  return claimed;
}

/**
 * Release multiple claimed tasks back to ready status.
 */
async function releaseMultipleTasks(taskIds: number[]): Promise<void> {
  if (taskIds.length === 0) return;

  const db = await getDb();
  await db
    .updateTable("project_tasks")
    .set({
      status: "ready",
      started_at: null,
      updated_at: new Date(),
    })
    .where("id", "in", taskIds)
    .execute();
}

export interface StartBatchExplorationOptions {
  maxTasks?: number;
  delayBetweenMs?: number;
  personality?: string | null;
  user_id?: string | null;
  model?: string;
}

/**
 * Start a batch exploration workflow.
 * Claims tasks BEFORE starting workflow for retry safety.
 */
export async function startBatchExplorationWorkflow(
  options: StartBatchExplorationOptions = {},
): Promise<{ workflowId: string; runId: string; taskIds: number[] } | null> {
  const maxTasks = options.maxTasks ?? 5;

  // Step 1: Claim tasks (outside workflow boundary)
  const claimed = await claimMultipleCuriosityTasks(maxTasks);
  if (claimed.length === 0) {
    log.ambient.info("No pending curiosity tasks found for batch");
    return null;
  }

  const taskIds = claimed.map((t) => t.id);
  log.ambient.info("Claimed tasks for batch exploration", {
    count: taskIds.length,
    taskIds,
  });

  // Step 2: Start workflow with claimed task IDs
  const client = await getTemporalClient();
  const workflowId = `batch-exploration-${Date.now()}`;

  try {
    const handle = await client.workflow.start("batchExplorationWorkflow", {
      taskQueue: TASK_QUEUES.EXPLORATION,
      workflowId,
      args: [
        {
          taskIds,
          personality: options.personality ?? null,
          user_id: options.user_id ?? null,
          model: options.model ?? process.env.DERE_AMBIENT_MODEL ?? "claude-haiku-4-5",
          delayBetweenMs: options.delayBetweenMs ?? 30000,
        },
      ],
    });

    log.ambient.info("Started batch exploration workflow", {
      workflowId: handle.workflowId,
      taskCount: taskIds.length,
    });

    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      taskIds,
    };
  } catch (error) {
    // Workflow start failed - release all claimed tasks
    log.ambient.error("Failed to start batch workflow, releasing tasks", {
      taskIds,
      error: String(error),
    });
    await releaseMultipleTasks(taskIds);
    throw error;
  }
}

/**
 * Get workflow status by ID.
 */
export async function getWorkflowStatus(workflowId: string): Promise<{
  status: string;
  result?: ExplorationWorkflowResult;
  error?: string;
}> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);

  try {
    const description = await handle.describe();
    const status = description.status.name;

    if (status === "COMPLETED") {
      const result = await handle.result();
      return { status, result };
    }

    if (status === "FAILED" || status === "TERMINATED" || status === "TIMED_OUT") {
      return { status, error: `Workflow ${status.toLowerCase()}` };
    }

    return { status };
  } catch (error) {
    return { status: "UNKNOWN", error: String(error) };
  }
}
