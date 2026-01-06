/**
 * Test script to trigger exploration workflow and verify end-to-end.
 *
 * Run with: bun packages/daemon/src/temporal/test-exploration.ts
 * Or via justfile: just explore-test
 *
 * Prerequisites:
 * - Infrastructure running: just infra
 * - Worker running: just temporal-worker (in another terminal)
 */

import { executeExploration, getWorkflowStatus } from "./starter.js";
import { getDb } from "../db.js";

async function main() {
  console.log("=== Temporal Exploration E2E Test ===\n");

  // Check for pending curiosity tasks
  const db = await getDb();
  const pendingTasks = await db
    .selectFrom("project_tasks")
    .select(["id", "title"])
    .where("task_type", "=", "curiosity")
    .where("status", "=", "ready")
    .limit(5)
    .execute();

  console.log(`Found ${pendingTasks.length} pending curiosity tasks:`);
  for (const task of pendingTasks) {
    console.log(`  - [${task.id}] ${task.title}`);
  }

  if (pendingTasks.length === 0) {
    console.log("\nNo pending tasks. Creating a test curiosity task...");

    const now = new Date();
    await db
      .insertInto("project_tasks")
      .values({
        working_dir: process.cwd(),
        title: "What is the history of the Temporal workflow engine?",
        description: "Test curiosity task for temporal PoC",
        task_type: "curiosity",
        priority: 10,
        status: "ready",
        extra: {
          curiosity_type: "test",
          source_context: "temporal integration test",
        },
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        acceptance_criteria: null,
        context_summary: null,
        scope_paths: null,
        required_tools: null,
        tags: ["test", "temporal-poc"],
        estimated_effort: null,
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        attempt_count: 0,
        blocked_by: null,
        related_task_ids: null,
        created_by_session_id: null,
        created_by_agent_id: null,
        discovered_from_task_id: null,
        discovery_reason: "test",
        outcome: null,
        completion_notes: null,
        files_changed: null,
        follow_up_task_ids: null,
        last_error: null,
      })
      .execute();

    console.log("Created test task.\n");
  }

  console.log("\nStarting exploration workflow...");
  console.log("(Watch temporal UI at http://localhost:8080)\n");

  try {
    const startTime = Date.now();
    const result = await executeExploration({
      user_id: "test-user",
      personality: null,
      model: process.env.DERE_AMBIENT_MODEL ?? "claude-sonnet-4-5",
    });

    if (!result) {
      console.log("\n=== No tasks to process ===");
      console.log("Create a curiosity task first, then re-run.");
      return;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n=== Workflow completed in ${duration}s ===\n`);
    console.log("Result:", JSON.stringify(result, null, 2));

    if (result.taskId) {
      // Verify task was updated in DB
      const task = await db
        .selectFrom("project_tasks")
        .select(["id", "title", "status", "outcome", "extra"])
        .where("id", "=", result.taskId)
        .executeTakeFirst();

      console.log("\n=== DB Verification ===");
      console.log(`Task ${result.taskId} status: ${task?.status}`);
      console.log(`Task outcome: ${task?.outcome}`);

      // Check exploration_findings
      const findings = await db
        .selectFrom("exploration_findings")
        .select(["id", "finding"])
        .where("task_id", "=", result.taskId)
        .execute();

      console.log(`Findings stored: ${findings.length}`);
      for (const f of findings.slice(0, 3)) {
        console.log(`  - ${f.finding.slice(0, 80)}...`);
      }

      // Check mission_executions
      const executions = await db
        .selectFrom("mission_executions")
        .select(["id", "status", "trigger_type"])
        .where("trigger_type", "=", "temporal")
        .orderBy("created_at", "desc")
        .limit(1)
        .execute();

      const execution = executions[0];
      if (execution) {
        console.log(`\nMission execution: ${execution.status} (trigger: ${execution.trigger_type})`);
      }
    }

    console.log("\n=== E2E Test PASSED ===");
  } catch (error) {
    console.error("\n=== E2E Test FAILED ===");
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
