/**
 * Swarm activities for Temporal workflows.
 *
 * Activities are the non-deterministic building blocks of workflows.
 * They handle I/O: database queries, LLM calls, file operations.
 */

// Types
export type {
  SwarmSpec,
  AgentSpec,
  DependencySpec,
  AgentWithDependencies,
  SwarmContext,
  AgentResult,
  SwarmResult,
  CreateSessionInput,
  CloseSessionInput,
  RunAgentQueryInput,
  RunAgentQueryResult,
  AgentQueryHeartbeat,
} from "./types.js";

export {
  SWARM_TASK_QUEUE,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  MAX_OUTPUT_SIZE,
  SUMMARY_THRESHOLD,
} from "./types.js";

// Session management
export { createAgentSession, closeAgentSession } from "./session.js";

// Agent query execution
export { runAgentQueryWithHeartbeat, generateOutputSummary } from "./agent-query.js";

// Database operations
export {
  markAgentRunning,
  markAgentCompleted,
  markAgentFailed,
  markAgentSkipped,
  recordConversation,
  recordAssistantBlocks,
  updateSynthesisOutput,
  updateSwarmStatus,
  getAgentOutput,
  getSwarmAgents,
} from "./database.js";
export type {
  UpdateAgentRunningInput,
  UpdateAgentCompletedInput,
  UpdateAgentFailedInput,
  MarkAgentSkippedInput,
  RecordConversationInput,
  RecordAssistantBlocksInput,
  UpdateSynthesisOutputInput,
  UpdateSwarmStatusInput,
  GetAgentOutputInput,
  AgentOutput,
  GetSwarmAgentsInput,
  SwarmAgentInfo,
} from "./database.js";
