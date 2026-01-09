import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";

import { getDb } from "../db.js";
import { updateCoreMemoryFromSummary } from "../sessions/summary.js";
import { log } from "../logger.js";
import { insertConversation } from "../utils/conversations.js";
import {
  invalidateStaleEdges,
  invalidateStaleFacts,
  invalidateLowQualityFacts,
  mergeDuplicateEntities,
  buildCommunities,
} from "@dere/graph";

const MEMORY_CONSOLIDATION_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_RECENCY_DAYS = 30;
const DEFAULT_MODEL = "gemma3n:latest";
const DEFAULT_COMMUNITY_RESOLUTION = 1.0;
const FACT_QUALITY_THRESHOLD = 0.1;
const FACT_MIN_RETRIEVALS = 5;
const ENTITY_MERGE_LIMIT = 25;

const SUMMARY_SESSION_LIMIT = 5;
const SUMMARY_BLOCK_LIMIT = 60;
const SUMMARY_MIN_BLOCKS = 8;

let consolidationTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function nowDate(): Date {
  return new Date();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getSummaryClient(): TextResponseClient {
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  return new TextResponseClient({
    transport,
    model: process.env.DERE_SUMMARY_MODEL ?? "claude-opus-4-5",
  });
}

export function startMemoryConsolidationLoop(): void {
  if (consolidationTimer) {
    return;
  }

  consolidationTimer = setInterval(() => {
    void processQueue();
  }, MEMORY_CONSOLIDATION_CHECK_INTERVAL_MS);

  log.memory.info("Consolidation loop started", { intervalMs: MEMORY_CONSOLIDATION_CHECK_INTERVAL_MS });
}

export function stopMemoryConsolidationLoop(): void {
  if (!consolidationTimer) {
    return;
  }
  clearInterval(consolidationTimer);
  consolidationTimer = null;
  log.memory.info("Consolidation loop stopped");
}

async function processQueue(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    const task = await claimNextTask();
    if (!task) {
      return;
    }
    await runConsolidationTask(task);
  } catch (error) {
    log.memory.error("Consolidation loop error", { error: String(error) });
  } finally {
    running = false;
  }
}

async function claimNextTask() {
  const db = await getDb();
  const pending = await db
    .selectFrom("task_queue")
    .selectAll()
    .where("task_type", "=", "memory_consolidation")
    .where("status", "=", "pending")
    .orderBy("priority", "desc")
    .orderBy("created_at", "asc")
    .limit(1)
    .executeTakeFirst();

  if (!pending) {
    return null;
  }

  const claimed = await db
    .updateTable("task_queue")
    .set({
      status: "running",
      processed_at: nowDate(),
    })
    .where("id", "=", pending.id)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();

  return claimed ?? null;
}

async function runConsolidationTask(task: {
  id: number;
  metadata: unknown;
  model_name: string;
}) {
  const metadata = toJsonRecord(task.metadata) ?? {};
  const userId = typeof metadata.user_id === "string" ? metadata.user_id : null;
  const recencyDays =
    typeof metadata.recency_days === "number" ? metadata.recency_days : DEFAULT_RECENCY_DAYS;
  const updateCoreMemory = Boolean(metadata.update_core_memory);
  const trigger = typeof metadata.trigger === "string" ? metadata.trigger : null;
  const communityResolution =
    typeof metadata.community_resolution === "number"
      ? metadata.community_resolution
      : DEFAULT_COMMUNITY_RESOLUTION;
  const groupId = userId ?? "default";

  const db = await getDb();
  const start = nowDate();

  const run = await db
    .insertInto("consolidation_runs")
    .values({
      user_id: userId,
      task_id: task.id,
      status: "running",
      started_at: start,
      finished_at: null,
      recency_days: recencyDays,
      community_resolution: communityResolution,
      update_core_memory: updateCoreMemory,
      triggered_by: trigger,
      stats: null,
      error_message: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  try {
    const cutoffTs = nowSeconds() - recencyDays * 86400;
    const summaryBlocks = await summarizeOldConversations(cutoffTs, userId);
    const cutoffDate = new Date(Date.now() - recencyDays * 86400 * 1000);

    const prunedEdges = await invalidateStaleEdges(groupId, cutoffDate);
    const prunedFacts = await invalidateStaleFacts(groupId, cutoffDate);
    const prunedLowQualityFacts = await invalidateLowQualityFacts({
      groupId,
      cutoff: cutoffDate,
      qualityThreshold: FACT_QUALITY_THRESHOLD,
      minRetrievals: FACT_MIN_RETRIEVALS,
      // Defaults: minAgeDays=14, explorationGraceDays=60
    });
    const mergedEntities = await mergeDuplicateEntities(groupId, ENTITY_MERGE_LIMIT);
    const communities = await buildCommunities(groupId, communityResolution);

    let coreMemoryUpdates = 0;
    if (updateCoreMemory && userId) {
      coreMemoryUpdates = await updateCoreMemoryFromSummary(userId);
    }

    const stats = {
      summary_blocks: summaryBlocks,
      pruned_edges: prunedEdges,
      pruned_facts: prunedFacts,
      pruned_low_quality_facts: prunedLowQualityFacts,
      merged_entities: mergedEntities,
      core_memory_updates: coreMemoryUpdates,
      communities,
    };

    await db
      .updateTable("consolidation_runs")
      .set({
        status: "completed",
        finished_at: nowDate(),
        stats,
      })
      .where("id", "=", run.id)
      .execute();

    await db
      .updateTable("task_queue")
      .set({
        status: "completed",
        processed_at: nowDate(),
      })
      .where("id", "=", task.id)
      .execute();

    log.memory.info("Consolidation completed", { taskId: task.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .updateTable("consolidation_runs")
      .set({
        status: "failed",
        finished_at: nowDate(),
        error_message: message,
      })
      .where("id", "=", run.id)
      .execute();

    await db
      .updateTable("task_queue")
      .set({
        status: "failed",
        processed_at: nowDate(),
        error_message: message,
      })
      .where("id", "=", task.id)
      .execute();

    log.memory.error("Consolidation failed", { taskId: task.id, error: message });
  }
}

async function summarizeOldConversations(cutoffTs: number, userId: string | null): Promise<number> {
  const db = await getDb();
  let sessionsQuery = db
    .selectFrom("conversations as c")
    .innerJoin("conversation_blocks as cb", "cb.conversation_id", "c.id")
    .select("c.session_id")
    .where("c.timestamp", "<", cutoffTs)
    .where("c.message_type", "in", ["user", "assistant"])
    .where("cb.block_type", "=", "text")
    .where("cb.text", "is not", null)
    .where("cb.text", "!=", "")
    .distinct()
    .limit(SUMMARY_SESSION_LIMIT);

  if (userId) {
    sessionsQuery = sessionsQuery.where("c.user_id", "=", userId);
  }

  const sessions = await sessionsQuery.execute();

  const sessionIds = sessions.map((row) => row.session_id);
  if (sessionIds.length === 0) {
    return 0;
  }

  let summaryCount = 0;
  const client = getSummaryClient();

  for (const sessionId of sessionIds) {
    const blocks = await db
      .selectFrom("conversations as c")
      .innerJoin("conversation_blocks as cb", "cb.conversation_id", "c.id")
      .select(["c.message_type", "c.timestamp", "cb.text", "c.user_id"])
      .where("c.session_id", "=", sessionId)
      .where("c.timestamp", "<", cutoffTs)
      .where("c.message_type", "in", ["user", "assistant"])
      .where("cb.block_type", "=", "text")
      .where("cb.text", "is not", null)
      .where("cb.text", "!=", "")
      .orderBy("c.timestamp", "asc")
      .orderBy("cb.ordinal", "asc")
      .limit(SUMMARY_BLOCK_LIMIT)
      .execute();

    if (blocks.length < SUMMARY_MIN_BLOCKS) {
      continue;
    }

    const lines: string[] = [];
    let lastTs = 0;
    let sessionUserId: string | null = null;
    for (const row of blocks) {
      if (row.text) {
        lines.push(`${row.message_type}: ${row.text.trim()}`);
      }
      if (row.timestamp && row.timestamp > lastTs) {
        lastTs = row.timestamp;
      }
      if (!sessionUserId && row.user_id) {
        sessionUserId = row.user_id;
      }
    }

    if (lines.length === 0) {
      continue;
    }

    const summaryExists = await db
      .selectFrom("conversations")
      .select("id")
      .where("session_id", "=", sessionId)
      .where("message_type", "=", "system")
      .where("prompt", "ilike", "[Memory Summary]%")
      .where("timestamp", ">=", lastTs)
      .limit(1)
      .executeTakeFirst();

    if (summaryExists) {
      continue;
    }

    const content = lines.join("\n");
    const prompt = `Summarize these conversation turns into 3-6 bullet points. Focus on durable facts, decisions, and ongoing goals. Avoid ephemeral details and tool noise.

${content.slice(0, 8000)}`;

    let summaryText = "";
    try {
      summaryText = (await client.generate(prompt)).trim();
    } catch (error) {
      log.memory.warn("Summary generation failed", { sessionId, error: String(error) });
      continue;
    }

    if (!summaryText) {
      continue;
    }

    const summaryPayload = `[Memory Summary]\n${summaryText}`;
    await insertConversation({
      sessionId,
      messageType: "system",
      prompt: summaryPayload,
      personality: null,
      userId: sessionUserId ?? userId,
      medium: "memory",
      updateLastActivity: false,
    });

    summaryCount += 1;
  }

  return summaryCount;
}

export function registerMemoryConsolidationRoutes(app: import("hono").Hono): void {
  app.post("/api/consolidate/memory", async (c) => {
    const userId = c.req.query("user_id");
    const recencyDaysRaw = c.req.query("recency_days");
    const model = c.req.query("model") ?? DEFAULT_MODEL;
    const updateCoreMemory = c.req.query("update_core_memory") === "true";
    const communityResolutionRaw = c.req.query("community_resolution");

    const recencyDays = recencyDaysRaw ? Math.max(1, Number(recencyDaysRaw)) : DEFAULT_RECENCY_DAYS;
    const groupId = userId ?? "default";
    const communityResolution = communityResolutionRaw
      ? Number(communityResolutionRaw)
      : DEFAULT_COMMUNITY_RESOLUTION;

    const db = await getDb();
    const task = await db
      .insertInto("task_queue")
      .values({
        task_type: "memory_consolidation",
        model_name: model,
        content: `Memory consolidation for group ${groupId}`,
        metadata: {
          user_id: userId ?? null,
          recency_days: recencyDays,
          update_core_memory: updateCoreMemory,
          community_resolution: Number.isFinite(communityResolution)
            ? communityResolution
            : DEFAULT_COMMUNITY_RESOLUTION,
          trigger: "manual",
        },
        priority: 5,
        status: "pending",
        session_id: null,
        created_at: nowDate(),
        processed_at: null,
        retry_count: 0,
        error_message: null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return c.json({
      success: true,
      task_id: task.id,
      message: `Memory consolidation queued for group ${groupId}`,
    });
  });
}
