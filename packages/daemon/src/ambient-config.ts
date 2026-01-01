import { parse } from "@iarna/toml";
import { readFile } from "node:fs/promises";

import { getConfigPath, loadConfig } from "@dere/shared-config";

export interface ExploringConfig {
  enabled: boolean;
  min_idle_minutes: number;
  exploration_interval_minutes: [number, number];
  max_explorations_per_day: number;
  max_daily_cost_usd: number;
  max_hours_between_explorations: number;
}

export interface AmbientConfig {
  enabled: boolean;
  check_interval_minutes: number;
  idle_threshold_minutes: number;
  activity_lookback_hours: number;
  embedding_search_limit: number;
  context_change_threshold: number;
  daemon_url: string;
  user_id: string;
  personality: string;
  notification_method: string;
  escalation_enabled: boolean;
  escalation_lookback_hours: number;
  min_notification_interval_minutes: number;
  startup_delay_seconds: number;
  fsm_enabled: boolean;
  fsm_idle_interval: [number, number];
  fsm_monitoring_interval: [number, number];
  fsm_engaged_interval: number;
  fsm_cooldown_interval: [number, number];
  fsm_escalating_interval: [number, number];
  fsm_suppressed_interval: [number, number];
  fsm_weight_activity: number;
  fsm_weight_emotion: number;
  fsm_weight_responsiveness: number;
  fsm_weight_temporal: number;
  fsm_weight_task: number;
  exploring: ExploringConfig;
}

const DEFAULTS = {
  enabled: true,
  check_interval_minutes: 30,
  idle_threshold_minutes: 60,
  activity_lookback_hours: 6,
  embedding_search_limit: 20,
  context_change_threshold: 0.7,
  daemon_url: "http://localhost:8787",
  user_id: "default_user",
  personality: "tsun",
  notification_method: "both",
  escalation_enabled: true,
  escalation_lookback_hours: 12,
  min_notification_interval_minutes: 120,
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
  exploring: {
    enabled: true,
    min_idle_minutes: 30,
    exploration_interval_minutes: [5, 10] as [number, number],
    max_explorations_per_day: 20,
    max_daily_cost_usd: 0.5,
    max_hours_between_explorations: 4.0,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return toNumber(value) ?? fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return toBoolean(value) ?? fallback;
}

function readString(value: unknown, fallback: string): string {
  const parsed = toString(value);
  if (parsed && parsed.trim().length > 0) {
    return parsed;
  }
  return fallback;
}

function readPair(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const first = toNumber(value[0]);
    const second = toNumber(value[1]);
    if (first !== null && second !== null) {
      return [first, second];
    }
  }
  return fallback;
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

export async function loadAmbientConfig(): Promise<AmbientConfig> {
  const config = await loadConfig();
  const ambient = (config.ambient ?? {}) as Record<string, unknown>;
  const rawAmbient = await loadRawAmbientSection();

  const userIdFallback = readString(config.user_id, DEFAULTS.user_id);
  const defaultPersonality = readString(config.default_personality, DEFAULTS.personality);

  const exploringEnabled = readBoolean(rawAmbient.exploring_enabled, DEFAULTS.exploring.enabled);

  const exploring: ExploringConfig = {
    enabled: exploringEnabled,
    min_idle_minutes: readNumber(
      rawAmbient.exploring_min_idle_minutes,
      DEFAULTS.exploring.min_idle_minutes,
    ),
    exploration_interval_minutes: readPair(
      rawAmbient.exploring_interval_minutes,
      DEFAULTS.exploring.exploration_interval_minutes,
    ),
    max_explorations_per_day: readNumber(
      rawAmbient.exploring_max_explorations_per_day,
      DEFAULTS.exploring.max_explorations_per_day,
    ),
    max_daily_cost_usd: readNumber(
      rawAmbient.exploring_max_daily_cost_usd,
      DEFAULTS.exploring.max_daily_cost_usd,
    ),
    max_hours_between_explorations: readNumber(
      rawAmbient.exploring_max_hours_between ?? rawAmbient.exploring_max_hours_between_explorations,
      DEFAULTS.exploring.max_hours_between_explorations,
    ),
  };

  return {
    enabled: readBoolean(ambient.enabled, DEFAULTS.enabled),
    check_interval_minutes: readNumber(
      ambient.check_interval_minutes,
      DEFAULTS.check_interval_minutes,
    ),
    idle_threshold_minutes: readNumber(
      ambient.idle_threshold_minutes,
      DEFAULTS.idle_threshold_minutes,
    ),
    activity_lookback_hours: readNumber(
      ambient.activity_lookback_hours,
      DEFAULTS.activity_lookback_hours,
    ),
    embedding_search_limit: readNumber(
      ambient.embedding_search_limit,
      DEFAULTS.embedding_search_limit,
    ),
    context_change_threshold: readNumber(
      ambient.context_change_threshold,
      DEFAULTS.context_change_threshold,
    ),
    daemon_url: readString(ambient.daemon_url, DEFAULTS.daemon_url),
    user_id: readString(ambient.user_id, userIdFallback),
    personality: readString(ambient.personality, defaultPersonality),
    notification_method: readString(ambient.notification_method, DEFAULTS.notification_method),
    escalation_enabled: readBoolean(ambient.escalation_enabled, DEFAULTS.escalation_enabled),
    escalation_lookback_hours: readNumber(
      ambient.escalation_lookback_hours,
      DEFAULTS.escalation_lookback_hours,
    ),
    min_notification_interval_minutes: readNumber(
      ambient.min_notification_interval_minutes,
      DEFAULTS.min_notification_interval_minutes,
    ),
    startup_delay_seconds: readNumber(
      ambient.startup_delay_seconds,
      DEFAULTS.startup_delay_seconds,
    ),
    fsm_enabled: readBoolean(ambient.fsm_enabled, DEFAULTS.fsm_enabled),
    fsm_idle_interval: readPair(ambient.fsm_idle_interval, DEFAULTS.fsm_idle_interval),
    fsm_monitoring_interval: readPair(
      ambient.fsm_monitoring_interval,
      DEFAULTS.fsm_monitoring_interval,
    ),
    fsm_engaged_interval: readNumber(ambient.fsm_engaged_interval, DEFAULTS.fsm_engaged_interval),
    fsm_cooldown_interval: readPair(ambient.fsm_cooldown_interval, DEFAULTS.fsm_cooldown_interval),
    fsm_escalating_interval: readPair(
      ambient.fsm_escalating_interval,
      DEFAULTS.fsm_escalating_interval,
    ),
    fsm_suppressed_interval: readPair(
      ambient.fsm_suppressed_interval,
      DEFAULTS.fsm_suppressed_interval,
    ),
    fsm_weight_activity: readNumber(ambient.fsm_weight_activity, DEFAULTS.fsm_weight_activity),
    fsm_weight_emotion: readNumber(ambient.fsm_weight_emotion, DEFAULTS.fsm_weight_emotion),
    fsm_weight_responsiveness: readNumber(
      ambient.fsm_weight_responsiveness,
      DEFAULTS.fsm_weight_responsiveness,
    ),
    fsm_weight_temporal: readNumber(ambient.fsm_weight_temporal, DEFAULTS.fsm_weight_temporal),
    fsm_weight_task: readNumber(ambient.fsm_weight_task, DEFAULTS.fsm_weight_task),
    exploring,
  };
}
