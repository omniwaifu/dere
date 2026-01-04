import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  ExplorationOutputSchema,
} from "@dere/shared-llm";
import { addFact } from "@dere/graph";
import { integrateFindings, type Finding } from "./services/fact-checker.js";
import { sql } from "kysely";

import type { AmbientConfig } from "./ambient-config.js";
import { getDb } from "./db.js";
import { log } from "./logger.js";

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

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export interface ExplorationResult {
  findings: string[];
  confidence: number;
  follow_up_questions: string[];
  worth_sharing: boolean;
  share_message: string | null;
}

export interface ExplorationOutcome {
  task_id: number;
  result: ExplorationResult | null;
  error_message: string | null;
}

export class AmbientExplorer {
  private config: AmbientConfig;

  constructor(config: AmbientConfig) {
    this.config = config;
  }

  async hasPendingCuriosities(): Promise<boolean> {
    const db = await getDb();
    const row = await db
      .selectFrom("project_tasks")
      .select(["id"])
      .where("task_type", "=", "curiosity")
      .where("status", "=", "ready")
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }

  async exploreNext(): Promise<ExplorationOutcome | null> {
    const task = await this.claimNextTask();
    if (!task) {
      return null;
    }

    const { result, errorMessage } = await this.runExploration(task);
    await this.persistResult(task.id, result, errorMessage);

    if (result && result.follow_up_questions.length > 0) {
      await this.spawnFollowUps(task, result.follow_up_questions);
    }

    return { task_id: task.id, result, error_message: errorMessage };
  }

  private async claimNextTask(): Promise<{
    id: number;
    title: string;
    working_dir: string;
    description: string | null;
    context_summary: string | null;
    extra: Record<string, unknown> | null;
  } | null> {
    const db = await getDb();
    let claimed: {
      id: number;
      title: string;
      working_dir: string;
      description: string | null;
      context_summary: string | null;
      extra: Record<string, unknown> | null;
    } | null = null;

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

  private buildPrompt(task: {
    title: string;
    description: string | null;
    context_summary: string | null;
    extra: Record<string, unknown> | null;
  }): string {
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

  private async runExploration(task: {
    id: number;
    title: string;
    working_dir: string;
    description: string | null;
    context_summary: string | null;
    extra: Record<string, unknown> | null;
  }): Promise<{ result: ExplorationResult | null; errorMessage: string | null }> {
    const prompt = this.buildPrompt(task);
    const now = new Date();

    const db = await getDb();
    const mission = await db
      .insertInto("missions")
      .values({
        name: `ambient-exploration-${task.id}-${now.toISOString()}`,
        description: `Ambient exploration: ${task.title}`,
        prompt,
        cron_expression: "0 0 * * *",
        natural_language_schedule: null,
        timezone: "UTC",
        run_once: true,
        personality: this.config.personality,
        allowed_tools: EXPLORATION_ALLOWED_TOOLS,
        mcp_servers: null,
        plugins: null,
        thinking_budget: null,
        model:
          process.env.DERE_AMBIENT_EXPLORATION_MODEL ??
          process.env.DERE_AMBIENT_MODEL ??
          "claude-haiku-4-5",
        working_dir: task.working_dir,
        sandbox_mode: true,
        sandbox_mount_type: "none",
        sandbox_settings: null,
        status: "paused",
        next_execution_at: null,
        last_execution_at: null,
        user_id: this.config.user_id,
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
        model:
          process.env.DERE_AMBIENT_EXPLORATION_MODEL ??
          process.env.DERE_AMBIENT_MODEL ??
          "claude-haiku-4-5",
      });

      decision = (await client.generate(prompt, ExplorationOutputSchema, {
        schemaName: "exploration_output",
      })) as Record<string, unknown>;
    } catch (error) {
      errorMessage = String(error);
    }

    const completedAt = new Date();
    await db
      .insertInto("mission_executions")
      .values({
        mission_id: mission.id,
        status: decision ? "completed" : "failed",
        trigger_type: "manual",
        triggered_by: "ambient_exploration",
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

    return { result: this.buildResult(decision), errorMessage: null };
  }

  private buildResult(payload: Record<string, unknown>): ExplorationResult {
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

  private async persistResult(
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

      if (result.findings.length > 0) {
        await this.storeFindings(taskId, result, extra);
      }
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

  private async spawnFollowUps(
    task: {
      id: number;
      title: string;
      working_dir: string;
    },
    questions: string[],
  ): Promise<void> {
    const followUps = questions.filter(Boolean).slice(0, 5);
    if (followUps.length === 0) {
      return;
    }

    const db = await getDb();
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
    }
  }

  private async storeFindings(
    taskId: number,
    result: ExplorationResult,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const uniqueFindings = Array.from(new Set(result.findings)).filter(Boolean);
    if (uniqueFindings.length === 0) {
      return;
    }

    const db = await getDb();
    const existingRows = await db
      .selectFrom("exploration_findings")
      .select(["finding"])
      .where("task_id", "=", taskId)
      .where("finding", "in", uniqueFindings)
      .execute();

    const existing = new Set(existingRows.map((row) => row.finding));
    const sourceContext = typeof extra.source_context === "string" ? extra.source_context : null;
    const now = new Date();

    for (const finding of uniqueFindings) {
      if (existing.has(finding)) {
        continue;
      }
      await db
        .insertInto("exploration_findings")
        .values({
          task_id: taskId,
          user_id: this.config.user_id,
          finding,
          source_context: sourceContext,
          confidence: result.confidence,
          worth_sharing: result.worth_sharing,
          share_message: result.share_message,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    if (result.confidence < PROMOTION_CONFIDENCE_THRESHOLD) {
      return;
    }

    try {
      const groupId = this.config.user_id || "default";
      const source = `curiosity:${taskId}`;
      const now = new Date();

      // Convert findings to the fact-checker format
      const findingsToCheck: Finding[] = uniqueFindings.map((text) => ({
        fact: text,
        entityNames: [], // TODO: extract entities from finding text
        source,
        context: `exploration task ${taskId}, confidence ${result.confidence}`,
      }));

      // Use fact-checker to integrate findings (checks for contradictions)
      const integrationResult = await integrateFindings(findingsToCheck, groupId);
      const promoted = integrationResult.added.map((f) => f.uuid);

      if (integrationResult.queued > 0) {
        log.ambient.info("Findings queued for contradiction review", {
          taskId,
          queued: integrationResult.queued,
        });
      }

      if (promoted.length === 0) {
        return;
      }

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
    } catch (error) {
      log.ambient.warn("Finding promotion failed", { error: String(error) });
    }
  }
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
