/**
 * Agent child workflow.
 *
 * Each agent runs as a child workflow (not activity) because:
 * 1. Agents can run 30+ minutes
 * 2. Child workflows have their own history and can be inspected in Temporal UI
 * 3. Cancellation propagates cleanly to child workflows
 *
 * The workflow:
 * 1. Creates a database session
 * 2. Runs the agent query (activity with heartbeat)
 * 3. Generates summary if output is long
 * 4. Updates database with results
 * 5. Cleans up session in finally block
 */

import { proxyActivities, log, ApplicationFailure, CancellationScope } from "@temporalio/workflow";

import type * as swarmActivities from "../../activities/swarm/index.js";
import type {
  AgentSpec,
  AgentWithDependencies,
  SwarmSpec,
  AgentResult,
  SwarmContext,
} from "../../activities/swarm/types.js";
import { SUMMARY_THRESHOLD } from "../../activities/swarm/types.js";
import { evaluateCondition } from "../../../swarm/dependencies.js";

// Proxy activities with appropriate timeouts
const {
  createAgentSession,
  closeAgentSession,
  runAgentQueryWithHeartbeat,
  generateOutputSummary,
  markAgentRunning,
  markAgentCompleted,
  markAgentFailed,
  markAgentSkipped,
  recordConversation,
  updateSynthesisOutput,
} = proxyActivities<typeof swarmActivities>({
  // Short timeout for quick DB operations
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

// Agent query has very long timeout and heartbeat requirement
const agentQuery = proxyActivities<Pick<typeof swarmActivities, "runAgentQueryWithHeartbeat">>({
  startToCloseTimeout: "4 hours", // Max agent runtime
  heartbeatTimeout: "30 seconds", // Must heartbeat every 30s
  retry: {
    initialInterval: "5s",
    backoffCoefficient: 2,
    maximumAttempts: 2, // Limited retries for expensive LLM calls
  },
});

export interface AgentWorkflowInput {
  agent: AgentSpec;
  context: SwarmContext;
  prompt: string; // Final prompt with dependency context already built
}

/**
 * Execute a single agent.
 *
 * This workflow handles the full lifecycle:
 * - Session creation/cleanup
 * - Query execution with heartbeat
 * - Status updates
 * - Summary generation
 */
export async function agentWorkflow(input: AgentWorkflowInput): Promise<AgentResult> {
  const { agent, context, prompt } = input;
  const { swarm } = context;
  const startTime = Date.now();

  log.info("Agent workflow starting", {
    agentName: agent.name,
    swarmId: swarm.swarmId,
    promptLength: prompt.length,
  });

  let sessionId: number | null = null;

  try {
    // Step 1: Create session
    sessionId = await createAgentSession({ swarm, agent });
    log.info("Session created", { agentName: agent.name, sessionId });

    // Step 2: Mark agent as running
    await markAgentRunning({
      agentId: agent.agentId,
      swarmId: swarm.swarmId,
      sessionId,
    });

    // Step 3: Record user prompt
    await recordConversation({
      sessionId,
      messageType: "user",
      prompt,
      personality: agent.personality,
    });

    // Step 4: Run the agent query with heartbeat
    const queryResult = await agentQuery.runAgentQueryWithHeartbeat({
      swarm,
      agent,
      prompt,
      sessionId,
    });

    log.info("Agent query completed", {
      agentName: agent.name,
      outputLength: queryResult.outputText.length,
      toolCount: queryResult.toolCount,
    });

    // Step 5: Generate summary if needed
    let outputSummary: string | null = null;
    if (queryResult.outputText.length > SUMMARY_THRESHOLD) {
      outputSummary = await generateOutputSummary(queryResult.outputText);
    }

    // Step 6: Mark agent completed
    await markAgentCompleted({
      agentId: agent.agentId,
      swarmId: swarm.swarmId,
      outputText: queryResult.outputText,
      outputSummary,
      toolCount: queryResult.toolCount,
      startedAt: startTime,
    });

    // Step 7: Update synthesis output if this is synthesis agent
    if (agent.isSynthesisAgent) {
      await updateSynthesisOutput({
        swarmId: swarm.swarmId,
        outputText: queryResult.outputText,
        outputSummary,
      });
    }

    const durationSeconds = (Date.now() - startTime) / 1000;
    log.info("Agent workflow completed", {
      agentName: agent.name,
      durationSeconds,
    });

    return {
      name: agent.name,
      status: "completed",
      outputText: queryResult.outputText,
      outputSummary,
      toolCount: queryResult.toolCount,
      toolNames: queryResult.toolNames,
      errorMessage: null,
      durationSeconds,
      sessionId,
      structuredOutput: queryResult.structuredOutput,
    };
  } catch (error) {
    const durationSeconds = (Date.now() - startTime) / 1000;
    const isCancelled = error instanceof Error && error.name === "CancelledFailure";
    const isTimeout = error instanceof Error && error.message?.includes("timed out");

    let status: AgentResult["status"];
    if (isCancelled) {
      status = "cancelled";
    } else if (isTimeout) {
      status = "timed_out";
    } else {
      status = "failed";
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Agent workflow failed", {
      agentName: agent.name,
      status,
      error: errorMessage,
      durationSeconds,
    });

    // Mark agent as failed in DB
    try {
      await markAgentFailed({
        agentId: agent.agentId,
        swarmId: swarm.swarmId,
        errorMessage,
        status,
        startedAt: startTime,
      });
    } catch (dbError) {
      log.error("Failed to mark agent as failed in DB", {
        agentName: agent.name,
        dbError: String(dbError),
      });
    }

    return {
      name: agent.name,
      status,
      outputText: "",
      outputSummary: null,
      toolCount: 0,
      toolNames: [],
      errorMessage,
      durationSeconds,
      sessionId,
    };
  } finally {
    // Always close session, even on failure
    // Use CancellationScope.nonCancellable to ensure cleanup runs
    if (sessionId !== null) {
      await CancellationScope.nonCancellable(async () => {
        try {
          await closeAgentSession({ sessionId: sessionId! });
          log.info("Session closed", { agentName: agent.name, sessionId });
        } catch (closeError) {
          log.warn("Failed to close session", {
            agentName: agent.name,
            sessionId,
            error: String(closeError),
          });
        }
      });
    }
  }
}

/**
 * Check if agent should be skipped based on dependency failures and conditions.
 *
 * For each dependency:
 * - If it has no condition: skip if dependency failed/timed out
 * - If it has a condition: evaluate condition against dependency output
 *   - Condition must evaluate to true for agent to run
 *   - This allows patterns like: run only if dependency succeeded with specific output
 */
export function shouldSkipAgent(
  agent: AgentWithDependencies,
  dependencyResults: Map<string, AgentResult>,
): { skip: boolean; reason: string | null } {
  // Build a lookup for dependency specs to access conditions
  const depSpecs = new Map(agent.dependsOn.map((d) => [d.agentName, d]));

  for (const [depName, result] of dependencyResults) {
    const depSpec = depSpecs.get(depName);
    const condition = depSpec?.condition;

    if (condition) {
      // Evaluate condition against dependency output
      const evalResult = evaluateCondition(condition, result.outputText);

      if (evalResult.error) {
        log.warn("Condition evaluation error", {
          agent: agent.name,
          dependency: depName,
          condition,
          error: evalResult.error,
        });
        // Treat evaluation errors as condition failure
        return {
          skip: true,
          reason: `Condition on '${depName}' failed: ${evalResult.error}`,
        };
      }

      if (!evalResult.result) {
        return {
          skip: true,
          reason: `Condition '${condition}' on dependency '${depName}' evaluated to false`,
        };
      }
      // Condition passed - don't skip based on this dependency
    } else {
      // No condition - use default behavior (skip if failed/timed out)
      if (result.status === "failed" || result.status === "timed_out") {
        return {
          skip: true,
          reason: `Dependency '${depName}' ${result.status}`,
        };
      }
    }
  }

  return { skip: false, reason: null };
}
