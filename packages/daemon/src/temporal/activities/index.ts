/**
 * Temporal activities for exploration workflows.
 *
 * Activities contain the actual I/O logic - database queries, LLM calls, etc.
 * They are non-deterministic and run in the worker process (not the workflow sandbox).
 */

// Types and constants
export type { CuriosityTask, ExplorationResult, ExplorationConfig } from "./types.js";
export { EXPLORATION_ALLOWED_TOOLS, PROMOTION_CONFIDENCE_THRESHOLD } from "./types.js";

// Task CRUD operations
export { getTaskById, claimTaskById, releaseTask, claimNextTask } from "./tasks.js";

// Exploration execution
export { runExploration } from "./exploration.js";

// Result persistence and findings
export { persistResult, storeFindings } from "./results.js";

// Follow-up and gap task creation
export { spawnFollowUps, createGapTasks, createUnderexploredTasks } from "./followups.js";
