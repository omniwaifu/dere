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
    status === STATUS.SKIPPED
  );
}

export class AgentTimeoutError extends Error {
  constructor(seconds: number) {
    super(`Agent execution timed out after ${seconds} seconds`);
    this.name = "AgentTimeoutError";
  }
}
