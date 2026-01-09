/**
 * Database activities for swarm execution.
 *
 * These activities handle status updates, conversation recording,
 * and other database operations for swarm agents.
 */

import { getDb } from "../../../db.js";
import { daemonEvents } from "../../../events.js";
import type { SwarmSpec, AgentSpec, AgentResult } from "./types.js";
import type { MessageBlock } from "../../../swarm/agent-query.js";
import {
  insertConversation,
  insertAssistantWithBlocks,
  type ConversationBlock,
} from "../../../utils/conversations.js";

// ============================================================================
// Agent Status Updates
// ============================================================================

export interface UpdateAgentRunningInput {
  agentId: number;
  swarmId: number;
  sessionId: number;
}

export async function markAgentRunning(input: UpdateAgentRunningInput): Promise<void> {
  const { agentId, swarmId, sessionId } = input;
  const db = await getDb();
  const now = new Date();

  await db
    .updateTable("swarm_agents")
    .set({
      status: "running",
      started_at: now,
      session_id: sessionId,
    })
    .where("id", "=", agentId)
    .execute();

  // Get agent info for event
  const agent = await db
    .selectFrom("swarm_agents")
    .select(["name", "role"])
    .where("id", "=", agentId)
    .executeTakeFirst();

  if (agent) {
    daemonEvents.emit("agent:start", {
      agentId,
      swarmId,
      name: agent.name,
      role: agent.role ?? "generic",
    });
  }
}

export interface UpdateAgentCompletedInput {
  agentId: number;
  swarmId: number;
  outputText: string;
  outputSummary: string | null;
  toolCount: number;
  startedAt: number; // timestamp ms
}

export async function markAgentCompleted(input: UpdateAgentCompletedInput): Promise<void> {
  const { agentId, swarmId, outputText, outputSummary, toolCount, startedAt } = input;
  const db = await getDb();
  const now = new Date();

  await db
    .updateTable("swarm_agents")
    .set({
      status: "completed",
      completed_at: now,
      output_text: outputText,
      output_summary: outputSummary,
      tool_count: toolCount,
      error_message: null,
    })
    .where("id", "=", agentId)
    .execute();

  // Get agent info for event
  const agent = await db
    .selectFrom("swarm_agents")
    .select(["name"])
    .where("id", "=", agentId)
    .executeTakeFirst();

  if (agent) {
    daemonEvents.emit("agent:end", {
      agentId,
      swarmId,
      name: agent.name,
      status: "completed",
      durationSeconds: (now.getTime() - startedAt) / 1000,
    });
  }
}

export interface UpdateAgentFailedInput {
  agentId: number;
  swarmId: number;
  errorMessage: string;
  status: "failed" | "cancelled" | "timed_out";
  startedAt: number; // timestamp ms
}

export async function markAgentFailed(input: UpdateAgentFailedInput): Promise<void> {
  const { agentId, swarmId, errorMessage, status, startedAt } = input;
  const db = await getDb();
  const now = new Date();

  await db
    .updateTable("swarm_agents")
    .set({
      status,
      completed_at: now,
      error_message: errorMessage,
    })
    .where("id", "=", agentId)
    .execute();

  // Get agent info for event
  const agent = await db
    .selectFrom("swarm_agents")
    .select(["name"])
    .where("id", "=", agentId)
    .executeTakeFirst();

  if (agent) {
    daemonEvents.emit("agent:end", {
      agentId,
      swarmId,
      name: agent.name,
      status,
      durationSeconds: (now.getTime() - startedAt) / 1000,
    });
  }
}

export interface MarkAgentSkippedInput {
  agentId: number;
  swarmId: number;
  reason: string;
}

export async function markAgentSkipped(input: MarkAgentSkippedInput): Promise<void> {
  const { agentId, swarmId, reason } = input;
  const db = await getDb();
  const now = new Date();

  await db
    .updateTable("swarm_agents")
    .set({
      status: "skipped",
      completed_at: now,
      error_message: reason,
    })
    .where("id", "=", agentId)
    .execute();

  // Get agent info for event
  const agent = await db
    .selectFrom("swarm_agents")
    .select(["name"])
    .where("id", "=", agentId)
    .executeTakeFirst();

  if (agent) {
    daemonEvents.emit("agent:end", {
      agentId,
      swarmId,
      name: agent.name,
      status: "skipped",
      durationSeconds: 0,
    });
  }
}

// ============================================================================
// Conversation Recording
// ============================================================================

export interface RecordConversationInput {
  sessionId: number;
  messageType: "user" | "assistant";
  prompt: string;
  personality: string | null;
}

export async function recordConversation(input: RecordConversationInput): Promise<number> {
  return insertConversation({
    sessionId: input.sessionId,
    messageType: input.messageType,
    prompt: input.prompt,
    personality: input.personality,
  });
}

export interface RecordAssistantBlocksInput {
  sessionId: number;
  blocks: MessageBlock[];
  personality: string | null;
  toolCount: number;
  toolNames: string[];
}

export async function recordAssistantBlocks(input: RecordAssistantBlocksInput): Promise<number | null> {
  return insertAssistantWithBlocks({
    sessionId: input.sessionId,
    blocks: input.blocks as ConversationBlock[],
    personality: input.personality,
  });
}

// ============================================================================
// Synthesis Updates
// ============================================================================

export interface UpdateSynthesisOutputInput {
  swarmId: number;
  outputText: string;
  outputSummary: string | null;
}

export async function updateSynthesisOutput(input: UpdateSynthesisOutputInput): Promise<void> {
  const { swarmId, outputText, outputSummary } = input;
  const db = await getDb();

  await db
    .updateTable("swarms")
    .set({
      synthesis_output: outputText,
      synthesis_summary: outputSummary,
    })
    .where("id", "=", swarmId)
    .execute();
}

// ============================================================================
// Swarm Status Updates
// ============================================================================

export interface UpdateSwarmStatusInput {
  swarmId: number;
  status: "running" | "completed" | "failed" | "cancelled";
}

export async function updateSwarmStatus(input: UpdateSwarmStatusInput): Promise<void> {
  const { swarmId, status } = input;
  const db = await getDb();
  const now = new Date();

  const updates: Record<string, unknown> = { status };

  if (status === "running") {
    updates.started_at = now;
  } else {
    updates.completed_at = now;
  }

  await db.updateTable("swarms").set(updates).where("id", "=", swarmId).execute();
}

// ============================================================================
// Query Operations
// ============================================================================

export interface GetAgentOutputInput {
  agentId: number;
}

export interface AgentOutput {
  outputText: string | null;
  outputSummary: string | null;
  status: string;
}

export async function getAgentOutput(input: GetAgentOutputInput): Promise<AgentOutput | null> {
  const { agentId } = input;
  const db = await getDb();

  const agent = await db
    .selectFrom("swarm_agents")
    .select(["output_text", "output_summary", "status"])
    .where("id", "=", agentId)
    .executeTakeFirst();

  if (!agent) {
    return null;
  }

  return {
    outputText: agent.output_text,
    outputSummary: agent.output_summary,
    status: agent.status,
  };
}

export interface GetSwarmAgentsInput {
  swarmId: number;
}

export interface SwarmAgentInfo {
  id: number;
  name: string;
  role: string;
  status: string;
  isSynthesisAgent: boolean;
  dependsOn: Array<{ agent_id: number; include: string; condition?: string | null }> | null;
  outputText: string | null;
  outputSummary: string | null;
}

export async function getSwarmAgents(input: GetSwarmAgentsInput): Promise<SwarmAgentInfo[]> {
  const { swarmId } = input;
  const db = await getDb();

  const agents = await db
    .selectFrom("swarm_agents")
    .select([
      "id",
      "name",
      "role",
      "status",
      "is_synthesis_agent",
      "depends_on",
      "output_text",
      "output_summary",
    ])
    .where("swarm_id", "=", swarmId)
    .execute();

  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    status: a.status,
    isSynthesisAgent: a.is_synthesis_agent,
    dependsOn: a.depends_on as SwarmAgentInfo["dependsOn"],
    outputText: a.output_text,
    outputSummary: a.output_summary,
  }));
}
