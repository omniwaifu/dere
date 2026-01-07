/**
 * Types for Temporal swarm activities and workflows.
 *
 * These must be JSON-serializable for Temporal workflow state.
 */

// ============================================================================
// Input Types (passed to workflows/activities)
// ============================================================================

export interface SwarmSpec {
  swarmId: number;
  name: string;
  workingDir: string;
  description: string | null;
  gitBranchPrefix: string | null;
  baseBranch: string | null;
  autoSynthesize: boolean;
  synthesisPrompt: string | null;
  skipSynthesisOnFailure: boolean;
}

export interface AgentSpec {
  agentId: number;
  name: string;
  role: string;
  mode: "assigned" | "autonomous";
  prompt: string;
  isSynthesisAgent: boolean;
  personality: string | null;
  plugins: string[] | null;
  allowedTools: string[] | null;
  thinkingBudget: number | null;
  model: string | null;
  sandboxMode: boolean;
  // Autonomous mode settings
  goal: string | null;
  capabilities: string[] | null;
  taskTypes: string[] | null;
  maxTasks: number | null;
  maxDurationSeconds: number | null;
  idleTimeoutSeconds: number;
}

export interface DependencySpec {
  agentName: string;
  include: "summary" | "full" | "none";
  condition: string | null;
}

export interface AgentWithDependencies extends AgentSpec {
  dependsOn: DependencySpec[];
}

// ============================================================================
// Context Types (shared state between activities)
// ============================================================================

export interface SwarmContext {
  swarm: SwarmSpec;
  // JSON-serializable scratchpad
  scratchpad: Record<string, unknown>;
  // Results from completed agents
  agentResults: Record<string, AgentResult>;
}

// ============================================================================
// Result Types (returned from activities/workflows)
// ============================================================================

export interface AgentResult {
  name: string;
  status: "completed" | "failed" | "cancelled" | "skipped" | "timed_out";
  outputText: string;
  outputSummary: string | null;
  toolCount: number;
  toolNames: string[];
  errorMessage: string | null;
  durationSeconds: number;
  sessionId: number | null;
  // If agent produces structured output (e.g., synthesis findings)
  structuredOutput?: unknown;
}

export interface SwarmResult {
  swarmId: number;
  status: "completed" | "failed" | "cancelled";
  agentResults: Record<string, AgentResult>;
  synthesisOutput: string | null;
  scratchpad: Record<string, unknown>;
  durationSeconds: number;
}

// ============================================================================
// Activity Input Types
// ============================================================================

export interface CreateSessionInput {
  swarm: SwarmSpec;
  agent: AgentSpec;
}

export interface CloseSessionInput {
  sessionId: number;
}

export interface RunAgentQueryInput {
  swarm: SwarmSpec;
  agent: AgentSpec;
  prompt: string;
  sessionId: number;
}

export interface RunAgentQueryResult {
  outputText: string;
  toolCount: number;
  toolNames: string[];
  structuredOutput?: unknown;
}

export interface UpdateAgentStatusInput {
  agentId: number;
  status: string;
  outputText?: string;
  outputSummary?: string;
  toolCount?: number;
  errorMessage?: string;
}

export interface BuildDependencyContextInput {
  swarmId: number;
  agentId: number;
}

// ============================================================================
// Heartbeat Types
// ============================================================================

export interface AgentQueryHeartbeat {
  status: "running" | "finalizing";
  elapsedSeconds: number;
  toolCount?: number;
}

// ============================================================================
// Constants
// ============================================================================

export const SWARM_TASK_QUEUE = "dere-swarm";
export const DEFAULT_AGENT_TIMEOUT_SECONDS = 3600;
export const MAX_OUTPUT_SIZE = 50 * 1024;
export const SUMMARY_THRESHOLD = 1000;
