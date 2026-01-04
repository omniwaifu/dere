import { parse } from "@iarna/toml";
import type { Hono } from "hono";
import { sql } from "kysely";
import { readFile } from "node:fs/promises";

import { getConfigPath, loadConfig } from "@dere/shared-config";

import { getDb } from "./db.js";
import { getAmbientMonitor } from "./ambient-monitor.js";

const DEFAULTS = {
  enabled: true,
  check_interval_minutes: 30,
  idle_threshold_minutes: 60,
  activity_lookback_hours: 6,
  escalation_enabled: true,
  escalation_lookback_hours: 12,
  min_notification_interval_minutes: 120,
  notification_method: "both",
  startup_delay_seconds: 0,
  fsm_enabled: true,
  fsm_idle_interval: [60, 120] as [number, number],
  fsm_monitoring_interval: [15, 30] as [number, number],
  fsm_engaged_interval: 5,
  fsm_cooldown_interval: [45, 90] as [number, number],
  fsm_escalating_interval: [30, 60] as [number, number],
  fsm_suppressed_interval: [90, 180] as [number, number],
  fsm_weight_activity: 0.3,
  fsm_weight_emotion: 0.25,
  fsm_weight_responsiveness: 0.2,
  fsm_weight_temporal: 0.15,
  fsm_weight_task: 0.1,
  exploring_enabled: true,
  exploring_min_idle_minutes: 30,
  exploring_interval_minutes: [5, 10] as [number, number],
  exploring_max_explorations_per_day: 20,
  exploring_max_daily_cost_usd: 0.5,
};

function nowIso(): string {
  return new Date().toISOString();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return null;
}

function toString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = toNumber(value);
  return parsed ?? fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  const parsed = toBoolean(value);
  return parsed ?? fallback;
}

function readNonEmptyString(value: unknown, fallback: string): string {
  const parsed = toString(value);
  if (parsed && parsed.trim().length > 0) {
    return parsed;
  }
  return fallback;
}

function readNumberPair(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const first = toNumber(value[0]);
    const second = toNumber(value[1]);
    if (first !== null && second !== null) {
      return [first, second];
    }
  }
  return fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadRawAmbientSection(): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(getConfigPath(), "utf-8");
    const parsed = parse(text);
    if (isPlainObject(parsed)) {
      const ambient = parsed.ambient;
      if (isPlainObject(ambient)) {
        return ambient;
      }
    }
  } catch {
    return {};
  }
  return {};
}

function extractJsonCandidate(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function parseAmbientOutput(text: string | null): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  const codeBlock = text.match(/```json\s*({[\s\S]*?})\s*```/i);
  if (codeBlock?.[1]) {
    try {
      const parsed = JSON.parse(codeBlock[1]);
      if (isPlainObject(parsed)) {
        return parsed;
      }
    } catch {
      // fallthrough
    }
  }

  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const candidate = extractJsonCandidate(text, i);
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      if (isPlainObject(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function previewMessage(message: string | null, limit = 160): string | null {
  if (!message) {
    return null;
  }
  if (message.length <= limit) {
    return message;
  }
  return `${message.slice(0, limit)}...`;
}

function resolveLimit(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function registerAmbientRoutes(app: Hono): void {
  app.get("/ambient/dashboard", async (c) => {
    const limitRuns = resolveLimit(c.req.query("limit_runs"), 8);
    const limitNotifications = resolveLimit(c.req.query("limit_notifications"), 8);

    const config = await loadConfig();
    const ambientConfig = config.ambient ?? {};
    const rawAmbient = await loadRawAmbientSection();
    const defaultPersonality = readNonEmptyString(config.default_personality, "tsun");
    const userId = readNonEmptyString(
      ambientConfig.user_id,
      readNonEmptyString(config.user_id, "default_user"),
    );

    const enabled = readBoolean(ambientConfig.enabled, DEFAULTS.enabled);
    const fsmEnabled = readBoolean(ambientConfig.fsm_enabled, DEFAULTS.fsm_enabled);
    const notificationMethod = readNonEmptyString(
      ambientConfig.notification_method,
      DEFAULTS.notification_method,
    );
    const personality = readNonEmptyString(ambientConfig.personality, defaultPersonality);

    const fsmIdleInterval = readNumberPair(
      ambientConfig.fsm_idle_interval,
      DEFAULTS.fsm_idle_interval,
    );
    const fsmMonitoringInterval = readNumberPair(
      ambientConfig.fsm_monitoring_interval,
      DEFAULTS.fsm_monitoring_interval,
    );
    const fsmCooldownInterval = readNumberPair(
      ambientConfig.fsm_cooldown_interval,
      DEFAULTS.fsm_cooldown_interval,
    );
    const fsmEscalatingInterval = readNumberPair(
      ambientConfig.fsm_escalating_interval,
      DEFAULTS.fsm_escalating_interval,
    );
    const fsmSuppressedInterval = readNumberPair(
      ambientConfig.fsm_suppressed_interval,
      DEFAULTS.fsm_suppressed_interval,
    );

    const exploringEnabled = readBoolean(rawAmbient.exploring_enabled, DEFAULTS.exploring_enabled);
    const exploringMinIdle = readNumber(
      rawAmbient.exploring_min_idle_minutes,
      DEFAULTS.exploring_min_idle_minutes,
    );
    const exploringInterval = readNumberPair(
      rawAmbient.exploring_interval_minutes,
      DEFAULTS.exploring_interval_minutes,
    );
    const exploringMaxPerDay = readNumber(
      rawAmbient.exploring_max_explorations_per_day,
      DEFAULTS.exploring_max_explorations_per_day,
    );
    const exploringMaxDailyCost = readNumber(
      rawAmbient.exploring_max_daily_cost_usd,
      DEFAULTS.exploring_max_daily_cost_usd,
    );

    const configSummary = {
      enabled,
      personality,
      notification_method: notificationMethod,
      check_interval_minutes: readNumber(
        ambientConfig.check_interval_minutes,
        DEFAULTS.check_interval_minutes,
      ),
      idle_threshold_minutes: readNumber(
        ambientConfig.idle_threshold_minutes,
        DEFAULTS.idle_threshold_minutes,
      ),
      min_notification_interval_minutes: readNumber(
        ambientConfig.min_notification_interval_minutes,
        DEFAULTS.min_notification_interval_minutes,
      ),
      activity_lookback_hours: readNumber(
        ambientConfig.activity_lookback_hours,
        DEFAULTS.activity_lookback_hours,
      ),
      escalation_enabled: readBoolean(
        ambientConfig.escalation_enabled,
        DEFAULTS.escalation_enabled,
      ),
      escalation_lookback_hours: readNumber(
        ambientConfig.escalation_lookback_hours,
        DEFAULTS.escalation_lookback_hours,
      ),
      startup_delay_seconds: readNumber(
        ambientConfig.startup_delay_seconds,
        DEFAULTS.startup_delay_seconds,
      ),
      fsm_enabled: fsmEnabled,
      fsm_intervals: {
        idle: fsmIdleInterval,
        monitoring: fsmMonitoringInterval,
        engaged: readNumber(ambientConfig.fsm_engaged_interval, DEFAULTS.fsm_engaged_interval),
        cooldown: fsmCooldownInterval,
        escalating: fsmEscalatingInterval,
        suppressed: fsmSuppressedInterval,
      },
      fsm_weights: {
        activity: readNumber(ambientConfig.fsm_weight_activity, DEFAULTS.fsm_weight_activity),
        emotion: readNumber(ambientConfig.fsm_weight_emotion, DEFAULTS.fsm_weight_emotion),
        responsiveness: readNumber(
          ambientConfig.fsm_weight_responsiveness,
          DEFAULTS.fsm_weight_responsiveness,
        ),
        temporal: readNumber(ambientConfig.fsm_weight_temporal, DEFAULTS.fsm_weight_temporal),
        task: readNumber(ambientConfig.fsm_weight_task, DEFAULTS.fsm_weight_task),
      },
      exploring_enabled: exploringEnabled,
      exploring_min_idle_minutes: exploringMinIdle,
      exploring_interval_minutes: exploringInterval,
      exploring_max_explorations_per_day: exploringMaxPerDay,
      exploring_max_daily_cost_usd: exploringMaxDailyCost,
    };

    const db = await getDb();
    const runRows = await db
      .selectFrom("mission_executions as me")
      .innerJoin("missions as m", "m.id", "me.mission_id")
      .select(({ ref }) => [
        ref("m.id").as("mission_id"),
        ref("m.name").as("mission_name"),
        ref("me.id").as("execution_id"),
        ref("me.status").as("status"),
        ref("me.started_at").as("started_at"),
        ref("me.completed_at").as("completed_at"),
        ref("me.output_text").as("output_text"),
        ref("me.execution_metadata").as("execution_metadata"),
        ref("me.created_at").as("created_at"),
      ])
      .where(sql<boolean>`m.name ILIKE ${"ambient-%"}`)
      .orderBy(sql`me.started_at desc nulls last`)
      .orderBy("me.created_at", "desc")
      .limit(limitRuns)
      .execute();

    let lastRunAt: string | null = null;
    const recentRuns = runRows.map((row) => {
      let decision: Record<string, unknown> | null = null;
      const metadata = row.execution_metadata;
      if (isPlainObject(metadata)) {
        const structured = metadata.structured_output;
        if (isPlainObject(structured)) {
          decision = structured;
        }
      }
      if (!decision) {
        decision = parseAmbientOutput(row.output_text);
      }

      const sendValue = decision?.send;
      const priorityValue = decision?.priority;
      const confidenceValue = decision?.confidence;
      const messageValue = decision?.message;

      const send = typeof sendValue === "boolean" ? sendValue : null;
      const priority = typeof priorityValue === "string" ? priorityValue : null;
      const confidence = toNumber(confidenceValue);
      const messagePreview = typeof messageValue === "string" ? previewMessage(messageValue) : null;

      const runTime = row.started_at ?? row.created_at ?? null;
      if (!lastRunAt && runTime) {
        lastRunAt = runTime.toISOString();
      }

      return {
        mission_id: row.mission_id,
        mission_name: row.mission_name,
        execution_id: row.execution_id,
        status: row.status,
        started_at: row.started_at ? row.started_at.toISOString() : null,
        completed_at: row.completed_at ? row.completed_at.toISOString() : null,
        send,
        priority,
        confidence: confidence ?? null,
        message_preview: messagePreview,
      };
    });

    const notificationRows = await db
      .selectFrom("ambient_notifications as n")
      .leftJoin("notification_context as nc", "nc.notification_id", "n.id")
      .select(({ ref }) => [
        ref("n.id").as("id"),
        ref("n.message").as("message"),
        ref("n.priority").as("priority"),
        ref("n.status").as("status"),
        ref("n.created_at").as("created_at"),
        ref("n.delivered_at").as("delivered_at"),
        ref("n.acknowledged").as("acknowledged"),
        ref("n.target_medium").as("target_medium"),
        ref("n.target_location").as("target_location"),
        ref("nc.trigger_type").as("trigger_type"),
        ref("nc.context_snapshot").as("context_snapshot"),
      ])
      .where("n.user_id", "=", userId)
      .orderBy("n.created_at", "desc")
      .limit(limitNotifications)
      .execute();

    let lastNotificationAt: string | null = null;
    const recentNotifications = notificationRows.map((row) => {
      if (!lastNotificationAt && row.created_at) {
        lastNotificationAt = row.created_at.toISOString();
      }
      return {
        notification_id: row.id,
        message: row.message,
        priority: row.priority,
        status: row.status,
        created_at: row.created_at ? row.created_at.toISOString() : null,
        delivered_at: row.delivered_at ? row.delivered_at.toISOString() : null,
        acknowledged: row.acknowledged,
        target_medium: row.target_medium,
        target_location: row.target_location,
        trigger_type: row.trigger_type ?? null,
        context_snapshot: row.context_snapshot ?? null,
      };
    });

    const monitorState = getAmbientMonitor()?.getState();
    const fsmState = monitorState?.fsm_state ?? (fsmEnabled ? "unknown" : "disabled");
    const isEnabled = monitorState?.is_enabled ?? enabled;

    return c.json({
      summary: {
        fsm_state: fsmState,
        is_enabled: isEnabled,
        last_run_at: lastRunAt,
        last_notification_at: lastNotificationAt,
      },
      config: configSummary,
      recent_runs: recentRuns,
      recent_notifications: recentNotifications,
      timestamp: nowIso(),
    });
  });
}
