// Swarm types, constants, and error classes

export const MAX_OUTPUT_SIZE = 50 * 1024;
export const SUMMARY_THRESHOLD = 1000;
export const SUMMARY_MODEL = "claude-haiku-4-5";

export const MEMORY_STEWARD_NAME = "memory-steward";
export const MEMORY_SCRATCHPAD_PREFIX = "memory/";
export const MEMORY_RECALL_QUERY_LIMIT = 200;
export const DEFAULT_AGENT_TIMEOUT_SECONDS = 3600; // 1 hour default timeout for assigned agents

export const STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
  TIMED_OUT: "timed_out",
} as const;

export const INCLUDE_MODES = new Set(["summary", "full", "none"]);

export type DependencySpec = {
  agent: string;
  include: "summary" | "full" | "none";
  condition?: string | null;
};

export type AgentSpec = {
  name: string;
  prompt: string;
  role: string;
  mode: string;
  personality: string | null;
  plugins: string[] | null;
  depends_on: DependencySpec[] | null;
  allowed_tools: string[] | null;
  thinking_budget: number | null;
  model: string | null;
  sandbox_mode: boolean;
  goal: string | null;
  capabilities: string[] | null;
  task_types: string[] | null;
  max_tasks: number | null;
  max_duration_seconds: number | null;
  idle_timeout_seconds: number;
};

export type SwarmRow = {
  id: number;
  name: string;
  description: string | null;
  parent_session_id: number | null;
  working_dir: string;
  git_branch_prefix: string | null;
  base_branch: string | null;
  status: string;
  auto_synthesize: boolean;
  synthesis_prompt: string | null;
  skip_synthesis_on_failure: boolean;
  synthesis_output: string | null;
  synthesis_summary: string | null;
  auto_supervise: boolean;
  supervisor_warn_seconds: number;
  supervisor_cancel_seconds: number;
  created_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
};

export type SwarmAgentRow = {
  id: number;
  swarm_id: number;
  name: string;
  role: string;
  is_synthesis_agent: boolean;
  mode: string;
  prompt: string;
  goal: string | null;
  capabilities: string[] | null;
  task_types: string[] | null;
  max_tasks: number | null;
  max_duration_seconds: number | null;
  idle_timeout_seconds: number;
  tasks_completed: number;
  tasks_failed: number;
  current_task_id: number | null;
  personality: string | null;
  plugins: string[] | null;
  git_branch: string | null;
  allowed_tools: string[] | null;
  thinking_budget: number | null;
  model: string | null;
  sandbox_mode: boolean;
  depends_on: Array<{ agent_id: number; include: string; condition?: string | null }> | null;
  session_id: number | null;
  status: string;
  output_text: string | null;
  output_summary: string | null;
  error_message: string | null;
  tool_count: number;
  created_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
};

export function isAgentTerminal(status: string): boolean {
  return (
    status === STATUS.COMPLETED ||
    status === STATUS.FAILED ||
    status === STATUS.CANCELLED ||
    status === STATUS.SKIPPED ||
    status === STATUS.TIMED_OUT
  );
}

/**
 * Base class for all swarm-related errors.
 * Provides structured error information for logging and debugging.
 */
export class SwarmError extends Error {
  readonly swarmId?: number;
  readonly agentId?: number;
  readonly agentName?: string;
  readonly cause?: Error;

  constructor(
    message: string,
    context?: {
      swarmId?: number;
      agentId?: number;
      agentName?: string;
      cause?: Error;
    },
  ) {
    super(message);
    this.name = "SwarmError";
    if (context?.swarmId !== undefined) this.swarmId = context.swarmId;
    if (context?.agentId !== undefined) this.agentId = context.agentId;
    if (context?.agentName !== undefined) this.agentName = context.agentName;
    if (context?.cause !== undefined) this.cause = context.cause;
  }

  /**
   * Returns a structured object for logging.
   */
  toLogContext(): Record<string, unknown> {
    return {
      error: this.message,
      errorType: this.name,
      swarmId: this.swarmId,
      agentId: this.agentId,
      agentName: this.agentName,
      cause: this.cause?.message,
    };
  }
}

export class AgentTimeoutError extends SwarmError {
  readonly timeoutSeconds: number;

  constructor(seconds: number, context?: { swarmId?: number; agentId?: number; agentName?: string }) {
    super(`Agent execution timed out after ${seconds} seconds`, context);
    this.name = "AgentTimeoutError";
    this.timeoutSeconds = seconds;
  }
}

/**
 * Thrown when an agent fails during execution.
 */
export class AgentExecutionError extends SwarmError {
  constructor(
    message: string,
    context?: { swarmId?: number; agentId?: number; agentName?: string; cause?: Error },
  ) {
    super(message, context);
    this.name = "AgentExecutionError";
  }
}

/**
 * Thrown when a dependency condition is not met.
 */
export class DependencyError extends SwarmError {
  readonly dependencyAgentName?: string;

  constructor(
    message: string,
    context?: {
      swarmId?: number;
      agentId?: number;
      agentName?: string;
      dependencyAgentName?: string;
    },
  ) {
    super(message, context);
    this.name = "DependencyError";
    if (context?.dependencyAgentName !== undefined) this.dependencyAgentName = context.dependencyAgentName;
  }
}

/**
 * Thrown when database operations fail during swarm execution.
 */
export class SwarmDatabaseError extends SwarmError {
  readonly operation?: string;

  constructor(
    message: string,
    context?: {
      swarmId?: number;
      agentId?: number;
      agentName?: string;
      operation?: string;
      cause?: Error;
    },
  ) {
    super(message, context);
    this.name = "SwarmDatabaseError";
    if (context?.operation !== undefined) this.operation = context.operation;
  }
}

/**
 * Thrown when a swarm or agent is not found.
 */
export class SwarmNotFoundError extends SwarmError {
  constructor(swarmId: number, agentId?: number) {
    super(
      agentId ? `Agent ${agentId} not found in swarm ${swarmId}` : `Swarm ${swarmId} not found`,
      agentId !== undefined ? { swarmId, agentId } : { swarmId },
    );
    this.name = "SwarmNotFoundError";
  }
}
