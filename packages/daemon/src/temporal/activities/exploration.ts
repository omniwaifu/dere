/**
 * LLM exploration execution for temporal activities.
 */

import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  ExplorationOutputSchema,
} from "@dere/shared-llm";

import { getDb } from "../../db.js";
import { log } from "../../logger.js";
import { buildPrompt, buildResult } from "./helpers.js";
import {
  EXPLORATION_ALLOWED_TOOLS,
  type CuriosityTask,
  type ExplorationConfig,
  type ExplorationResult,
} from "./types.js";

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
