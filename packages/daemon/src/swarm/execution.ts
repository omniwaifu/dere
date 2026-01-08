// Swarm agent execution logic

import { sql } from "kysely";

import { getDb } from "../db.js";
import { closeSession } from "../db-utils.js";
import { daemonEvents } from "../events.js";
import { bufferInteractionStimulus } from "../emotions/runtime.js";
import { log } from "../logger.js";
import { swarmState, type CompletionSignal } from "./state.js";
import {
  STATUS,
  SUMMARY_THRESHOLD,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  MEMORY_STEWARD_NAME,
  AgentTimeoutError,
  AgentExecutionError,
  SwarmError,
  type SwarmRow,
  type SwarmAgentRow,
} from "./types.js";
import { nowDate, nowSeconds, truncateOutput, withTimeout, type TimeoutOptions } from "./utils.js";
import { buildTaskPrompt, buildMemoryPromptPrefix } from "./prompts.js";
import { evaluateCondition } from "./dependencies.js";
import { runAgentQuery, generateSummary, type MessageBlock } from "./agent-query.js";

export function getCompletionSignal(swarmId: number, agentId: number): CompletionSignal {
  return swarmState.getCompletionSignal(swarmId, agentId);
}

export async function getSwarmWithAgents(
  swarmId: number,
): Promise<{ swarm: SwarmRow; agents: SwarmAgentRow[] } | null> {
  const db = await getDb();
  const swarm = await db
    .selectFrom("swarms")
    .selectAll()
    .where("id", "=", swarmId)
    .executeTakeFirst();
  if (!swarm) {
    return null;
  }
  const agents = await db
    .selectFrom("swarm_agents")
    .selectAll()
    .where("swarm_id", "=", swarmId)
    .execute();
  return { swarm: swarm as SwarmRow, agents: agents as SwarmAgentRow[] };
}

export async function createSessionForAgent(agent: SwarmAgentRow, swarm: SwarmRow): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const sandboxMountType = agent.sandbox_mode ? "copy" : "none";
  const session = await db
    .insertInto("sessions")
    .values({
      name: `swarm:${swarm.name}:${agent.name}`,
      working_dir: swarm.working_dir,
      start_time: nowSeconds(),
      end_time: null,
      last_activity: now,
      continued_from: null,
      project_type: null,
      claude_session_id: null,
      personality: agent.personality,
      medium: "agent_api",
      user_id: null,
      thinking_budget: agent.thinking_budget,
      sandbox_mode: agent.sandbox_mode,
      sandbox_mount_type: sandboxMountType,
      sandbox_settings: null,
      is_locked: false,
      mission_id: null,
      created_at: now,
      summary: null,
      summary_updated_at: null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return session.id;
}

export async function insertConversation(
  sessionId: number,
  messageType: string,
  prompt: string,
  personality: string | null,
): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const timestamp = nowSeconds();
  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt,
      message_type: messageType,
      personality,
      timestamp,
      medium: "agent_api",
      user_id: null,
      ttft_ms: null,
      response_ms: null,
      thinking_ms: null,
      tool_uses: null,
      tool_names: null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  if (prompt.trim()) {
    await db
      .insertInto("conversation_blocks")
      .values({
        conversation_id: conversation.id,
        ordinal: 0,
        block_type: "text",
        text: prompt,
        tool_use_id: null,
        tool_name: null,
        tool_input: null,
        is_error: null,
        content_embedding: null,
        created_at: now,
      })
      .execute();
  }

  await db
    .updateTable("sessions")
    .set({ last_activity: now })
    .where("id", "=", sessionId)
    .execute();

  return conversation.id;
}

export async function insertAssistantBlocks(
  sessionId: number,
  blocks: MessageBlock[],
  personality: string | null,
  metadata: { toolUses: number; toolNames: string[] },
): Promise<number | null> {
  if (blocks.length === 0) {
    return null;
  }

  const db = await getDb();
  const now = nowDate();
  const timestamp = nowSeconds();

  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt: blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join(""),
      message_type: "assistant",
      personality,
      timestamp,
      medium: "agent_api",
      user_id: null,
      ttft_ms: null,
      response_ms: null,
      thinking_ms: null,
      tool_uses: metadata.toolUses,
      tool_names: metadata.toolNames.length > 0 ? metadata.toolNames : null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  let ordinal = 0;
  for (const block of blocks) {
    if (block.type === "text" || block.type === "thinking") {
      const text = block.text ?? "";
      if (!text) {
        continue;
      }
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text,
          tool_use_id: null,
          tool_name: null,
          tool_input: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_use") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text: null,
          tool_use_id: block.id ?? null,
          tool_name: block.name ?? null,
          tool_input: block.input ?? null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_result") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text: block.output ?? "",
          tool_use_id: block.tool_use_id ?? null,
          tool_name: null,
          tool_input: null,
          is_error: block.is_error ?? null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
    }
  }

  await db
    .updateTable("sessions")
    .set({ last_activity: now })
    .where("id", "=", sessionId)
    .execute();

  return conversation.id;
}

export async function buildDependencyContext(
  agent: SwarmAgentRow,
  swarmAgents: SwarmAgentRow[],
): Promise<string> {
  if (!agent.depends_on || agent.depends_on.length === 0) {
    return "";
  }

  const byId = new Map<number, SwarmAgentRow>();
  swarmAgents.forEach((item) => byId.set(item.id, item));

  const sections: string[] = [];
  for (const dep of agent.depends_on) {
    const depAgent = byId.get(dep.agent_id);
    if (!depAgent) {
      continue;
    }
    const include = dep.include ?? "summary";
    if (include === "none") {
      continue;
    }

    let output = depAgent.output_text ?? "";
    if (include === "summary") {
      if (depAgent.output_summary) {
        output = depAgent.output_summary;
      } else if (output.length > SUMMARY_THRESHOLD) {
        output = (await generateSummary(output)) ?? output.slice(0, 2000);
      }
    }
    if (!output) {
      continue;
    }

    sections.push(`## Dependency: ${depAgent.name} (${include})\n\n${output}`);
  }

  if (sections.length === 0) {
    return "";
  }
  return sections.join("\n\n");
}

export async function executeAssignedAgent(
  swarm: SwarmRow,
  agent: SwarmAgentRow,
  swarmAgents: SwarmAgentRow[],
) {
  const db = await getDb();
  const startedAt = nowDate();

  // Create session first, before setting RUNNING status
  // This ensures we never have RUNNING status without a valid session_id
  let sessionId: number;
  try {
    sessionId = await createSessionForAgent(agent, swarm);
  } catch (error) {
    // If session creation fails, mark agent as failed immediately
    const message = error instanceof Error ? error.message : String(error);
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.FAILED,
        completed_at: nowDate(),
        error_message: `Session creation failed: ${message}`,
      })
      .where("id", "=", agent.id)
      .execute();

    daemonEvents.emit("agent:end", {
      agentId: agent.id,
      swarmId: swarm.id,
      name: agent.name,
      status: "failed",
      durationSeconds: 0,
    });

    throw new AgentExecutionError(`Session creation failed: ${message}`, {
      swarmId: swarm.id,
      agentId: agent.id,
      agentName: agent.name,
      ...(error instanceof Error && { cause: error }),
    });
  }

  // Atomically set RUNNING status and session_id together
  await db
    .updateTable("swarm_agents")
    .set({ status: STATUS.RUNNING, started_at: startedAt, session_id: sessionId })
    .where("id", "=", agent.id)
    .execute();

  // Emit agent start event only after state is consistent
  daemonEvents.emit("agent:start", {
    agentId: agent.id,
    swarmId: swarm.id,
    name: agent.name,
    role: agent.role ?? "generic",
  });

  const dependencyContext = await buildDependencyContext(agent, swarmAgents);
  const prompt = dependencyContext ? `${dependencyContext}\n\n${agent.prompt}` : agent.prompt;

  try {
    await insertConversation(sessionId, "user", prompt, agent.personality);

    const {
      outputText: rawOutput,
      blocks,
      toolNames,
      toolCount,
    } = await runAgentQuery({
      swarm,
      agent,
      prompt,
      sessionId,
    });

    let outputText = truncateOutput(rawOutput ?? "");
    if (!outputText.trim()) {
      outputText = "";
    }

    let outputSummary: string | null = null;
    if (outputText.length > SUMMARY_THRESHOLD) {
      outputSummary = await generateSummary(outputText);
    }

    const completedAt = nowDate();
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.COMPLETED,
        completed_at: completedAt,
        output_text: outputText,
        output_summary: outputSummary,
        tool_count: toolCount,
        error_message: null,
      })
      .where("id", "=", agent.id)
      .execute();

    // Emit agent end event
    daemonEvents.emit("agent:end", {
      agentId: agent.id,
      swarmId: swarm.id,
      name: agent.name,
      status: "completed",
      durationSeconds: (completedAt.getTime() - startedAt.getTime()) / 1000,
    });

    let assistantConversationId: number | null = null;
    if (blocks.length > 0) {
      assistantConversationId = await insertAssistantBlocks(sessionId, blocks, agent.personality, {
        toolUses: toolCount,
        toolNames,
      });
    } else if (outputText) {
      assistantConversationId = await insertConversation(
        sessionId,
        "assistant",
        outputText,
        agent.personality,
      );
    }

    void bufferInteractionStimulus({
      sessionId,
      prompt,
      responseText: outputText,
      toolCount,
      personality: agent.personality,
      workingDir: swarm.working_dir,
    }).catch((error) => {
      log.emotion.warn("Buffer failed", { error: String(error) });
    });

    if (agent.is_synthesis_agent) {
      await db
        .updateTable("swarms")
        .set({
          synthesis_output: outputText,
          synthesis_summary: outputSummary,
        })
        .where("id", "=", swarm.id)
        .execute();
    }
  } catch (error) {
    const completedAt = nowDate();
    const isTimeout = error instanceof AgentTimeoutError;
    const status = isTimeout ? STATUS.TIMED_OUT : STATUS.FAILED;

    // Build meaningful error message with context
    let message: string;
    if (error instanceof SwarmError) {
      message = error.message;
      log.swarm.error(`Agent ${agent.name} failed`, error.toLogContext());
    } else if (error instanceof Error) {
      message = `${error.name}: ${error.message}`;
      log.swarm.error(`Agent ${agent.name} failed with unexpected error`, {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        error: message,
        stack: error.stack,
      });
    } else {
      message = String(error);
      log.swarm.error(`Agent ${agent.name} failed with unknown error`, {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        error: message,
      });
    }

    // Update agent status - wrap in try/catch to ensure we don't lose the original error
    try {
      await db
        .updateTable("swarm_agents")
        .set({
          status,
          completed_at: completedAt,
          error_message: message,
        })
        .where("id", "=", agent.id)
        .execute();
    } catch (dbError) {
      log.swarm.error(`Failed to update agent status after error`, {
        swarmId: swarm.id,
        agentId: agent.id,
        originalError: message,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }

    // Emit agent end event for failure
    daemonEvents.emit("agent:end", {
      agentId: agent.id,
      swarmId: swarm.id,
      name: agent.name,
      status: isTimeout ? "timed_out" : "failed",
      durationSeconds: (completedAt.getTime() - startedAt.getTime()) / 1000,
    });
  } finally {
    // Mark session as complete regardless of success/failure
    try {
      await closeSession(db, sessionId);
    } catch (closeError) {
      log.swarm.warn(`Failed to close session for agent ${agent.name}`, {
        sessionId,
        error: closeError instanceof Error ? closeError.message : String(closeError),
      });
    }
  }
}

/**
 * Attempt to claim a task for an agent using optimistic locking with retry.
 * Uses SELECT FOR UPDATE SKIP LOCKED to avoid contention between agents.
 */
export async function claimTaskForAgent(
  agentId: number,
  workingDir: string,
  taskTypes: string[] | null,
  requiredTools: string[] | null,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Use transaction with SELECT FOR UPDATE SKIP LOCKED to atomically claim
    const result = await db.transaction().execute(async (trx) => {
      // Build base query with FOR UPDATE SKIP LOCKED to prevent contention
      let baseConditions = sql`
        working_dir = ${workingDir}
        AND status = 'ready'
        AND claimed_by_session_id IS NULL
        AND claimed_by_agent_id IS NULL
      `;

      if (taskTypes && taskTypes.length > 0) {
        baseConditions = sql`${baseConditions} AND task_type = ANY(${taskTypes}::text[])`;
      }

      if (requiredTools && requiredTools.length > 0) {
        baseConditions = sql`${baseConditions} AND required_tools && ${requiredTools}::text[]`;
      }

      // Use raw SQL for FOR UPDATE SKIP LOCKED which Kysely doesn't support directly
      const taskResult = await sql<Record<string, unknown>>`
        SELECT * FROM project_tasks
        WHERE ${baseConditions}
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `.execute(trx);

      const task = taskResult.rows[0] ?? null;
      if (!task) {
        return null;
      }

      const now = nowDate();
      await trx
        .updateTable("project_tasks")
        .set({
          status: "claimed",
          claimed_by_agent_id: agentId,
          claimed_at: now,
          updated_at: now,
        })
        .where("id", "=", task.id as number)
        .execute();

      return task;
    });

    if (result !== null) {
      return result;
    }

    // No tasks available (not a race condition, just empty queue)
    // No need to retry
    break;
  }

  return null;
}

export async function executeAutonomousAgent(swarm: SwarmRow, agent: SwarmAgentRow): Promise<void> {
  const db = await getDb();
  const startedAt = nowDate();
  let currentTaskId: number | null = null;
  let sessionId: number | null = null;

  // Create session first, before setting RUNNING status
  // This ensures we never have RUNNING status without a valid session_id
  try {
    sessionId = await createSessionForAgent(agent, swarm);
  } catch (error) {
    // If session creation fails, mark agent as failed immediately
    const message = error instanceof Error ? error.message : String(error);
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.FAILED,
        completed_at: nowDate(),
        error_message: `Session creation failed: ${message}`,
      })
      .where("id", "=", agent.id)
      .execute();

    throw new AgentExecutionError(`Session creation failed: ${message}`, {
      swarmId: swarm.id,
      agentId: agent.id,
      agentName: agent.name,
      ...(error instanceof Error && { cause: error }),
    });
  }

  try {
    // Atomically set RUNNING status and session_id together
    await db
      .updateTable("swarm_agents")
      .set({ status: STATUS.RUNNING, started_at: startedAt, session_id: sessionId })
      .where("id", "=", agent.id)
      .execute();

    const startTime = nowDate();
    let lastTaskTime = startTime;
    let tasksCompleted = agent.tasks_completed ?? 0;
    let tasksFailed = agent.tasks_failed ?? 0;

    while (true) {
      // Check for cancel before each iteration
      if (swarmState.isCancelled(swarm.id)) {
        break;
      }

      const elapsed = (nowDate().getTime() - startTime.getTime()) / 1000;
      if (agent.max_duration_seconds && elapsed >= agent.max_duration_seconds) {
        break;
      }
      if (agent.max_tasks && tasksCompleted >= agent.max_tasks) {
        break;
      }

      const task = await claimTaskForAgent(
        agent.id,
        swarm.working_dir,
        agent.task_types,
        agent.capabilities,
      );
      if (!task) {
        const idleTime = (nowDate().getTime() - lastTaskTime.getTime()) / 1000;
        if (idleTime >= agent.idle_timeout_seconds) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      lastTaskTime = nowDate();
      currentTaskId = task.id as number;

      await db
        .updateTable("swarm_agents")
        .set({ current_task_id: currentTaskId })
        .where("id", "=", agent.id)
        .execute();

      const prompt = buildTaskPrompt(agent, task, swarm);
      const { outputText: rawOutput } = await runAgentQuery({
        swarm,
        agent,
        prompt,
        sessionId,
      });
      const outputText = truncateOutput(rawOutput ?? "");

      const success = outputText.trim().length > 0;
      if (success) {
        tasksCompleted += 1;
        await db
          .updateTable("project_tasks")
          .set({
            status: "done",
            outcome: `Completed by autonomous agent '${agent.name}'`,
            completion_notes: outputText.slice(0, 2000),
            completed_at: nowDate(),
            updated_at: nowDate(),
          })
          .where("id", "=", currentTaskId)
          .execute();
      } else {
        tasksFailed += 1;
        await db
          .updateTable("project_tasks")
          .set({
            status: "ready",
            last_error: "Agent produced no output",
            claimed_by_agent_id: null,
            claimed_at: null,
            updated_at: nowDate(),
          })
          .where("id", "=", currentTaskId)
          .execute();
      }

      currentTaskId = null;
      await db
        .updateTable("swarm_agents")
        .set({ current_task_id: null })
        .where("id", "=", agent.id)
        .execute();
    }

    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.COMPLETED,
        completed_at: nowDate(),
        output_text: `Autonomous agent completed. Tasks: ${tasksCompleted} completed, ${tasksFailed} failed.`,
        tasks_completed: tasksCompleted,
        tasks_failed: tasksFailed,
      })
      .where("id", "=", agent.id)
      .execute();
  } catch (error) {
    // Build meaningful error message with context
    let errorMessage: string;
    if (error instanceof SwarmError) {
      errorMessage = error.message;
      log.swarm.error(`Autonomous agent ${agent.name} failed`, error.toLogContext());
    } else if (error instanceof Error) {
      errorMessage = `${error.name}: ${error.message}`;
      log.swarm.error(`Autonomous agent ${agent.name} failed with unexpected error`, {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        error: errorMessage,
        stack: error.stack,
        currentTaskId,
      });
    } else {
      errorMessage = String(error);
      log.swarm.error(`Autonomous agent ${agent.name} failed with unknown error`, {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        error: errorMessage,
        currentTaskId,
      });
    }

    // Mark agent as failed - wrap in try/catch to log but not hide original error
    try {
      await db
        .updateTable("swarm_agents")
        .set({
          status: STATUS.FAILED,
          completed_at: nowDate(),
          error_message: errorMessage,
          current_task_id: null,
        })
        .where("id", "=", agent.id)
        .execute();
    } catch (dbError) {
      log.swarm.error(`Failed to update autonomous agent status after error`, {
        swarmId: swarm.id,
        agentId: agent.id,
        originalError: errorMessage,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }

    // Release any claimed task
    if (currentTaskId) {
      try {
        await db
          .updateTable("project_tasks")
          .set({
            status: "ready",
            last_error: `Agent crashed: ${errorMessage}`,
            claimed_by_agent_id: null,
            claimed_at: null,
            updated_at: nowDate(),
          })
          .where("id", "=", currentTaskId)
          .execute();
      } catch (releaseError) {
        log.swarm.error(`Failed to release task after agent crash`, {
          swarmId: swarm.id,
          agentId: agent.id,
          taskId: currentTaskId,
          releaseError: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
    }

    // Wrap error with context if it's not already a SwarmError
    if (!(error instanceof SwarmError)) {
      throw new AgentExecutionError(`Autonomous agent failed: ${errorMessage}`, {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        ...(error instanceof Error && { cause: error }),
      });
    }
    throw error;
  } finally {
    // Mark session as complete regardless of success/failure
    if (sessionId) {
      try {
        await closeSession(db, sessionId);
      } catch (closeError) {
        log.swarm.warn(`Failed to close session for autonomous agent ${agent.name}`, {
          sessionId,
          error: closeError instanceof Error ? closeError.message : String(closeError),
        });
      }
    }
  }
}

export async function executeAgentWithDependencies(swarmId: number, agent: SwarmAgentRow) {
  const completion = getCompletionSignal(swarmId, agent.id);

  try {
    if (agent.depends_on && agent.depends_on.length > 0) {
      for (const dep of agent.depends_on) {
        const signal = getCompletionSignal(swarmId, dep.agent_id);
        await signal.promise;
      }
    }

    const { swarm, agents } = (await getSwarmWithAgents(swarmId)) ?? {};
    if (!swarm || !agents) {
      completion.resolve();
      return;
    }

    if (agent.is_synthesis_agent && swarm.skip_synthesis_on_failure) {
      const failed = agents.some(
        (other) =>
          !other.is_synthesis_agent &&
          other.name !== MEMORY_STEWARD_NAME &&
          (other.status === STATUS.FAILED || other.status === STATUS.TIMED_OUT),
      );
      if (failed) {
        await getDb()
          .then((db) =>
            db
              .updateTable("swarm_agents")
              .set({ status: STATUS.SKIPPED, completed_at: nowDate() })
              .where("id", "=", agent.id)
              .execute(),
          )
          .catch(() => null);
        completion.resolve();
        return;
      }
    }

    if (swarmState.isCancelled(swarmId)) {
      await getDb()
        .then((db) =>
          db
            .updateTable("swarm_agents")
            .set({ status: STATUS.CANCELLED, completed_at: nowDate() })
            .where("id", "=", agent.id)
            .execute(),
        )
        .catch(() => null);
      completion.resolve();
      return;
    }

    // Check if any dependency without a condition has failed
    // Dependencies with conditions are evaluated separately below
    let shouldSkip = false;
    let skipReason: string | null = null;
    if (agent.depends_on) {
      for (const dep of agent.depends_on) {
        const depAgent = agents.find((item) => item.id === dep.agent_id);
        if (!depAgent) {
          continue;
        }

        // For dependencies without conditions, skip if they failed or timed out
        if (!dep.condition && (depAgent.status === STATUS.FAILED || depAgent.status === STATUS.TIMED_OUT)) {
          shouldSkip = true;
          const reason = depAgent.status === STATUS.TIMED_OUT ? "timed out" : "failed";
          skipReason = `Dependency '${depAgent.name}' ${reason}`;
          break;
        }

        // For dependencies with conditions, evaluate the condition
        if (dep.condition) {
          const result = evaluateCondition(dep.condition, depAgent.output_text);
          if (!result.result) {
            shouldSkip = true;
            skipReason = `Condition not met for dependency '${depAgent.name}'`;
            break;
          }
        }
      }
    }

    if (shouldSkip) {
      await getDb()
        .then((db) =>
          db
            .updateTable("swarm_agents")
            .set({
              status: STATUS.SKIPPED,
              completed_at: nowDate(),
              error_message: skipReason,
            })
            .where("id", "=", agent.id)
            .execute(),
        )
        .catch(() => null);
      completion.resolve();
      return;
    }

    if (agent.mode === "autonomous") {
      // Autonomous agents have their own timeout handling via max_duration_seconds
      await executeAutonomousAgent(swarm, agent);
    } else {
      // Assigned agents use a timeout wrapper with proper cleanup
      const timeoutSeconds = agent.max_duration_seconds ?? DEFAULT_AGENT_TIMEOUT_SECONDS;

      // Use timeout options for better observability and cleanup
      const timeoutOptions: TimeoutOptions = {
        gracePeriodMs: 2000, // 2 second grace period for cleanup
        onTimeout: (elapsedSeconds) => {
          log.swarm.warn("Agent timeout triggered", {
            swarmId,
            agentId: agent.id,
            agentName: agent.name,
            elapsedSeconds,
            timeoutSeconds,
          });
        },
      };

      await withTimeout(
        executeAssignedAgent(swarm, agent, agents),
        timeoutSeconds,
        timeoutOptions,
      );
    }
  } catch (error) {
    // Log unhandled errors that bubble up from agent execution
    // Most errors should be caught in executeAssignedAgent/executeAutonomousAgent
    // This catches errors that occur before agent execution or during dependency resolution
    if (error instanceof SwarmError) {
      log.swarm.error(`Agent execution failed`, error.toLogContext());
    } else {
      log.swarm.error(`Unexpected error in agent execution`, {
        swarmId,
        agentId: agent.id,
        agentName: agent.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    // Ensure agent is marked as failed if not already in a terminal state
    try {
      const db = await getDb();
      const currentAgent = await db
        .selectFrom("swarm_agents")
        .select(["status"])
        .where("id", "=", agent.id)
        .executeTakeFirst();

      // Only update if not already in a terminal state
      if (
        currentAgent &&
        !["completed", "failed", "cancelled", "skipped", "timed_out"].includes(currentAgent.status)
      ) {
        const isTimeout = error instanceof AgentTimeoutError;
        await db
          .updateTable("swarm_agents")
          .set({
            status: isTimeout ? STATUS.TIMED_OUT : STATUS.FAILED,
            completed_at: nowDate(),
            error_message: error instanceof Error ? error.message : String(error),
          })
          .where("id", "=", agent.id)
          .execute();
      }
    } catch (dbError) {
      log.swarm.error(`Failed to update agent status after unhandled error`, {
        swarmId,
        agentId: agent.id,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }
  } finally {
    swarmState.untrackAgent(agent.id);
    completion.resolve();
  }
}
