/**
 * Temporal activities for exploration workflows.
 *
 * Activities contain the actual I/O logic - database queries, LLM calls, etc.
 * They are non-deterministic and run in the worker process (not the workflow sandbox).
 */

import { sql } from "kysely";
import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  ExplorationOutputSchema,
} from "@dere/shared-llm";

import { getDb } from "../../db.js";
import { log } from "../../logger.js";
import { integrateFindings, type Finding } from "../../services/fact-checker.js";

// Types for activity inputs/outputs

export interface CuriosityTask {
  id: number;
  title: string;
  working_dir: string;
  description: string | null;
  context_summary: string | null;
  extra: Record<string, unknown> | null;
}

export interface ExplorationResult {
  findings: string[];
  confidence: number;
  follow_up_questions: string[];
  worth_sharing: boolean;
  share_message: string | null;
}

export interface ExplorationConfig {
  personality: string | null;
  user_id: string | null;
  model: string;
}

// Constants

const EXPLORATION_PROMPT = `
You are exploring a topic the user mentioned: {topic}

Context from conversation:
{source_context}

Your task:
1. Research this topic using available tools (web search, knowledge lookup)
2. Gather key facts that would be useful for future conversations
3. Note any follow-up questions worth exploring

Return output that matches the provided JSON schema.
`;

const EXPLORATION_ALLOWED_TOOLS = ["Read", "WebSearch", "WebFetch"];
const PROMOTION_CONFIDENCE_THRESHOLD = 0.7;

// Helper functions

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function buildPrompt(task: CuriosityTask): string {
  const extra = task.extra ?? {};
  const sourceContext =
    (extra.source_context as string | undefined) ??
    task.context_summary ??
    task.description ??
    "(no context captured)";
  return EXPLORATION_PROMPT.replace("{topic}", task.title).replace(
    "{source_context}",
    sourceContext,
  );
}

function buildResult(payload: Record<string, unknown>): ExplorationResult {
  const rawFindings = Array.isArray(payload.findings) ? payload.findings : [];
  const findings = rawFindings.map((item) => String(item).trim()).filter(Boolean);

  const rawQuestions = Array.isArray(payload.follow_up_questions)
    ? payload.follow_up_questions
    : [];
  const followUps = rawQuestions.map((item) => String(item).trim()).filter(Boolean);

  const confidenceRaw = Number(payload.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : 0;

  return {
    findings,
    confidence,
    follow_up_questions: followUps,
    worth_sharing: Boolean(payload.worth_sharing),
    share_message: typeof payload.share_message === "string" ? payload.share_message : null,
  };
}

function mergeFindings(existing: string[] | undefined, additions: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...(existing ?? []), ...additions]) {
    const normalized = String(item).trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

// Activities

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

/**
 * Run the actual LLM exploration for a task.
 * Creates a mission record and calls Claude with structured output.
 */
export async function runExploration(
  task: CuriosityTask,
  config: ExplorationConfig,
): Promise<{ result: ExplorationResult | null; errorMessage: string | null }> {
  const prompt = buildPrompt(task);
  const now = new Date();

  const db = await getDb();

  // Create mission record for tracking
  const mission = await db
    .insertInto("missions")
    .values({
      name: `temporal-exploration-${task.id}-${now.toISOString()}`,
      description: `Temporal exploration: ${task.title}`,
      prompt,
      cron_expression: "0 0 * * *",
      natural_language_schedule: null,
      timezone: "UTC",
      run_once: true,
      personality: config.personality,
      allowed_tools: EXPLORATION_ALLOWED_TOOLS,
      mcp_servers: null,
      plugins: null,
      thinking_budget: null,
      model: config.model,
      working_dir: task.working_dir,
      sandbox_mode: true,
      sandbox_mount_type: "none",
      sandbox_settings: null,
      status: "paused",
      next_execution_at: null,
      last_execution_at: null,
      user_id: config.user_id,
      created_at: now,
      updated_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  const startedAt = new Date();
  let decision: Record<string, unknown> | null = null;
  let errorMessage: string | null = null;

  try {
    const transport = new ClaudeAgentTransport({
      workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
    });
    const client = new StructuredOutputClient({
      transport,
      model: config.model,
    });

    decision = (await client.generate(prompt, ExplorationOutputSchema, {
      schemaName: "exploration_output",
      // Auto-approve these tools, let default tool set be used
      allowedTools: EXPLORATION_ALLOWED_TOOLS,
      permissionMode: "acceptEdits",
    })) as Record<string, unknown>;
  } catch (error) {
    errorMessage = String(error);
    log.ambient.error("Exploration LLM call failed", { taskId: task.id, error: errorMessage });
  }

  // Record execution result
  const completedAt = new Date();
  await db
    .insertInto("mission_executions")
    .values({
      mission_id: mission.id,
      status: decision ? "completed" : "failed",
      trigger_type: "temporal",
      triggered_by: "exploration_workflow",
      started_at: startedAt,
      completed_at: completedAt,
      output_text: decision ? JSON.stringify(decision) : null,
      output_summary:
        decision && typeof decision.share_message === "string" ? decision.share_message : null,
      tool_count: 0,
      error_message: errorMessage,
      execution_metadata: decision ? { structured_output: decision } : { error: errorMessage },
      created_at: completedAt,
    })
    .execute();

  await db
    .updateTable("missions")
    .set({ status: "archived", updated_at: completedAt })
    .where("id", "=", mission.id)
    .execute();

  if (!decision) {
    return { result: null, errorMessage: errorMessage ?? "no exploration output" };
  }

  return { result: buildResult(decision), errorMessage: null };
}

/**
 * Persist the exploration result to the task record.
 */
export async function persistResult(
  taskId: number,
  result: ExplorationResult | null,
  errorMessage: string | null,
): Promise<void> {
  const db = await getDb();
  const task = await db
    .selectFrom("project_tasks")
    .select(["id", "extra"])
    .where("id", "=", taskId)
    .executeTakeFirst();

  if (!task) {
    return;
  }

  const now = new Date();
  const extra = { ...toJsonRecord(task.extra) };

  if (result) {
    extra.findings = mergeFindings(extra.findings as string[] | undefined, result.findings);
    extra.exploration_count = Number(extra.exploration_count ?? 0) + 1;
    extra.last_explored_at = now.toISOString();
    const existing = Number(extra.satisfaction_level ?? 0);
    extra.satisfaction_level = Math.max(existing, result.confidence);
    extra.last_exploration_result = {
      findings: result.findings,
      confidence: result.confidence,
      follow_up_questions: result.follow_up_questions,
      worth_sharing: result.worth_sharing,
      share_message: result.share_message,
    };

    await db
      .updateTable("project_tasks")
      .set({
        status: "done",
        completed_at: now,
        outcome: "explored",
        last_error: null,
        extra,
        updated_at: now,
      })
      .where("id", "=", taskId)
      .execute();
  } else {
    await db
      .updateTable("project_tasks")
      .set({
        status: "ready",
        last_error: errorMessage ?? "exploration failed",
        extra,
        updated_at: now,
      })
      .where("id", "=", taskId)
      .execute();
  }
}

/**
 * Create follow-up curiosity tasks from exploration questions.
 */
export async function spawnFollowUps(
  task: CuriosityTask,
  questions: string[],
): Promise<number> {
  const followUps = questions.filter(Boolean).slice(0, 5);
  if (followUps.length === 0) {
    return 0;
  }

  const db = await getDb();
  let created = 0;

  for (const question of followUps) {
    const existing = await db
      .selectFrom("project_tasks")
      .select(["id"])
      .where("task_type", "=", "curiosity")
      .where("title", "=", question)
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      continue;
    }

    const now = new Date();
    const extra = {
      curiosity_type: "research_chain",
      source_context: task.title,
      trigger_reason: "follow_up_from_exploration",
    };

    await db
      .insertInto("project_tasks")
      .values({
        working_dir: task.working_dir,
        title: question,
        description: `Follow-up from exploration of '${task.title}'`,
        task_type: "curiosity",
        priority: 1,
        status: "ready",
        extra,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        acceptance_criteria: null,
        context_summary: null,
        scope_paths: null,
        required_tools: null,
        tags: null,
        estimated_effort: null,
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        attempt_count: 0,
        blocked_by: null,
        related_task_ids: null,
        created_by_session_id: null,
        created_by_agent_id: null,
        discovered_from_task_id: task.id,
        discovery_reason: "research_chain",
        outcome: null,
        completion_notes: null,
        files_changed: null,
        follow_up_task_ids: null,
        last_error: null,
      })
      .execute();

    created += 1;
  }

  return created;
}

/**
 * Store findings in exploration_findings table and promote to knowledge graph.
 */
export async function storeFindings(
  taskId: number,
  result: ExplorationResult,
  userId: string | null,
): Promise<{ storedCount: number; promotedCount: number; queuedCount: number }> {
  const uniqueFindings = Array.from(new Set(result.findings)).filter(Boolean);
  if (uniqueFindings.length === 0) {
    return { storedCount: 0, promotedCount: 0, queuedCount: 0 };
  }

  const db = await getDb();
  const task = await db
    .selectFrom("project_tasks")
    .select(["id", "extra"])
    .where("id", "=", taskId)
    .executeTakeFirst();

  if (!task) {
    return { storedCount: 0, promotedCount: 0, queuedCount: 0 };
  }

  const extra = toJsonRecord(task.extra) ?? {};

  // Store in exploration_findings table
  const existingRows = await db
    .selectFrom("exploration_findings")
    .select(["finding"])
    .where("task_id", "=", taskId)
    .where("finding", "in", uniqueFindings)
    .execute();

  const existing = new Set(existingRows.map((row) => row.finding));
  const sourceContext = typeof extra.source_context === "string" ? extra.source_context : null;
  const now = new Date();

  let storedCount = 0;
  for (const finding of uniqueFindings) {
    if (existing.has(finding)) {
      continue;
    }
    await db
      .insertInto("exploration_findings")
      .values({
        task_id: taskId,
        user_id: userId,
        finding,
        source_context: sourceContext,
        confidence: result.confidence,
        worth_sharing: result.worth_sharing,
        share_message: result.share_message,
        created_at: now,
        updated_at: now,
      })
      .execute();
    storedCount += 1;
  }

  // Promote to knowledge graph if confidence is high enough
  if (result.confidence < PROMOTION_CONFIDENCE_THRESHOLD) {
    return { storedCount, promotedCount: 0, queuedCount: 0 };
  }

  try {
    const groupId = userId || "default";
    const source = `curiosity:${taskId}`;

    const findingsToCheck: Finding[] = uniqueFindings.map((text) => ({
      fact: text,
      entityNames: [],
      source,
      context: `exploration task ${taskId}, confidence ${result.confidence}`,
    }));

    const integrationResult = await integrateFindings(findingsToCheck, groupId);
    const promoted = integrationResult.added.map((f) => f.uuid);

    if (promoted.length > 0) {
      const existingPromoted = Array.isArray(extra.promoted_fact_ids)
        ? extra.promoted_fact_ids.map((item) => String(item))
        : [];
      const mergedPromoted = Array.from(new Set([...existingPromoted, ...promoted]));
      const nextExtra = { ...extra, promoted_fact_ids: mergedPromoted };

      await db
        .updateTable("project_tasks")
        .set({
          extra: nextExtra,
          updated_at: now,
        })
        .where("id", "=", taskId)
        .execute();
    }

    return {
      storedCount,
      promotedCount: promoted.length,
      queuedCount: integrationResult.queued,
    };
  } catch (error) {
    log.ambient.warn("Finding promotion failed", { error: String(error) });
    return { storedCount, promotedCount: 0, queuedCount: 0 };
  }
}
