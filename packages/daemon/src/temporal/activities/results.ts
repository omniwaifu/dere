/**
 * Result persistence and findings storage for temporal activities.
 */

import { getDb } from "../../db.js";
import { log } from "../../logger.js";
import { integrateFindings, type Finding } from "../../services/fact-checker.js";
import { toJsonRecord, mergeFindings } from "./helpers.js";
import { PROMOTION_CONFIDENCE_THRESHOLD, type ExplorationResult } from "./types.js";

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
