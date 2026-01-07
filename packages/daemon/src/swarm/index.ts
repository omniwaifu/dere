// Swarm module - barrel export
// Re-exports the main public API from split modules

// Types
export {
  STATUS,
  MEMORY_STEWARD_NAME,
  MEMORY_SCRATCHPAD_PREFIX,
  MEMORY_RECALL_QUERY_LIMIT,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  MAX_OUTPUT_SIZE,
  SUMMARY_THRESHOLD,
  SUMMARY_MODEL,
  INCLUDE_MODES,
  isAgentTerminal,
  AgentTimeoutError,
  type DependencySpec,
  type AgentSpec,
  type SwarmRow,
  type SwarmAgentRow,
} from "./types.js";

// State (already exists)
export { swarmState, type CompletionSignal } from "./state.js";

// Utils
export {
  withTimeout,
  nowDate,
  nowSeconds,
  toJsonValue,
  parseJson,
  truncateOutput,
  resolvePluginPaths,
  collectText,
} from "./utils.js";

// Prompts
export {
  buildRecallQuery,
  buildMemoryPromptPrefix,
  buildMemoryStewardPrompt,
  buildDefaultSynthesisPrompt,
  buildSupervisorPrompt,
  buildTaskPrompt,
} from "./prompts.js";

// Dependencies
export {
  detectDependencyCycle,
  evaluateCondition,
  computeCriticalPath,
} from "./dependencies.js";

// Agent query
export {
  extractBlocksFromAssistantMessage,
  runAgentQuery,
  generateSummary,
  type MessageBlock,
} from "./agent-query.js";

// Execution
export {
  getCompletionSignal,
  getSwarmWithAgents,
  createSessionForAgent,
  insertConversation,
  insertAssistantBlocks,
  buildDependencyContext,
  executeAssignedAgent,
  claimTaskForAgent,
  executeAutonomousAgent,
  executeAgentWithDependencies,
} from "./execution.js";

// Orchestration
export {
  runSwarm,
  startSwarmExecution,
  cleanupOrphanedSwarms,
} from "./orchestration.js";

// Git
export {
  runGitCommand,
  getCurrentBranch,
  createBranch,
  mergeBranch,
  listPlugins,
} from "./git.js";

// Routes
export { registerSwarmRoutes } from "./routes.js";
