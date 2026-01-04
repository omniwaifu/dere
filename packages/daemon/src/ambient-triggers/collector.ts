import { sql, type Kysely } from "kysely";

import type { Database } from "../db-types.js";
import { detectCorrection } from "./corrections.js";
import { detectEmotionalPeak } from "./emotions.js";
import { detectUnfamiliarEntities, type EntityNodeLike } from "./entities.js";
import { detectKnowledgeGap } from "./knowledge-gap.js";
import { computeCuriosityPriority } from "./priority.js";
import type { CuriositySignal } from "./types.js";
import { log } from "../logger.js";

const STATUS = {
  BACKLOG: "backlog",
  READY: "ready",
  BLOCKED: "blocked",
  DONE: "done",
  CANCELLED: "cancelled",
  IN_PROGRESS: "in_progress",
} as const;

type DbTask = {
  id: number;
  title: string;
  status: string;
  priority: number | null;
  created_at: Date | null;
  updated_at: Date | null;
  extra: Record<string, unknown> | null;
};

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeTask(task: {
  id: number;
  title: string;
  status: string;
  priority: number | null;
  created_at: Date | null;
  updated_at: Date | null;
  extra: unknown;
}): DbTask {
  return { ...task, extra: toJsonRecord(task.extra) };
}

export interface ProcessCuriosityOptions {
  db: Kysely<Database>;
  prompt: string;
  sessionId: number;
  conversationId: number;
  userId: string | null;
  workingDir: string;
  personality: string | null;
  speakerName: string | null;
  isCommand: boolean;
  messageType: string;
  kgNodes: EntityNodeLike[] | null;
}

export async function processCuriosityTriggers(options: ProcessCuriosityOptions): Promise<number> {
  const {
    db,
    prompt,
    sessionId,
    conversationId,
    userId,
    workingDir,
    personality,
    speakerName,
    isCommand,
    messageType,
    kgNodes,
  } = options;

  const text = prompt.trim();
  if (!text || text.length < 6) {
    return 0;
  }
  if (messageType === "user" && isCommand) {
    return 0;
  }

  const signals: CuriositySignal[] = [];
  if (messageType === "user") {
    const previousAssistant = await getPreviousMessage(db, {
      sessionId,
      conversationId,
      role: "assistant",
    });

    detectUnfamiliarEntities({
      prompt: text,
      nodes: kgNodes,
      speakerName,
      personality,
    }).forEach((signal) => {
      signals.push({
        curiosity_type: "unfamiliar_entity",
        topic: signal.topic,
        source_context: signal.sourceContext,
        trigger_reason: signal.triggerReason,
        user_interest: 0.4,
        knowledge_gap: 0,
        metadata: {},
      });
    });

    const correction = detectCorrection(text, previousAssistant);
    if (correction) {
      signals.push({
        curiosity_type: "correction",
        topic: correction.topic,
        source_context: correction.sourceContext,
        trigger_reason: correction.triggerReason,
        user_interest: 0.7,
        knowledge_gap: 0,
        metadata: {},
      });
    }

    const emotional = detectEmotionalPeak(text);
    if (emotional) {
      signals.push({
        curiosity_type: "emotional_peak",
        topic: emotional.topic,
        source_context: emotional.sourceContext,
        trigger_reason: emotional.triggerReason,
        user_interest: emotional.userInterest,
        knowledge_gap: 0,
        metadata: { intensity: emotional.intensity },
      });
    }
  } else if (messageType === "assistant") {
    const previousUser = await getPreviousMessage(db, {
      sessionId,
      conversationId,
      role: "user",
    });
    const knowledgeGap = detectKnowledgeGap(text, previousUser);
    if (knowledgeGap) {
      signals.push({
        curiosity_type: "knowledge_gap",
        topic: knowledgeGap.topic,
        source_context: knowledgeGap.sourceContext,
        trigger_reason: knowledgeGap.triggerReason,
        user_interest: 0.4,
        knowledge_gap: 0.8,
        metadata: {},
      });
    }
  }

  if (signals.length === 0) {
    return 0;
  }

  return await db.transaction().execute(async (trx) => {
    await enforceBacklogLimits(trx, userId);

    let created = 0;
    const seenTopics = new Set<string>();
    for (const signal of signals) {
      const normalized = normalizeTopic(signal.topic);
      if (seenTopics.has(normalized)) {
        continue;
      }
      seenTopics.add(normalized);

      created += await upsertCuriosityTask(trx, signal, {
        workingDir,
        userId,
        conversationId,
      });
    }

    if (created > 0) {
      log.ambient.info("Curiosity triggers stored", { created, total: signals.length });
    }

    return created;
  });
}

async function getPreviousMessage(
  db: Kysely<Database>,
  options: { sessionId: number; conversationId: number; role: string },
): Promise<string | null> {
  const row = await db
    .selectFrom("conversations")
    .select(["prompt"])
    .where("session_id", "=", options.sessionId)
    .where("message_type", "=", options.role)
    .where("id", "<", options.conversationId)
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  return row?.prompt ?? null;
}

async function upsertCuriosityTask(
  db: Kysely<Database>,
  signal: CuriositySignal,
  options: { workingDir: string; userId: string | null; conversationId: number },
): Promise<number> {
  const normalizedTopic = normalizeTopic(signal.topic);
  const existingRaw = await db
    .selectFrom("project_tasks")
    .select(["id", "title", "status", "priority", "created_at", "updated_at", "extra"])
    .where("task_type", "=", "curiosity")
    .where(sql<string>`lower(title)`, "=", normalizedTopic)
    .limit(1)
    .executeTakeFirst();
  const existing = existingRaw ? normalizeTask(existingRaw) : null;

  const now = new Date();

  if (existing && (existing.status === STATUS.DONE || existing.status === STATUS.CANCELLED)) {
    return 0;
  }

  if (existing) {
    const extra = normalizeExtra(existing.extra);
    const triggerCount = Number(extra.trigger_count ?? 0) + 1;
    const explorationCount = Number(extra.exploration_count ?? 0);
    const recency = recencyFactor(existing, signal);
    const { score, factors } = computeCuriosityPriority({
      signal,
      explorationCount,
      recency,
    });
    const repeatBonus = Math.min(0.2, 0.05 * triggerCount);
    const priority = Math.min(1.0, score + repeatBonus);
    factors.repeat_bonus = repeatBonus;

    const updatedExtra = mergeExtra(extra, signal, {
      priorityFactors: factors,
      triggerCount,
      conversationId: options.conversationId,
      userId: options.userId,
      now,
    });

    await db
      .updateTable("project_tasks")
      .set({
        priority: Math.max(existing.priority ?? 0, Math.floor(priority * 100)),
        updated_at: now,
        extra: updatedExtra,
      })
      .where("id", "=", existing.id)
      .execute();

    log.ambient.info("Updated curiosity task", {
      taskId: existing.id,
      type: signal.curiosity_type,
      priority: Math.floor(priority * 100),
      triggers: triggerCount,
    });
    return 0;
  }

  const { score, factors } = computeCuriosityPriority({ signal });
  const extra = mergeExtra({}, signal, {
    priorityFactors: factors,
    triggerCount: 1,
    conversationId: options.conversationId,
    userId: options.userId,
    now,
  });

  await db
    .insertInto("project_tasks")
    .values({
      working_dir: options.workingDir,
      title: signal.topic,
      description: `Curiosity trigger: ${signal.trigger_reason}`,
      task_type: "curiosity",
      priority: Math.floor(score * 100),
      status: STATUS.READY,
      extra,
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
      acceptance_criteria: null,
      context_summary: null,
      scope_paths: null,
      required_tools: null,
      tags: null,
      estimated_effort: null,
      claimed_by_session_id: null,
      claimed_by_agent_id: null,
      claimed_at: null,
      attempt_count: 0,
      blocked_by: null,
      related_task_ids: null,
      created_by_session_id: null,
      created_by_agent_id: null,
      discovered_from_task_id: null,
      discovery_reason: null,
      outcome: null,
      completion_notes: null,
      files_changed: null,
      follow_up_task_ids: null,
      last_error: null,
    })
    .execute();

  log.ambient.info("Created curiosity task", {
    type: signal.curiosity_type,
    topic: signal.topic,
    priority: Math.floor(score * 100),
  });

  return 1;
}

async function enforceBacklogLimits(db: Kysely<Database>, userId: string | null): Promise<void> {
  const maxPending = 100;
  const maxPerType = 25;
  const pruneThreshold = 0.15;
  const pendingStatuses = [STATUS.BACKLOG, STATUS.READY, STATUS.BLOCKED];

  let query = db
    .selectFrom("project_tasks")
    .select(["id", "title", "status", "priority", "created_at", "updated_at", "extra"])
    .where("task_type", "=", "curiosity")
    .where("status", "in", pendingStatuses);

  if (userId) {
    query = query.where(sql<boolean>`extra->>'user_id' = ${userId}`);
  }

  const tasks = (await query.execute()).map(normalizeTask);
  if (tasks.length === 0) {
    return;
  }

  const now = new Date();
  const toCancel = new Set<number>();

  for (const task of tasks) {
    if (shouldPruneTask(task, now, pruneThreshold)) {
      toCancel.add(task.id);
    }
  }

  let remaining = tasks.filter((task) => !toCancel.has(task.id));
  if (remaining.length > maxPending) {
    const overflow = remaining.length - maxPending;
    const lowest = lowestPriority(remaining).slice(0, overflow);
    for (const task of lowest) {
      toCancel.add(task.id);
      remaining = remaining.filter((item) => item.id !== task.id);
    }
  }

  const byType = new Map<string, DbTask[]>();
  for (const task of remaining) {
    const curiosityType = taskCuriosityType(task);
    const bucket = byType.get(curiosityType) ?? [];
    bucket.push(task);
    byType.set(curiosityType, bucket);
  }

  for (const bucket of byType.values()) {
    if (bucket.length <= maxPerType) {
      continue;
    }
    const overflow = bucket.length - maxPerType;
    for (const task of lowestPriority(bucket).slice(0, overflow)) {
      toCancel.add(task.id);
    }
  }

  if (toCancel.size === 0) {
    return;
  }

  for (const task of tasks) {
    if (!toCancel.has(task.id)) {
      continue;
    }
    const extra = normalizeExtra(task.extra);
    extra.pruned_at = now.toISOString();
    if (!extra.pruned_reason) {
      extra.pruned_reason = "backlog_limits";
    }
    await db
      .updateTable("project_tasks")
      .set({
        status: STATUS.CANCELLED,
        updated_at: now,
        last_error: "pruned by backlog limits",
        extra,
      })
      .where("id", "=", task.id)
      .execute();
  }
}

function shouldPruneTask(task: DbTask, now: Date, pruneThreshold: number): boolean {
  const curiosityType = taskCuriosityType(task);
  const ttlDays = curiosityType === "correction" ? 7 : 14;
  const cutoff = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000);

  const lastTriggered = parseIsoDate(task.extra?.last_triggered_at);
  const effectiveTime = lastTriggered ?? task.created_at;
  if (effectiveTime && effectiveTime < cutoff) {
    return true;
  }

  const priority = (task.priority ?? 0) / 100;
  return priority < pruneThreshold;
}

function lowestPriority(tasks: DbTask[]): DbTask[] {
  return [...tasks].sort((a, b) => {
    const ap = a.priority ?? 0;
    const bp = b.priority ?? 0;
    if (ap !== bp) {
      return ap - bp;
    }
    const aCreated = a.created_at?.getTime() ?? 0;
    const bCreated = b.created_at?.getTime() ?? 0;
    return aCreated - bCreated;
  });
}

function taskCuriosityType(task: DbTask): string {
  return String(task.extra?.curiosity_type ?? "unknown");
}

function recencyFactor(task: DbTask, signal: CuriositySignal): number {
  const ttlDays = signal.curiosity_type === "correction" ? 7 : 14;
  const lastTriggered = parseIsoDate(task.extra?.last_triggered_at);
  const effectiveTime = lastTriggered ?? task.created_at;
  if (!effectiveTime) {
    return 1.0;
  }
  const ageDays = Math.max(0, (Date.now() - effectiveTime.getTime()) / 86400000);
  return Math.max(0, 1.0 - ageDays / ttlDays);
}

function parseIsoDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mergeExtra(
  base: Record<string, unknown>,
  signal: CuriositySignal,
  options: {
    priorityFactors: Record<string, number>;
    triggerCount: number;
    conversationId: number;
    userId: string | null;
    now: Date;
  },
): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...base };
  extra.curiosity_type = signal.curiosity_type;
  extra.source_context = signal.source_context;
  extra.trigger_reason = signal.trigger_reason;
  extra.priority_factors = options.priorityFactors;
  extra.trigger_count = options.triggerCount;
  extra.last_triggered_at = options.now.toISOString();
  extra.user_id = options.userId;
  extra.conversation_id = options.conversationId;

  if (extra.findings === undefined) {
    extra.findings = [];
  }
  if (extra.exploration_count === undefined) {
    extra.exploration_count = 0;
  }
  if (extra.last_explored_at === undefined) {
    extra.last_explored_at = null;
  }
  if (extra.satisfaction_level === undefined) {
    extra.satisfaction_level = 0;
  }

  return extra;
}

function normalizeExtra(extra: Record<string, unknown> | null): Record<string, unknown> {
  return extra ? { ...extra } : {};
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}
