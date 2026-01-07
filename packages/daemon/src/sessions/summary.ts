import { sql } from "kysely";

import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";

import { getDb } from "../db.js";
import { log } from "../logger.js";

const SUMMARY_IDLE_TIMEOUT_SECONDS = 1800;
const SUMMARY_CHECK_INTERVAL_MS = 300_000;
const SUMMARY_MIN_MESSAGES = 5;
const DEFAULT_SUMMARY_MODEL = "claude-opus-4-5";

let summaryTimer: ReturnType<typeof setInterval> | null = null;
let summaryRunning = false;

function nowDate(): Date {
  return new Date();
}

function getSummaryClient(): TextResponseClient {
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  return new TextResponseClient({
    transport,
    model: process.env.DERE_SUMMARY_MODEL ?? DEFAULT_SUMMARY_MODEL,
  });
}

export function startSessionSummaryLoop(): void {
  if (summaryTimer) {
    return;
  }

  summaryTimer = setInterval(() => {
    void runSummaryCycle();
  }, SUMMARY_CHECK_INTERVAL_MS);

  log.summary.info("Session summary loop started", { intervalMs: SUMMARY_CHECK_INTERVAL_MS });
}

export function stopSessionSummaryLoop(): void {
  if (!summaryTimer) {
    return;
  }
  clearInterval(summaryTimer);
  summaryTimer = null;
  log.summary.info("Session summary loop stopped");
}

async function runSummaryCycle(): Promise<void> {
  if (summaryRunning) {
    return;
  }
  summaryRunning = true;
  try {
    await summarizeIdleSessions();
  } catch (error) {
    log.summary.warn("Periodic summary loop failed", { error: String(error) });
  } finally {
    summaryRunning = false;
  }
}

async function summarizeIdleSessions(): Promise<void> {
  if (process.env.DERE_DISABLE_SUMMARY === "1") {
    return;
  }

  const db = await getDb();
  const now = nowDate();
  const idleThreshold = new Date(now.getTime() - SUMMARY_IDLE_TIMEOUT_SECONDS * 1000);
  const recentThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const sessions = await db
    .selectFrom("sessions")
    .selectAll()
    .where("last_activity", ">=", recentThreshold)
    .where("last_activity", "<=", idleThreshold)
    .where("end_time", "is", null)
    .where(sql<boolean>`(summary is null or summary_updated_at < last_activity)`)
    .execute();

  if (sessions.length === 0) {
    return;
  }

  const client = getSummaryClient();
  const updatedUsers = new Set<string>();

  for (const session of sessions) {
    const countRow = await db
      .selectFrom("conversations")
      .select(db.fn.countAll().as("count"))
      .where("session_id", "=", session.id)
      .executeTakeFirst();

    const messageCount = Number(countRow?.count ?? 0);
    if (messageCount < SUMMARY_MIN_MESSAGES) {
      continue;
    }

    const rows = await db
      .selectFrom("conversations")
      .select(["prompt", "message_type"])
      .where("session_id", "=", session.id)
      .orderBy("timestamp", "desc")
      .limit(50)
      .execute();

    if (rows.length === 0) {
      continue;
    }

    const content = rows
      .slice()
      .reverse()
      .map((row) => `${row.message_type}: ${row.prompt}`)
      .join("\n");

    const prompt = `Summarize this conversation in 1-2 concise sentences. Focus on what was discussed and any outcomes.

${content.slice(0, 2000)}`;

    try {
      const summary = (await client.generate(prompt)).trim();
      if (!summary) {
        continue;
      }

      await db
        .updateTable("sessions")
        .set({
          summary,
          summary_updated_at: now,
        })
        .where("id", "=", session.id)
        .execute();

      log.summary.debug("Generated summary", { sessionId: session.id });

      if (session.user_id && session.user_id !== "default") {
        updatedUsers.add(session.user_id);
      }
    } catch (error) {
      log.summary.warn("Failed to summarize session", { sessionId: session.id, error: String(error) });
    }
  }

  await updateSummaryContext();

  for (const userId of updatedUsers) {
    try {
      await updateCoreMemoryFromSummary(userId);
    } catch (error) {
      log.summary.warn("Core memory update failed", { userId, error: String(error) });
    }
  }
}

async function updateSummaryContext(): Promise<void> {
  const db = await getDb();

  const prev = await db
    .selectFrom("summary_context")
    .select(["summary", "session_ids"])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  const prevSummary = prev?.summary ?? null;
  const prevSessionIds = new Set<number>((prev?.session_ids ?? []).map((id) => Number(id)));

  const sessions = await db
    .selectFrom("sessions")
    .select(["id", "summary"])
    .where("summary", "is not", null)
    .orderBy("summary_updated_at", "desc")
    .limit(20)
    .execute();

  const newSessions = sessions.filter((session) => !prevSessionIds.has(session.id));
  if (newSessions.length === 0) {
    return;
  }

  const sessionSummaries = newSessions
    .map((session) => session.summary)
    .filter(Boolean)
    .map((summary) => `- ${summary}`)
    .join("\n");

  const prompt = `Previous: ${prevSummary ?? "None"}

Recent:
${sessionSummaries}

Merge into 1-2 sentences. No headers, no preambles.`;

  try {
    const client = getSummaryClient();
    const newSummary = (await client.generate(prompt)).trim();
    if (!newSummary) {
      return;
    }

    const combinedIds = new Set<number>(prevSessionIds);
    for (const session of newSessions) {
      combinedIds.add(session.id);
    }

    await db
      .insertInto("summary_context")
      .values({
        summary: newSummary,
        session_ids: Array.from(combinedIds),
        created_at: nowDate(),
      })
      .execute();

    log.summary.debug("Updated summary context", { preview: newSummary.slice(0, 100) });
  } catch (error) {
    log.summary.warn("Failed to update summary context", { error: String(error) });
  }
}

export async function updateCoreMemoryFromSummary(userId: string): Promise<number> {
  if (!userId || userId === "default") {
    return 0;
  }

  const db = await getDb();
  const summaryRow = await db
    .selectFrom("sessions")
    .select(["summary", "summary_updated_at"])
    .where("user_id", "=", userId)
    .where("summary", "is not", null)
    .orderBy("summary_updated_at", "desc")
    .limit(1)
    .executeTakeFirst();

  const summary = summaryRow?.summary?.trim() ?? "";
  if (!summary) {
    return 0;
  }

  const block = await db
    .selectFrom("core_memory_blocks")
    .selectAll()
    .where("user_id", "=", userId)
    .where("session_id", "is", null)
    .where("block_type", "=", "task")
    .executeTakeFirst();

  const now = nowDate();
  const contentPrefix = "Recent summary: ";

  if (block) {
    if (block.content.includes(summary)) {
      return 0;
    }
    const current = block.content.trimEnd();
    const base = current ? `${current}\n` : "";
    const remaining = (block.char_limit ?? 8192) - base.length - contentPrefix.length;
    const trimmedSummary = summary.slice(0, Math.max(0, remaining));
    const nextContent = `${base}${contentPrefix}${trimmedSummary}`.slice(
      0,
      block.char_limit ?? 8192,
    );

    const nextVersion = (block.version ?? 1) + 1;
    await db
      .updateTable("core_memory_blocks")
      .set({
        content: nextContent,
        version: nextVersion,
        updated_at: now,
      })
      .where("id", "=", block.id)
      .execute();

    await db
      .insertInto("core_memory_versions")
      .values({
        block_id: block.id,
        version: nextVersion,
        content: nextContent,
        reason: "memory consolidation summary",
        created_at: now,
      })
      .execute();

    return 1;
  }

  const content = `${contentPrefix}${summary}`.slice(0, 8192);
  const inserted = await db
    .insertInto("core_memory_blocks")
    .values({
      user_id: userId,
      session_id: null,
      block_type: "task",
      content,
      char_limit: 8192,
      version: 1,
      created_at: now,
      updated_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await db
    .insertInto("core_memory_versions")
    .values({
      block_id: inserted.id,
      version: 1,
      content,
      reason: "memory consolidation summary",
      created_at: now,
    })
    .execute();

  return 1;
}
