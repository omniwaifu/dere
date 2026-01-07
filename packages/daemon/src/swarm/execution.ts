// Swarm agent execution logic

import { sql } from "kysely";

import { getDb } from "../db.js";
import { closeSession } from "../db-utils.js";
import { daemonEvents } from "../events.js";
import { bufferInteractionStimulus } from "../emotions/runtime.js";
import { processCuriosityTriggers } from "../ambient/triggers/index.js";
import { log } from "../logger.js";
import { swarmState, type CompletionSignal } from "./state.js";
import {
  STATUS,
  SUMMARY_THRESHOLD,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  MEMORY_STEWARD_NAME,
  type SwarmRow,
  type SwarmAgentRow,
} from "./types.js";
import { nowDate, nowSeconds, truncateOutput, withTimeout } from "./utils.js";
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

  await db
    .updateTable("swarm_agents")
    .set({ status: STATUS.RUNNING, started_at: startedAt })
    .where("id", "=", agent.id)
    .execute();

  // Emit agent start event
  daemonEvents.emit("agent:start", {
    agentId: agent.id,
    swarmId: swarm.id,
    name: agent.name,
    role: agent.role ?? "generic",
  });

  const sessionId = await createSessionForAgent(agent, swarm);
  await db
    .updateTable("swarm_agents")
    .set({ session_id: sessionId })
    .where("id", "=", agent.id)
    .execute();

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

    if (assistantConversationId) {
      void processCuriosityTriggers({
        db,
        prompt: outputText,
        sessionId,
        conversationId: assistantConversationId,
        userId: null,
        workingDir: swarm.working_dir,
        personality: agent.personality,
        speakerName: null,
        isCommand: false,
        messageType: "assistant",
        kgNodes: null,
      }).catch((error) => {
        log.ambient.warn("Curiosity detection failed", { error: String(error) });
      });
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
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = nowDate();
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.FAILED,
        completed_at: completedAt,
        error_message: message,
      })
      .where("id", "=", agent.id)
      .execute();

    // Emit agent end event for failure
    daemonEvents.emit("agent:end", {
      agentId: agent.id,
      swarmId: swarm.id,
      name: agent.name,
      status: "failed",
      durationSeconds: (completedAt.getTime() - startedAt.getTime()) / 1000,
    });
  } finally {
    // Mark session as complete regardless of success/failure
    await closeSession(db, sessionId).catch(() => null);
  }
}

export async function claimTaskForAgent(
  agentId: number,
  workingDir: string,
  taskTypes: string[] | null,
  requiredTools: string[] | null,
): Promise<Record<string, unknown> | null> {
  const db = await getDb();

  let query = db
    .selectFrom("project_tasks")
    .selectAll()
    .where("working_dir", "=", workingDir)
    .where("status", "=", "ready")
    .where("claimed_by_session_id", "is", null)
    .where("claimed_by_agent_id", "is", null);

  if (taskTypes && taskTypes.length > 0) {
    query = query.where("task_type", "in", taskTypes);
  }

  if (requiredTools && requiredTools.length > 0) {
    query = query.where(sql<boolean>`required_tools && ${requiredTools}::text[]`);
  }

  const task = await query
    .orderBy("priority", "desc")
    .orderBy("created_at", "asc")
    .limit(1)
    .executeTakeFirst();
  if (!task) {
    return null;
  }

  const claimed = await db
    .updateTable("project_tasks")
    .set({
      status: "claimed",
      claimed_by_agent_id: agentId,
      claimed_at: nowDate(),
      updated_at: nowDate(),
    })
    .where("id", "=", task.id)
    .where("status", "=", "ready")
    .where("claimed_by_agent_id", "is", null)
    .executeTakeFirst();

  if (!claimed) {
    return null;
  }

  return task as Record<string, unknown>;
}

export async function executeAutonomousAgent(swarm: SwarmRow, agent: SwarmAgentRow): Promise<void> {
  const db = await getDb();
  const startedAt = nowDate();
  let currentTaskId: number | null = null;
  let sessionId: number | null = null;

  try {
    await db
      .updateTable("swarm_agents")
      .set({ status: STATUS.RUNNING, started_at: startedAt })
      .where("id", "=", agent.id)
      .execute();

    sessionId = await createSessionForAgent(agent, swarm);
    await db
      .updateTable("swarm_agents")
      .set({ session_id: sessionId })
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
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark agent as failed
    await db
      .updateTable("swarm_agents")
      .set({
        status: STATUS.FAILED,
        completed_at: nowDate(),
        error_message: errorMessage,
        current_task_id: null,
      })
      .where("id", "=", agent.id)
      .execute()
      .catch(() => null);

    // Release any claimed task
    if (currentTaskId) {
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
        .execute()
        .catch(() => null);
    }

    throw error; // Re-throw for upstream handling
  } finally {
    // Mark session as complete regardless of success/failure
    if (sessionId) {
      await closeSession(db, sessionId).catch(() => null);
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
          other.status === STATUS.FAILED,
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

        // For dependencies without conditions, skip if they failed
        if (!dep.condition && depAgent.status === STATUS.FAILED) {
          shouldSkip = true;
          skipReason = `Dependency '${depAgent.name}' failed`;
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
      // Assigned agents use a timeout wrapper
      const timeoutSeconds = agent.max_duration_seconds ?? DEFAULT_AGENT_TIMEOUT_SECONDS;
      await withTimeout(
        executeAssignedAgent(swarm, agent, agents),
        timeoutSeconds,
      );
    }
  } finally {
    swarmState.untrackAgent(agent.id);
    completion.resolve();
  }
}
