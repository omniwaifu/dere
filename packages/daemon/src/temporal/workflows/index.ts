/**
 * Temporal workflows for exploration.
 *
 * Workflows define the high-level orchestration logic.
 * They must be deterministic - all I/O happens in activities.
 */

import { proxyActivities, sleep, log } from "@temporalio/workflow";

// Re-export test workflow
export { testWorkflow } from "./test.js";

import type * as activities from "../activities/index.js";

// Proxy activities with retry configuration
const {
  getTaskById,
  runExploration,
  persistResult,
  spawnFollowUps,
  storeFindings,
  releaseTask,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface ExplorationWorkflowInput {
  taskId: number;
  personality: string | null;
  user_id: string | null;
  model: string;
}

export interface ExplorationWorkflowResult {
  taskId: number | null;
  success: boolean;
  findings: string[];
  followUpsCreated: number;
  findingsStored: number;
  findingsPromoted: number;
  errorMessage: string | null;
}

/**
 * Main exploration workflow.
 *
 * Task is claimed by starter BEFORE workflow starts (Option A pattern).
 * This ensures retry-safe behavior: if worker dies mid-workflow,
 * Temporal retries from beginning with same taskId input.
 *
 * Steps:
 * 1. Get task by ID (idempotent read)
 * 2. Run LLM exploration with structured output
 * 3. Persist results to task record
 * 4. Spawn follow-up curiosity tasks
 * 5. Store findings and promote to knowledge graph
 */
export async function explorationWorkflow(
  input: ExplorationWorkflowInput,
): Promise<ExplorationWorkflowResult> {
  log.info("Starting exploration workflow", { taskId: input.taskId, model: input.model });

  try {
    // Step 1: Get task (already claimed by starter)
    const task = await getTaskById(input.taskId);
    if (!task) {
      log.warn("Task not found", { taskId: input.taskId });
      return {
        taskId: input.taskId,
        success: false,
        findings: [],
        followUpsCreated: 0,
        findingsStored: 0,
        findingsPromoted: 0,
        errorMessage: `Task ${input.taskId} not found`,
      };
    }

    log.info("Processing task", { taskId: task.id, title: task.title });

    // Step 2: Run exploration
    const explorationResult = await runExploration(task, {
      personality: input.personality,
      user_id: input.user_id,
      model: input.model,
    });

    // Step 3: Persist result (success or failure)
    await persistResult(task.id, explorationResult.result, explorationResult.errorMessage);

    if (!explorationResult.result) {
      log.warn("Exploration failed", { taskId: task.id, error: explorationResult.errorMessage });
      return {
        taskId: task.id,
        success: false,
        findings: [],
        followUpsCreated: 0,
        findingsStored: 0,
        findingsPromoted: 0,
        errorMessage: explorationResult.errorMessage,
      };
    }

    const result = explorationResult.result;
    log.info("Exploration completed", {
      taskId: task.id,
      findingsCount: result.findings.length,
      confidence: result.confidence,
    });

    // Step 4: Spawn follow-up tasks
    let followUpsCreated = 0;
    if (result.follow_up_questions.length > 0) {
      followUpsCreated = await spawnFollowUps(task, result.follow_up_questions);
      log.info("Follow-ups spawned", { count: followUpsCreated });
    }

    // Step 5: Store findings
    const storeResult = await storeFindings(task.id, result, input.user_id);
    log.info("Findings stored", {
      stored: storeResult.storedCount,
      promoted: storeResult.promotedCount,
      queued: storeResult.queuedCount,
    });

    return {
      taskId: task.id,
      success: true,
      findings: result.findings,
      followUpsCreated,
      findingsStored: storeResult.storedCount,
      findingsPromoted: storeResult.promotedCount,
      errorMessage: null,
    };
  } catch (error) {
    // Release task before propagating failure
    // This handles auth errors, LLM failures, etc.
    log.error("Workflow failed, releasing task", { taskId: input.taskId, error: String(error) });
    await releaseTask(input.taskId);
    throw error;
  }
}

export interface BatchExplorationWorkflowInput {
  taskIds: number[];
  personality: string | null;
  user_id: string | null;
  model: string;
  delayBetweenMs: number;
}

/**
 * Batch exploration workflow.
 *
 * Tasks are claimed by starter BEFORE workflow starts.
 * Processes a list of task IDs with delay between each.
 */
export async function batchExplorationWorkflow(
  input: BatchExplorationWorkflowInput,
): Promise<{ completed: number; results: ExplorationWorkflowResult[] }> {
  const results: ExplorationWorkflowResult[] = [];

  for (let i = 0; i < input.taskIds.length; i++) {
    const taskId = input.taskIds[i]!;
    const result = await explorationWorkflow({
      taskId,
      personality: input.personality,
      user_id: input.user_id,
      model: input.model,
    });
    results.push(result);

    // Delay before next task (except after last one)
    if (i < input.taskIds.length - 1) {
      await sleep(input.delayBetweenMs);
    }
  }

  return {
    completed: results.filter((r) => r.success).length,
    results,
  };
}
