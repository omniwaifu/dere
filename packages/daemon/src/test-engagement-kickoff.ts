/**
 * Test script for engagement kickoff.
 *
 * Run with: bun packages/daemon/src/test-engagement-kickoff.ts
 */

import { z } from "zod";
import {
  ClaudeAgentTransport,
  StructuredOutputClient,
} from "@dere/shared-llm";

import { getDb } from "./db.js";
import { loadAmbientConfig } from "./ambient-config.js";

// Copy the context building logic for testing
function formatTimeAgo(date: Date | null): string {
  if (!date) return "unknown";

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

function formatHumanTime(date: Date): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const day = days[date.getDay()];
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const hour12 = hours % 12 || 12;
  const minuteStr = minutes > 0 ? `:${String(minutes).padStart(2, "0")}` : "";
  return `${day} ${hour12}${minuteStr}${ampm}`;
}

const KickoffDecisionSchema = z.object({
  action: z.enum([
    "explore_curiosity",
    "web_search",
    "check_bluesky",
    "review_calendar",
    "do_nothing",
  ]),
  reasoning: z.string(),
  topic: z.string().optional(),
  task_id: z.number().optional(),
});

async function main() {
  console.log("=== Engagement Kickoff Test ===\n");

  const config = await loadAmbientConfig();
  const db = await getDb();

  // Build context
  console.log("Building context...\n");

  // Recent actions
  const executions = await db
    .selectFrom("mission_executions")
    .innerJoin("missions", "missions.id", "mission_executions.mission_id")
    .select([
      "missions.name",
      "missions.description",
      "mission_executions.completed_at",
    ])
    .where("mission_executions.status", "=", "completed")
    .orderBy("mission_executions.completed_at", "desc")
    .limit(5)
    .execute();

  const recentActions = executions.map((exec) => {
    const name = exec.name ?? "unknown";
    let action = name;
    if (name.startsWith("temporal-exploration-")) {
      const desc = exec.description ?? "";
      const match = desc.match(/Temporal exploration: (.+)/);
      action = match ? `explored "${match[1]}"` : "explored a topic";
    }
    return { action, when: formatTimeAgo(exec.completed_at) };
  });

  // Work queue
  const tasks = await db
    .selectFrom("project_tasks")
    .select(["id", "title", "created_at"])
    .where("task_type", "=", "curiosity")
    .where("status", "=", "ready")
    .orderBy("priority", "desc")
    .limit(10)
    .execute();

  const workQueue = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    age: formatTimeAgo(t.created_at),
  }));

  // User mood
  const emotionRow = await db
    .selectFrom("emotion_states")
    .select(["primary_emotion", "primary_intensity"])
    .where("session_id", "is", null)
    .orderBy("last_update", "desc")
    .limit(1)
    .executeTakeFirst();

  const userMood = emotionRow?.primary_emotion !== "neutral"
    ? emotionRow?.primary_emotion ?? null
    : null;

  const context = {
    currentTime: formatHumanTime(new Date()),
    userLastSeen: "unknown",
    recentActions,
    availableTools: ["WebSearch", "WebFetch", "Read", "explore_curiosity"],
    workQueue,
    userMood,
  };

  console.log("Context:");
  console.log(JSON.stringify(context, null, 2));
  console.log();

  // Build prompt
  const prompt = `You have a moment to yourself. What would you like to do?

${config.personality ? `Your personality:\n${config.personality}\n` : ""}
Current context:
${JSON.stringify(context, null, 2)}

Consider:
- If you recently did something, maybe don't repeat it immediately
- If the user seems busy or frustrated, maybe give them space
- If there are interesting curiosities in the queue, maybe explore one
- If nothing feels compelling, it's okay to do nothing

Choose an action and explain your reasoning briefly.`;

  console.log("Calling LLM for decision...\n");

  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  const client = new StructuredOutputClient({
    transport,
    model: process.env.DERE_AMBIENT_MODEL ?? "claude-haiku-4-5",
  });

  try {
    const startTime = Date.now();
    const decision = await client.generate(prompt, KickoffDecisionSchema, {
      schemaName: "kickoff_decision",
    });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`Decision (${duration}s):`);
    console.log(JSON.stringify(decision, null, 2));
    console.log();
    console.log("=== Test Complete ===");
  } catch (error) {
    console.error("LLM call failed:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
