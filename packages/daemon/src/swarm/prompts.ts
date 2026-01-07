// Swarm prompt builders

import {
  MEMORY_RECALL_QUERY_LIMIT,
  MEMORY_SCRATCHPAD_PREFIX,
  type SwarmRow,
  type SwarmAgentRow,
} from "./types.js";

export function buildRecallQuery(
  swarmName: string,
  swarmDescription: string | null,
  extra?: string | null,
): string {
  const parts = [swarmName];
  if (swarmDescription) {
    parts.push(swarmDescription);
  }
  if (extra) {
    parts.push(extra);
  }
  let query = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  if (query.length > MEMORY_RECALL_QUERY_LIMIT) {
    query = query.slice(0, MEMORY_RECALL_QUERY_LIMIT).trim();
  }
  return query;
}

export function buildMemoryPromptPrefix(
  swarmName: string,
  swarmDescription: string | null,
  agentName: string,
  extraQuery?: string | null,
): string {
  const query = buildRecallQuery(swarmName, swarmDescription, extraQuery);
  return (
    "# Swarm Memory Protocol\n" +
    "If recall_search is available, run it first with:\n" +
    `- query: "${query}"\n\n` +
    "If you discover durable facts, preferences, or decisions, write them to the swarm\n" +
    "scratchpad so the memory steward can store them:\n" +
    `- ${MEMORY_SCRATCHPAD_PREFIX}archival_facts/${agentName}: ` +
    '[{"fact": "...", "valid_from": "ISO-8601 or null", "tags": ["..."]}]\n' +
    `- ${MEMORY_SCRATCHPAD_PREFIX}core_updates/${agentName}: ` +
    '[{"block_type": "persona|human|task", "content": "...", "reason": "...", "scope": "user|session"}]\n' +
    `- ${MEMORY_SCRATCHPAD_PREFIX}recall_notes/${agentName}: "short notes"\n\n` +
    "Use scratchpad_set(key, value). If scratchpad tools aren't available, skip.\n"
  );
}

export function buildMemoryStewardPrompt(swarmName: string): string {
  return (
    `You are the memory steward for swarm '${swarmName}'.\n\n` +
    "Your job is to consolidate swarm findings into durable memory.\n\n" +
    "## Steps\n" +
    `1. Read scratchpad entries with prefix '${MEMORY_SCRATCHPAD_PREFIX}' using scratchpad_list.\n` +
    "2. Review dependency outputs (including synthesis if present).\n" +
    "3. If synthesis output includes a `Memory Payload` JSON block, prefer it.\n" +
    "4. Apply updates using:\n" +
    "   - core_memory_edit (persona/human/task)\n" +
    "   - archival_memory_insert (durable facts)\n" +
    "5. Write a brief summary to " +
    `${MEMORY_SCRATCHPAD_PREFIX}steward_summary using scratchpad_set.\n\n` +
    "## Rules\n" +
    "- Only store high-confidence, durable information.\n" +
    "- Keep core memory concise and factual.\n" +
    "- Avoid duplicating facts that already exist unless clarified.\n"
  );
}

export function buildDefaultSynthesisPrompt(swarmName: string): string {
  return (
    `You are the synthesis agent for swarm '${swarmName}'.\n\n` +
    "Your job is to produce a concise, high-signal summary of the swarm's work.\n\n" +
    "## Output format\n" +
    "Provide:\n" +
    "1. A short executive summary (3-5 bullets)\n" +
    "2. Key decisions and tradeoffs\n" +
    "3. Risks or open questions\n" +
    "4. Suggested next steps\n\n" +
    "If useful, include a `Memory Payload` JSON block with archival facts or core memory updates."
  );
}

export function buildSupervisorPrompt(
  swarmName: string,
  agentNames: string[],
  warnSeconds: number,
  cancelSeconds: number,
): string {
  return (
    `You are the watchdog supervisor for swarm '${swarmName}'.\n\n` +
    "Your job is to monitor running agents and detect stalls or failures.\n\n" +
    "## Agents\n" +
    agentNames.map((name) => `- ${name}`).join("\n") +
    "\n\n" +
    "## Instructions\n" +
    "1. Call get_swarm_status() to check all agents\n" +
    "2. If any agent has been running for longer than " +
    `${warnSeconds}s, send a warning message\n` +
    "3. If any agent has been running for longer than " +
    `${cancelSeconds}s, mark it as stuck and request cancellation\n\n` +
    "- get_swarm_status(): Get status of all agents\n" +
    "- Your observations help improve future swarms\n"
  );
}

export function buildTaskPrompt(
  agent: SwarmAgentRow,
  task: Record<string, unknown>,
  swarm: SwarmRow,
): string {
  const sections: string[] = [];
  if (agent.goal) {
    sections.push(`# Your Goal\n\n${agent.goal}`);
  }
  sections.push(`# Current Task\n\n**${String(task.title ?? "Untitled Task")}**`);
  if (typeof task.description === "string" && task.description) {
    sections.push(`## Description\n\n${task.description}`);
  }
  if (typeof task.acceptance_criteria === "string" && task.acceptance_criteria) {
    sections.push(`## Acceptance Criteria\n\n${task.acceptance_criteria}`);
  }
  if (typeof task.context_summary === "string" && task.context_summary) {
    sections.push(`## Context\n\n${task.context_summary}`);
  }
  if (Array.isArray(task.scope_paths) && task.scope_paths.length > 0) {
    sections.push(`## Scope\n\nFocus on: ${task.scope_paths.join(", ")}`);
  }

  sections.push(
    buildMemoryPromptPrefix(swarm.name, swarm.description, agent.name, String(task.title ?? "")),
  );

  sections.push(
    "## Instructions\n\n" +
      "1. Complete this task thoroughly\n" +
      "2. If you discover additional work needed, use work-queue tools to create follow-up tasks\n" +
      "3. Mark this task complete when done",
  );

  return sections.join("\n\n");
}
