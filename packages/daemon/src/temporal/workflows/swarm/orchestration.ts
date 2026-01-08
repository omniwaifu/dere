/**
 * Swarm orchestration workflow.
 *
 * This workflow replaces the bespoke Promise-based orchestration in swarm/orchestration.ts.
 * It maintains the same DAG execution semantics but enables:
 * - Dynamic agent spawning (synthesis can trigger more work)
 * - Temporal-native retry, timeout, and cancellation
 * - Visibility into execution via Temporal UI
 *
 * Key design decisions:
 * - Agents are CHILD WORKFLOWS (not activities) for 30+ min execution
 * - Scratchpad is JSON-serializable workflow state
 * - Parallelism via Promise.all for independent agents
 * - Sequential execution for dependency chains
 */

import {
  proxyActivities,
  executeChild,
  log,
  continueAsNew,
  CancellationScope,
  Trigger,
  condition,
  sleep,
} from "@temporalio/workflow";

import type * as swarmActivities from "../../activities/swarm/index.js";
import type {
  SwarmSpec,
  AgentSpec,
  AgentWithDependencies,
  AgentResult,
  SwarmResult,
  SwarmContext,
} from "../../activities/swarm/types.js";
import { SUMMARY_THRESHOLD } from "../../activities/swarm/types.js";

import { agentWorkflow, shouldSkipAgent } from "./agent.js";

// Proxy activities for quick DB operations
const {
  updateSwarmStatus,
  markAgentSkipped,
  getSwarmAgents,
  getAgentOutput,
  generateOutputSummary,
  runValidation,
} = proxyActivities<typeof swarmActivities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "1s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

// ============================================================================
// Types
// ============================================================================

export interface SwarmWorkflowInput {
  swarm: SwarmSpec;
  agents: AgentWithDependencies[];
  initialScratchpad?: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build dependency context for an agent from completed agent outputs.
 */
function buildDependencyContext(
  agent: AgentWithDependencies,
  results: Map<string, AgentResult>,
): string {
  if (!agent.dependsOn || agent.dependsOn.length === 0) {
    return "";
  }

  const sections: string[] = [];

  for (const dep of agent.dependsOn) {
    const result = results.get(dep.agentName);
    if (!result) {
      continue;
    }

    if (dep.include === "none") {
      continue;
    }

    let output: string;
    if (dep.include === "summary" && result.outputSummary) {
      output = result.outputSummary;
    } else {
      output = result.outputText;
      // Truncate if using full but very long
      if (output.length > 4000) {
        output = result.outputSummary ?? output.slice(0, 4000) + "\n[truncated]";
      }
    }

    if (!output) {
      continue;
    }

    sections.push(`## Dependency: ${dep.agentName} (${dep.include})\n\n${output}`);
  }

  return sections.join("\n\n");
}

/**
 * Build agent name to ID mapping for dependency resolution.
 */
function buildAgentNameMap(agents: AgentWithDependencies[]): Map<string, AgentWithDependencies> {
  const map = new Map<string, AgentWithDependencies>();
  for (const agent of agents) {
    map.set(agent.name, agent);
  }
  return map;
}

/**
 * Find agents whose dependencies are all satisfied.
 */
function findReadyAgents(
  agents: AgentWithDependencies[],
  completed: Set<string>,
  running: Set<string>,
  skipped: Set<string>,
): AgentWithDependencies[] {
  return agents.filter((agent) => {
    // Skip if already processed
    if (completed.has(agent.name) || running.has(agent.name) || skipped.has(agent.name)) {
      return false;
    }

    // Check all dependencies are satisfied
    for (const dep of agent.dependsOn) {
      if (!completed.has(dep.agentName) && !skipped.has(dep.agentName)) {
        return false;
      }
    }

    return true;
  });
}

// ============================================================================
// Main Workflow
// ============================================================================

/**
 * Execute a swarm of agents with dependency-based orchestration.
 *
 * The workflow:
 * 1. Mark swarm as running
 * 2. Build dependency graph
 * 3. Execute agents in waves (parallel where possible)
 * 4. Collect results and update scratchpad
 * 5. Mark swarm complete/failed
 */
export async function swarmWorkflow(input: SwarmWorkflowInput): Promise<SwarmResult> {
  const { swarm, agents } = input;
  const startTime = Date.now();

  log.info("Swarm workflow starting", {
    swarmId: swarm.swarmId,
    name: swarm.name,
    agentCount: agents.length,
  });

  // Initialize state
  const context: SwarmContext = {
    swarm,
    scratchpad: input.initialScratchpad ?? {},
    agentResults: {},
  };

  const results = new Map<string, AgentResult>();
  const completed = new Set<string>();
  const running = new Set<string>();
  const skipped = new Set<string>();

  // Mark swarm as running
  await updateSwarmStatus({ swarmId: swarm.swarmId, status: "running" });

  try {
    // Process agents in waves based on dependencies
    while (completed.size + skipped.size < agents.length) {
      // Find agents ready to run
      const ready = findReadyAgents(agents, completed, running, skipped);

      if (ready.length === 0 && running.size === 0) {
        // Deadlock: no ready agents and none running
        log.error("Swarm deadlock detected", {
          swarmId: swarm.swarmId,
          completed: Array.from(completed),
          skipped: Array.from(skipped),
          remaining: agents
            .filter((a) => !completed.has(a.name) && !skipped.has(a.name))
            .map((a) => a.name),
        });
        throw new Error("Swarm deadlock: no ready agents but work remaining");
      }

      if (ready.length === 0) {
        // Wait for running agents to complete
        await sleep(1000);
        continue;
      }

      log.info("Starting agent wave", {
        swarmId: swarm.swarmId,
        agents: ready.map((a) => a.name),
      });

      // Check for skip conditions before starting
      const toRun: AgentWithDependencies[] = [];
      for (const agent of ready) {
        // Check if synthesis agent should be skipped due to failures
        if (agent.isSynthesisAgent && swarm.skipSynthesisOnFailure) {
          const hasFailures = Array.from(results.values()).some(
            (r) =>
              !agents.find((a) => a.name === r.name)?.isSynthesisAgent &&
              (r.status === "failed" || r.status === "timed_out"),
          );
          if (hasFailures) {
            await markAgentSkipped({
              agentId: agent.agentId,
              swarmId: swarm.swarmId,
              reason: "Skipped due to agent failures",
            });
            skipped.add(agent.name);
            results.set(agent.name, {
              name: agent.name,
              status: "skipped",
              outputText: "",
              outputSummary: null,
              toolCount: 0,
              toolNames: [],
              errorMessage: "Skipped due to agent failures",
              durationSeconds: 0,
              sessionId: null,
            });
            continue;
          }
        }

        // Check dependency skip conditions
        const dependencyResults = new Map<string, AgentResult>();
        for (const dep of agent.dependsOn) {
          const depResult = results.get(dep.agentName);
          if (depResult) {
            dependencyResults.set(dep.agentName, depResult);
          }
        }

        const { skip, reason } = shouldSkipAgent(agent, dependencyResults);
        if (skip) {
          await markAgentSkipped({
            agentId: agent.agentId,
            swarmId: swarm.swarmId,
            reason: reason ?? "Dependency failure",
          });
          skipped.add(agent.name);
          results.set(agent.name, {
            name: agent.name,
            status: "skipped",
            outputText: "",
            outputSummary: null,
            toolCount: 0,
            toolNames: [],
            errorMessage: reason,
            durationSeconds: 0,
            sessionId: null,
          });
          continue;
        }

        toRun.push(agent);
      }

      if (toRun.length === 0) {
        continue;
      }

      // Mark agents as running
      for (const agent of toRun) {
        running.add(agent.name);
      }

      // Execute ready agents IN PARALLEL as child workflows
      const childPromises = toRun.map(async (agent) => {
        // Build prompt with dependency context
        const dependencyContext = buildDependencyContext(agent, results);
        const prompt = dependencyContext
          ? `${dependencyContext}\n\n${agent.prompt}`
          : agent.prompt;

        // Execute as child workflow
        const result = await executeChild(agentWorkflow, {
          workflowId: `swarm-${swarm.swarmId}-agent-${agent.name}`,
          args: [{ agent, context, prompt }],
        });

        return { agent, result };
      });

      // Wait for all parallel agents to complete
      const batchResults = await Promise.all(childPromises);

      // Process results
      for (const { agent, result } of batchResults) {
        running.delete(agent.name);
        completed.add(agent.name);
        results.set(agent.name, result);

        // Update scratchpad with agent output
        context.scratchpad[`${agent.name}:output`] = result.outputText;
        context.scratchpad[`${agent.name}:status`] = result.status;
        context.agentResults[agent.name] = result;

        log.info("Agent completed", {
          swarmId: swarm.swarmId,
          agentName: agent.name,
          status: result.status,
          durationSeconds: result.durationSeconds,
        });
      }
    }

    // ========================================================================
    // DYNAMIC EXTENSION POINT
    // ========================================================================
    // This is where synthesis can spawn new agents dynamically.
    // For now, just check if synthesis requested follow-up work.
    //
    // Future: Parse synthesis structured output and spawn fixer agents:
    // if (synthesisResult?.structuredOutput?.needsFix) {
    //   const fixerAgent = createFixerAgent(synthesisResult.structuredOutput);
    //   const fixerResult = await executeChild(agentWorkflow, { ... });
    //   results.set("fixer", fixerResult);
    // }
    // ========================================================================

    // Determine final status
    const hasFailures = Array.from(results.values()).some(
      (r) => r.status === "failed" || r.status === "timed_out",
    );
    const finalStatus = hasFailures ? "failed" : "completed";

    await updateSwarmStatus({ swarmId: swarm.swarmId, status: finalStatus });

    const durationSeconds = (Date.now() - startTime) / 1000;
    log.info("Swarm workflow completed", {
      swarmId: swarm.swarmId,
      status: finalStatus,
      durationSeconds,
      completedAgents: completed.size,
      skippedAgents: skipped.size,
    });

    // Find synthesis output
    let synthesisOutput: string | null = null;
    for (const agent of agents) {
      if (agent.isSynthesisAgent) {
        const result = results.get(agent.name);
        if (result?.outputText) {
          synthesisOutput = result.outputText;
        }
        break;
      }
    }

    return {
      swarmId: swarm.swarmId,
      status: finalStatus,
      agentResults: Object.fromEntries(results),
      synthesisOutput,
      scratchpad: context.scratchpad,
      durationSeconds,
    };
  } catch (error) {
    const durationSeconds = (Date.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error("Swarm workflow failed", {
      swarmId: swarm.swarmId,
      error: errorMessage,
      durationSeconds,
    });

    await updateSwarmStatus({ swarmId: swarm.swarmId, status: "failed" });

    return {
      swarmId: swarm.swarmId,
      status: "failed",
      agentResults: Object.fromEntries(results),
      synthesisOutput: null,
      scratchpad: context.scratchpad,
      durationSeconds,
    };
  }
}

// ============================================================================
// Validation Loop Pattern (Phase 3)
// ============================================================================

/**
 * Swarm with validation loop.
 *
 * Pattern: run swarm → validate → if failed, spawn fixer → retry
 *
 * Use cases:
 * - Run tests after code changes, fix failures automatically
 * - Run linter after refactor, fix issues automatically
 * - Build validation with automatic error resolution
 */
export interface ValidatedSwarmWorkflowInput extends SwarmWorkflowInput {
  /** Command to run for validation (e.g., "npm test", "bun run typecheck") */
  validationCommand: string;
  /** Maximum fix attempts before giving up */
  maxAttempts: number;
  /** Optional fixer agent configuration override */
  fixerAgentConfig?: Partial<AgentSpec>;
}

export async function validatedSwarmWorkflow(
  input: ValidatedSwarmWorkflowInput,
): Promise<SwarmResult & { validationAttempts: number; validationPassed: boolean }> {
  const { swarm, agents, validationCommand, maxAttempts, fixerAgentConfig } = input;

  log.info("Starting validated swarm workflow", {
    swarmId: swarm.swarmId,
    validationCommand,
    maxAttempts,
  });

  let lastResult: SwarmResult | null = null;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    log.info("Validation attempt", { swarmId: swarm.swarmId, attempt, maxAttempts });

    // Run the main swarm
    lastResult = await executeChild(swarmWorkflow, {
      workflowId: `swarm-${swarm.swarmId}-attempt-${attempt}`,
      args: [{ swarm, agents, initialScratchpad: input.initialScratchpad ?? {} }],
    });

    // If swarm failed, don't bother validating
    if (lastResult.status === "failed") {
      log.warn("Swarm failed, skipping validation", { swarmId: swarm.swarmId, attempt });
      break;
    }

    // Run validation
    log.info("Running validation", { swarmId: swarm.swarmId, command: validationCommand });
    const validation = await runValidation({
      workingDir: swarm.workingDir,
      command: validationCommand,
    });

    if (validation.passed) {
      log.info("Validation passed", {
        swarmId: swarm.swarmId,
        attempt,
        durationSeconds: validation.durationSeconds,
      });
      // lastResult is guaranteed non-null here (assigned above)
      return {
        ...lastResult!,
        validationAttempts: attempt,
        validationPassed: true,
      };
    }

    log.warn("Validation failed", {
      swarmId: swarm.swarmId,
      attempt,
      exitCode: validation.exitCode,
      errorCount: validation.errors.length,
    });

    // Don't spawn fixer on last attempt
    if (attempt >= maxAttempts) {
      break;
    }

    // Spawn fixer agent
    const fixerPrompt = buildFixerPrompt(
      validationCommand,
      validation.errors,
      validation.stdout,
      validation.stderr,
    );
    const fixerAgent: AgentWithDependencies = {
      agentId: -attempt, // Negative ID indicates dynamically spawned
      name: `fixer-${attempt}`,
      role: "fixer",
      mode: "assigned",
      prompt: fixerPrompt,
      model: fixerAgentConfig?.model ?? "claude-sonnet-4-20250514",
      personality: fixerAgentConfig?.personality ?? null,
      plugins: fixerAgentConfig?.plugins ?? null,
      allowedTools: fixerAgentConfig?.allowedTools ?? ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      thinkingBudget: fixerAgentConfig?.thinkingBudget ?? null,
      sandboxMode: fixerAgentConfig?.sandboxMode ?? false,
      isSynthesisAgent: false,
      // Autonomous mode settings (not used for fixer)
      goal: null,
      capabilities: null,
      taskTypes: null,
      maxTasks: null,
      maxDurationSeconds: null,
      idleTimeoutSeconds: fixerAgentConfig?.idleTimeoutSeconds ?? 600,
      dependsOn: [],
    };

    log.info("Spawning fixer agent", { swarmId: swarm.swarmId, attempt, fixerName: fixerAgent.name });

    // lastResult is guaranteed non-null here (assigned at start of loop)
    const context: SwarmContext = {
      swarm,
      scratchpad: lastResult!.scratchpad,
      agentResults: lastResult!.agentResults,
    };

    await executeChild(agentWorkflow, {
      workflowId: `swarm-${swarm.swarmId}-fixer-${attempt}`,
      args: [{ agent: fixerAgent, context, prompt: fixerPrompt }],
    });
  }

  log.warn("Validation loop exhausted", {
    swarmId: swarm.swarmId,
    attempts: attempt,
    maxAttempts,
  });

  return {
    ...(lastResult ?? {
      swarmId: swarm.swarmId,
      status: "failed",
      agentResults: {},
      synthesisOutput: null,
      scratchpad: {},
      durationSeconds: 0,
    }),
    validationAttempts: attempt,
    validationPassed: false,
  };
}

/**
 * Build a prompt for the fixer agent based on validation errors.
 */
function buildFixerPrompt(
  command: string,
  errors: string[],
  stdout: string,
  stderr: string,
): string {
  const errorSection =
    errors.length > 0
      ? `## Specific Errors\n\n${errors.map((e) => `- ${e}`).join("\n")}`
      : "";

  // Combine stdout/stderr - TypeScript errors go to stdout, most others to stderr
  const combinedOutput = (stdout + "\n" + stderr).trim();
  const outputSection = combinedOutput
    ? `## Full Output\n\n\`\`\`\n${combinedOutput.slice(0, 4000)}\n\`\`\``
    : "";

  return `# Fix Validation Errors

The validation command \`${command}\` failed. Please fix the errors.

${errorSection}

${outputSection}

## Instructions

1. Read the error messages carefully
2. Identify the root cause of each error
3. Make the minimal changes needed to fix the errors
4. Do NOT introduce new features or refactor unrelated code
5. After fixing, the validation command should pass

Focus on fixing the errors, nothing else.`;
}
