/**
 * Bridge between swarm routes and Temporal workflows.
 *
 * This module provides the integration point for starting swarms via Temporal.
 * It converts DB rows to Temporal workflow input types and starts the workflow.
 */

import { getTemporalClient, TASK_QUEUES } from "../temporal/client.js";
import type {
  SwarmSpec,
  AgentSpec,
  AgentWithDependencies,
  DependencySpec,
} from "../temporal/activities/swarm/types.js";
import type { SwarmWorkflowInput } from "../temporal/workflows/swarm/orchestration.js";
import type { SwarmRow, SwarmAgentRow } from "./types.js";
import { log } from "../logger.js";

/**
 * Convert a DB swarm row to Temporal SwarmSpec.
 */
function toSwarmSpec(swarm: SwarmRow): SwarmSpec {
  return {
    swarmId: swarm.id,
    name: swarm.name,
    workingDir: swarm.working_dir,
    description: swarm.description,
    gitBranchPrefix: swarm.git_branch_prefix,
    baseBranch: swarm.base_branch,
    autoSynthesize: swarm.auto_synthesize,
    synthesisPrompt: swarm.synthesis_prompt,
    skipSynthesisOnFailure: swarm.skip_synthesis_on_failure,
  };
}

/**
 * Convert a DB agent row to Temporal AgentSpec.
 */
function toAgentSpec(agent: SwarmAgentRow): AgentSpec {
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    mode: agent.mode as "assigned" | "autonomous",
    prompt: agent.prompt,
    isSynthesisAgent: agent.is_synthesis_agent,
    personality: agent.personality,
    plugins: agent.plugins,
    allowedTools: agent.allowed_tools,
    thinkingBudget: agent.thinking_budget,
    model: agent.model,
    sandboxMode: agent.sandbox_mode,
    goal: agent.goal,
    capabilities: agent.capabilities,
    taskTypes: agent.task_types,
    maxTasks: agent.max_tasks,
    maxDurationSeconds: agent.max_duration_seconds,
    idleTimeoutSeconds: agent.idle_timeout_seconds,
  };
}

/**
 * Convert DB agent rows to Temporal AgentWithDependencies array.
 * Resolves agent_id references to agent names for the workflow.
 */
function toAgentsWithDependencies(agents: SwarmAgentRow[]): AgentWithDependencies[] {
  // Build ID to name mapping
  const idToName = new Map<number, string>();
  for (const agent of agents) {
    idToName.set(agent.id, agent.name);
  }

  return agents.map((agent) => {
    const spec = toAgentSpec(agent);
    const dependsOn: DependencySpec[] = [];

    if (agent.depends_on && Array.isArray(agent.depends_on)) {
      for (const dep of agent.depends_on) {
        const depName = idToName.get(dep.agent_id);
        if (depName) {
          dependsOn.push({
            agentName: depName,
            include: (dep.include ?? "summary") as "summary" | "full" | "none",
            condition: dep.condition ?? null,
          });
        }
      }
    }

    return {
      ...spec,
      dependsOn,
    };
  });
}

export interface StartSwarmResult {
  workflowId: string;
  runId: string;
}

/**
 * Start a swarm execution via Temporal workflow.
 *
 * This replaces the old `startSwarmExecution` function.
 * The workflow handles all orchestration, agent execution, and status updates.
 */
export async function startSwarmViaTemporal(
  swarm: SwarmRow,
  agents: SwarmAgentRow[],
): Promise<StartSwarmResult> {
  const client = await getTemporalClient();

  const swarmSpec = toSwarmSpec(swarm);
  const agentSpecs = toAgentsWithDependencies(agents);

  const input: SwarmWorkflowInput = {
    swarm: swarmSpec,
    agents: agentSpecs,
  };

  const workflowId = `swarm-${swarm.id}-${Date.now()}`;

  log.swarm.info("Starting swarm via Temporal", {
    swarmId: swarm.id,
    name: swarm.name,
    workflowId,
    agentCount: agents.length,
  });

  const handle = await client.workflow.start("swarmWorkflow", {
    taskQueue: TASK_QUEUES.SWARM,
    workflowId,
    args: [input],
  });

  log.swarm.info("Swarm workflow started", {
    swarmId: swarm.id,
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  });

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Cancel a running swarm workflow.
 */
export async function cancelSwarmWorkflow(workflowId: string): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.cancel();
}

/**
 * Get the status of a swarm workflow.
 */
export async function getSwarmWorkflowStatus(workflowId: string): Promise<{
  status: string;
  result?: unknown;
}> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  const description = await handle.describe();

  return {
    status: description.status.name,
    result: description.status.name === "COMPLETED" ? await handle.result() : undefined,
  };
}
