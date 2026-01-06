/**
 * Engagement Kickoff Service
 *
 * Replaces deterministic ambient-monitor exploration logic with agent-driven decisions.
 * Instead of "if conditions met, explore", we ask "what do you want to do?"
 *
 * Key design:
 * - Jittered interval (not fixed cron)
 * - Rich context injection (last actions, tools, queue, mood)
 * - Personality prompt IS the drive system
 * - Exploration is one option among many
 */

import { z } from "zod";
import {
  ClaudeAgentTransport,
  StructuredOutputClient,
} from "@dere/shared-llm";

import { getDb } from "./db.js";
import { log } from "./logger.js";
import { loadAmbientConfig, type AmbientConfig } from "./ambient-config.js";
import { getState, getDaemonState, getActiveSessionCount } from "./daemon-state.js";
import { startExplorationWorkflow } from "./temporal/starter.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface RecentAction {
  action: string;
  when: string;
}

interface WorkQueueItem {
  id: number;
  title: string;
  age: string;
}

interface EngagementContext {
  currentTime: string;
  userLastSeen: string;
  recentActions: RecentAction[];
  availableTools: string[];
  workQueue: WorkQueueItem[];
  userMood: string | null;
}

// What the agent can decide to do
const KickoffDecisionSchema = z.object({
  action: z.enum([
    "explore_curiosity", // Pick a task from work queue and explore it
    "web_search",        // Search the web for something interesting
    "check_bluesky",     // Check Bluesky for updates (if available)
    "review_calendar",   // Check calendar for upcoming events (if available)
    "do_nothing",        // Explicitly decide to do nothing right now
  ]),
  reasoning: z.string().describe("Brief explanation of why this action was chosen"),
  topic: z.string().optional().describe("For explore/search: what to explore or search for"),
  task_id: z.number().optional().describe("For explore_curiosity: which task ID to explore"),
});

type KickoffDecision = z.infer<typeof KickoffDecisionSchema>;

// -----------------------------------------------------------------------------
// Context Builder
// -----------------------------------------------------------------------------

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

async function getRecentActions(limit = 5): Promise<RecentAction[]> {
  const db = await getDb();

  // Get recent mission executions (explorations, ambient missions)
  const executions = await db
    .selectFrom("mission_executions")
    .innerJoin("missions", "missions.id", "mission_executions.mission_id")
    .select([
      "missions.name",
      "missions.description",
      "mission_executions.trigger_type",
      "mission_executions.completed_at",
    ])
    .where("mission_executions.status", "=", "completed")
    .orderBy("mission_executions.completed_at", "desc")
    .limit(limit)
    .execute();

  return executions.map((exec) => {
    const name = exec.name ?? "unknown";
    let action = name;

    // Make action descriptions more human-readable
    if (name.startsWith("temporal-exploration-")) {
      const desc = exec.description ?? "";
      const match = desc.match(/Temporal exploration: (.+)/);
      action = match ? `explored "${match[1]}"` : "explored a topic";
    } else if (name.startsWith("ambient-")) {
      action = "checked in (ambient)";
    }

    return {
      action,
      when: formatTimeAgo(exec.completed_at),
    };
  });
}

async function getWorkQueue(limit = 10): Promise<WorkQueueItem[]> {
  const db = await getDb();

  const tasks = await db
    .selectFrom("project_tasks")
    .select(["id", "title", "created_at"])
    .where("task_type", "=", "curiosity")
    .where("status", "=", "ready")
    .orderBy("priority", "desc")
    .orderBy("created_at", "asc")
    .limit(limit)
    .execute();

  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    age: formatTimeAgo(task.created_at),
  }));
}

async function getUserMood(): Promise<string | null> {
  const db = await getDb();

  const row = await db
    .selectFrom("emotion_states")
    .select(["primary_emotion", "primary_intensity"])
    .where("session_id", "is", null) // Global emotion state
    .orderBy("last_update", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row?.primary_emotion || row.primary_emotion === "neutral") {
    return null;
  }

  const intensity = row.primary_intensity ?? 0;
  if (intensity < 30) {
    return `slightly ${row.primary_emotion}`;
  }
  if (intensity > 70) {
    return `very ${row.primary_emotion}`;
  }
  return row.primary_emotion;
}

async function getUserLastSeen(userId: string): Promise<string> {
  const stateRow = await getDaemonState(userId);
  return formatTimeAgo(stateRow?.last_interaction_at ?? null);
}

function getAvailableTools(_config: AmbientConfig): string[] {
  // For now, return a static list of commonly available tools
  // TODO: Query MCP server registry for actually connected tools
  const tools = ["WebSearch", "WebFetch", "Read", "Grep"];

  // Exploration is available if temporal is set up
  tools.push("explore_curiosity");

  return tools;
}

async function buildEngagementContext(config: AmbientConfig): Promise<EngagementContext> {
  const [recentActions, workQueue, userMood, userLastSeen] = await Promise.all([
    getRecentActions(),
    getWorkQueue(),
    getUserMood(),
    getUserLastSeen(config.user_id),
  ]);

  return {
    currentTime: formatHumanTime(new Date()),
    userLastSeen,
    recentActions,
    availableTools: getAvailableTools(config),
    workQueue,
    userMood,
  };
}

// -----------------------------------------------------------------------------
// Kickoff Logic
// -----------------------------------------------------------------------------

function buildKickoffPrompt(context: EngagementContext, personality: string | null): string {
  const contextJson = JSON.stringify(context, null, 2);

  const personalitySection = personality
    ? `\nYour personality:\n${personality}\n`
    : "";

  return `You have a moment to yourself. What would you like to do?

${personalitySection}
Current context:
${contextJson}

Consider:
- If you recently did something, maybe don't repeat it immediately
- If the user seems busy or frustrated, maybe give them space
- If there are interesting curiosities in the queue, maybe explore one
- If nothing feels compelling, it's okay to do nothing

Choose an action and explain your reasoning briefly.`;
}

async function executeKickoffDecision(
  decision: KickoffDecision,
  config: AmbientConfig,
): Promise<void> {
  log.ambient.info("Executing kickoff decision", {
    action: decision.action,
    reasoning: decision.reasoning,
  });

  switch (decision.action) {
    case "explore_curiosity": {
      const options: Parameters<typeof startExplorationWorkflow>[0] = {
        personality: config.personality,
        user_id: config.user_id,
        model: process.env.DERE_AMBIENT_MODEL ?? "claude-sonnet-4-5",
      };
      if (decision.task_id !== undefined) {
        options.taskId = decision.task_id;
      }
      const result = await startExplorationWorkflow(options);

      if (result) {
        log.ambient.info("Started exploration workflow", {
          workflowId: result.workflowId,
          taskId: result.taskId,
        });
      } else {
        log.ambient.debug("No tasks available to explore");
      }
      break;
    }

    case "web_search": {
      // TODO: Implement web search action
      log.ambient.info("Web search requested", { topic: decision.topic });
      break;
    }

    case "check_bluesky": {
      // TODO: Implement Bluesky check (requires atproto MCP)
      log.ambient.info("Bluesky check requested");
      break;
    }

    case "review_calendar": {
      // TODO: Implement calendar review (requires gcal MCP)
      log.ambient.info("Calendar review requested");
      break;
    }

    case "do_nothing": {
      log.ambient.debug("Decided to do nothing", { reasoning: decision.reasoning });
      break;
    }
  }
}

async function runKickoff(config: AmbientConfig): Promise<void> {
  // Check if we're in engaged state - don't interrupt active sessions
  const stateRow = await getDaemonState(config.user_id);
  const sessionCount = await getActiveSessionCount(config.user_id);
  const currentState = getState(stateRow, sessionCount);

  if (currentState === "engaged") {
    log.ambient.debug("Skipping kickoff: user is engaged");
    return;
  }

  // Build context
  const context = await buildEngagementContext(config);

  log.ambient.debug("Running engagement kickoff", {
    queueSize: context.workQueue.length,
    recentActionCount: context.recentActions.length,
    userMood: context.userMood,
  });

  // Call LLM for decision
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  const client = new StructuredOutputClient({
    transport,
    model: process.env.DERE_AMBIENT_MODEL ?? "claude-haiku-4-5",
  });

  const prompt = buildKickoffPrompt(context, config.personality);

  try {
    const decision = (await client.generate(
      prompt,
      KickoffDecisionSchema,
      { schemaName: "kickoff_decision" },
    )) as KickoffDecision;

    await executeKickoffDecision(decision, config);
  } catch (error) {
    log.ambient.error("Kickoff LLM call failed", { error: String(error) });
  }
}

// -----------------------------------------------------------------------------
// Jittered Interval Loop
// -----------------------------------------------------------------------------

function jitteredInterval(baseMinutes: number, jitterPercent = 0.3): number {
  const jitter = baseMinutes * jitterPercent;
  const min = baseMinutes - jitter;
  const max = baseMinutes + jitter;
  return (min + Math.random() * (max - min)) * 60 * 1000; // Return ms
}

let running = false;
let loopPromise: Promise<void> | null = null;

async function kickoffLoop(config: AmbientConfig): Promise<void> {
  // Startup delay
  if (config.startup_delay_seconds > 0) {
    log.ambient.debug("Kickoff startup delay", { seconds: config.startup_delay_seconds });
    await new Promise((r) => setTimeout(r, config.startup_delay_seconds * 1000));
  }

  while (running) {
    try {
      await runKickoff(config);
    } catch (error) {
      log.ambient.error("Kickoff loop error", { error: String(error) });
    }

    // Jittered wait
    const waitMs = jitteredInterval(config.check_interval_minutes);
    const waitMinutes = (waitMs / 60000).toFixed(1);
    log.ambient.debug("Next kickoff scheduled", { minutes: waitMinutes });

    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function startEngagementKickoff(): Promise<void> {
  if (running) {
    log.ambient.warn("Engagement kickoff already running");
    return;
  }

  const config = await loadAmbientConfig();

  if (!config.enabled) {
    log.ambient.info("Engagement kickoff disabled in config");
    return;
  }

  running = true;
  loopPromise = kickoffLoop(config);

  log.ambient.info("Engagement kickoff started", {
    baseIntervalMinutes: config.check_interval_minutes,
  });
}

export async function stopEngagementKickoff(): Promise<void> {
  running = false;
  if (loopPromise) {
    await loopPromise.catch(() => undefined);
  }
  log.ambient.info("Engagement kickoff stopped");
}
