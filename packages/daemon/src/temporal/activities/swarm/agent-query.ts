/**
 * Agent query activity with heartbeat support.
 *
 * This activity runs the Claude SDK query and emits heartbeats to Temporal.
 * Long-running (30+ min possible) so heartbeats are critical for:
 * - Telling Temporal we're still alive
 * - Enabling graceful cancellation
 *
 * ## Cancellation Limitations (KNOWN ISSUE)
 *
 * The Claude Agent SDK does NOT support AbortSignal or any abort mechanism.
 * Once `query()` starts, it runs to completion. This means:
 *
 * - **Non-sandbox mode**: Query runs until done. On Temporal cancel, we detect
 *   it via `cancellationSignal.aborted` but the SDK subprocess keeps running.
 *   The orphan process completes naturally, wasting compute but not breaking
 *   anything.
 *
 * - **Sandbox mode**: Docker container CAN be killed via `docker stop`, but
 *   the current `runDockerSandboxQuery` doesn't expose a handle. Would need
 *   refactoring to support abort.
 *
 * Workaround: Heartbeats still work, so Temporal knows we're alive. On cancel,
 * we throw CancelledFailure immediately (before starting query) or after query
 * completes (if cancelled mid-execution). The workflow marks the agent as
 * cancelled even though the subprocess may still be running.
 *
 * TODO: To properly support cancellation:
 * 1. For sandbox: Refactor DockerSandboxRunner to accept AbortSignal and
 *    call runner.close() on abort
 * 2. For SDK: Open issue with Anthropic for AbortSignal support in query()
 */

import { Context, CancelledFailure, ApplicationFailure } from "@temporalio/activity";

import { runAgentQuery as sdkRunAgentQuery, generateSummary } from "../../../swarm/agent-query.js";
import { log } from "../../../logger.js";
import type {
  RunAgentQueryInput,
  RunAgentQueryResult,
  AgentQueryHeartbeat,
  SwarmSpec,
  AgentSpec,
} from "./types.js";
import { MAX_OUTPUT_SIZE, SUMMARY_THRESHOLD } from "./types.js";
import type { SwarmRow, SwarmAgentRow } from "../../../swarm/types.js";

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 seconds

/**
 * Convert temporal types to existing swarm types.
 * This adapter layer allows us to reuse existing agent-query.ts code.
 */
function toSwarmRow(spec: SwarmSpec): SwarmRow {
  return {
    id: spec.swarmId,
    name: spec.name,
    description: spec.description,
    parent_session_id: null,
    working_dir: spec.workingDir,
    git_branch_prefix: spec.gitBranchPrefix,
    base_branch: spec.baseBranch,
    status: "running",
    auto_synthesize: spec.autoSynthesize,
    synthesis_prompt: spec.synthesisPrompt,
    skip_synthesis_on_failure: spec.skipSynthesisOnFailure,
    synthesis_output: null,
    synthesis_summary: null,
    auto_supervise: false,
    supervisor_warn_seconds: 600,
    supervisor_cancel_seconds: 1800,
    created_at: null,
    started_at: null,
    completed_at: null,
  };
}

function toSwarmAgentRow(spec: AgentSpec, swarmId: number): SwarmAgentRow {
  return {
    id: spec.agentId,
    swarm_id: swarmId,
    name: spec.name,
    role: spec.role,
    is_synthesis_agent: spec.isSynthesisAgent,
    mode: spec.mode,
    prompt: spec.prompt,
    goal: spec.goal,
    capabilities: spec.capabilities,
    task_types: spec.taskTypes,
    max_tasks: spec.maxTasks,
    max_duration_seconds: spec.maxDurationSeconds,
    idle_timeout_seconds: spec.idleTimeoutSeconds,
    tasks_completed: 0,
    tasks_failed: 0,
    current_task_id: null,
    personality: spec.personality,
    plugins: spec.plugins,
    git_branch: null,
    allowed_tools: spec.allowedTools,
    thinking_budget: spec.thinkingBudget,
    model: spec.model,
    sandbox_mode: spec.sandboxMode,
    depends_on: null,
    session_id: null,
    status: "running",
    output_text: null,
    output_summary: null,
    error_message: null,
    tool_count: 0,
    created_at: null,
    started_at: null,
    completed_at: null,
  };
}

/**
 * Truncate output to max size.
 */
function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_SIZE) {
    return text;
  }
  const half = Math.floor(MAX_OUTPUT_SIZE / 2);
  return `${text.slice(0, half)}\n\n[... truncated ${text.length - MAX_OUTPUT_SIZE} chars ...]\n\n${text.slice(-half)}`;
}

/**
 * Run agent query with heartbeat.
 *
 * This is the core activity for agent execution. It:
 * 1. Starts the SDK query
 * 2. Emits heartbeats every 10s while running
 * 3. Handles cancellation by checking cancellation signal
 * 4. Returns the query result
 */
export async function runAgentQueryWithHeartbeat(
  input: RunAgentQueryInput,
): Promise<RunAgentQueryResult> {
  const { swarm, agent, prompt, sessionId } = input;
  const ctx = Context.current();
  const startTime = Date.now();
  let toolCount = 0;

  // Check for cancellation before starting
  ctx.heartbeat({ status: "running", elapsedSeconds: 0 } satisfies AgentQueryHeartbeat);

  // Start heartbeat interval
  const heartbeatInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const heartbeat: AgentQueryHeartbeat = {
      status: "running",
      elapsedSeconds: elapsed,
      toolCount,
    };

    try {
      ctx.heartbeat(heartbeat);
    } catch (error) {
      // Heartbeat can fail if activity is being cancelled
      log.swarm.debug("Heartbeat failed (likely cancellation)", {
        agentName: agent.name,
        error: String(error),
      });
    }

    // Check cancellation signal
    if (ctx.cancellationSignal.aborted) {
      log.swarm.info("Agent query cancellation detected", { agentName: agent.name });
      clearInterval(heartbeatInterval);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // Check cancellation before starting query
    if (ctx.cancellationSignal.aborted) {
      throw new CancelledFailure("Agent cancelled before query started");
    }

    // Convert to existing types and run query
    const swarmRow = toSwarmRow(swarm);
    const agentRow = toSwarmAgentRow(agent, swarm.swarmId);

    const result = await sdkRunAgentQuery({
      swarm: swarmRow,
      agent: agentRow,
      prompt,
      sessionId,
    });

    toolCount = result.toolCount;

    // Truncate and return
    const outputText = truncateOutput(result.outputText ?? "");

    return {
      outputText,
      toolCount: result.toolCount,
      toolNames: result.toolNames,
      structuredOutput: result.structuredOutput,
    };
  } catch (error) {
    // Re-throw cancellation as-is
    if (error instanceof CancelledFailure) {
      throw error;
    }

    // Check if we were cancelled during execution
    if (ctx.cancellationSignal.aborted) {
      throw new CancelledFailure("Agent cancelled during query execution");
    }

    // Wrap other errors as ApplicationFailure
    const message = error instanceof Error ? error.message : String(error);
    log.swarm.error("Agent query failed in activity", {
      agentName: agent.name,
      swarmId: swarm.swarmId,
      error: message,
    });

    throw new ApplicationFailure(message, "AgentQueryError", false);
  } finally {
    clearInterval(heartbeatInterval);

    // Final heartbeat
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    try {
      ctx.heartbeat({ status: "finalizing", elapsedSeconds: elapsed } satisfies AgentQueryHeartbeat);
    } catch {
      // Ignore heartbeat errors in finally
    }
  }
}

/**
 * Generate summary for long output.
 * Separate activity so it can be retried independently.
 */
export async function generateOutputSummary(outputText: string): Promise<string | null> {
  if (outputText.length < SUMMARY_THRESHOLD) {
    return null;
  }

  return generateSummary(outputText);
}
