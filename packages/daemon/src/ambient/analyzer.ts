import { buildTaskContext, type TaskwarriorTask } from "./task-context.js";
import type { AmbientConfig } from "./config.js";
import { log } from "../logger.js";

type JsonRecord = Record<string, unknown>;

const CURRENT_ACTIVITY_UNSET = Symbol("current_activity");

async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000,
): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const status = response.status;
    if (response.ok) {
      const data = (await response.json()) as T;
      return { status, data };
    }
    return { status, data: null };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

function parseEntityTokens(text: string | null): Set<string> {
  if (!text) {
    return new Set();
  }
  return new Set(
    text
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function extractTaskIds(text: string | null): Set<string> {
  if (!text) {
    return new Set();
  }
  const matches = text.match(/#\w+/g) ?? [];
  return new Set(matches);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1.0;
  }
  if (a.size === 0 || b.size === 0) {
    return 0.0;
  }
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) {
      intersection += 1;
    }
  }
  return intersection / (a.size + b.size - intersection);
}

function contextSimilarity(prev: JsonRecord, current: JsonRecord): number {
  let activityScore = 0.0;
  const prevApp = prev.activity_app as string | undefined;
  const currApp = current.activity_app as string | undefined;
  const prevTitle = prev.activity_title as string | undefined;
  const currTitle = current.activity_title as string | undefined;

  if (prevApp && currApp && prevApp === currApp) {
    activityScore = 0.5;
    if (prevTitle && currTitle && prevTitle === currTitle) {
      activityScore = 1.0;
    }
  }

  const entityScore = jaccard(
    (prev.entities as Set<string>) ?? new Set(),
    (current.entities as Set<string>) ?? new Set(),
  );
  const taskScore = jaccard(
    (prev.tasks as Set<string>) ?? new Set(),
    (current.tasks as Set<string>) ?? new Set(),
  );

  return 0.5 * activityScore + 0.3 * entityScore + 0.2 * taskScore;
}

export class ContextAnalyzer {
  private config: AmbientConfig;
  private daemonUrl: string;
  private lastContext: JsonRecord | null = null;

  constructor(config: AmbientConfig) {
    this.config = config;
    this.daemonUrl = config.daemon_url;
  }

  private buildContextFingerprint(
    currentActivity: JsonRecord,
    entityContext: string | null,
    taskContext: string | null,
  ): JsonRecord {
    return {
      activity_app: currentActivity.app,
      activity_title: currentActivity.title,
      entities: parseEntityTokens(entityContext),
      tasks: extractTaskIds(taskContext),
    };
  }

  private contextChanged(current: JsonRecord): boolean {
    const threshold = this.config.context_change_threshold;
    if (!threshold || threshold <= 0) {
      return true;
    }
    if (!this.lastContext) {
      return true;
    }
    const similarity = contextSimilarity(this.lastContext, current);
    log.ambient.debug("Context similarity check", {
      similarity: similarity.toFixed(2),
      threshold: threshold.toFixed(2),
    });
    return similarity < threshold;
  }

  private hasOverdueTasks(taskContext: string | null): boolean {
    if (!taskContext) {
      return false;
    }
    return taskContext.toLowerCase().includes("overdue:");
  }

  async isUserAfk(lookbackMinutes: number): Promise<boolean> {
    const snapshot = await this.getActivitySnapshot(lookbackMinutes, 5);
    if (!snapshot) {
      return false;
    }
    return snapshot.presence === "away";
  }

  async getActivitySnapshot(lookbackMinutes: number, topN = 5): Promise<JsonRecord | null> {
    const url = new URL("/activity/state", this.daemonUrl);
    url.searchParams.set("minutes", String(lookbackMinutes));
    url.searchParams.set("top", String(topN));
    const { data } = await fetchJson<JsonRecord>(url.toString(), {}, 5000);
    if (!data) {
      return null;
    }
    if (data.enabled === false || data.status === "empty") {
      return null;
    }
    return data;
  }

  async getCurrentActivity(lookbackMinutes: number): Promise<JsonRecord | null> {
    const snapshot = await this.getActivitySnapshot(lookbackMinutes, 5);
    if (!snapshot) {
      return null;
    }
    const current = snapshot.current_window as JsonRecord | undefined;
    if (current) {
      return {
        app: current.app,
        title: current.title,
        duration: current.duration_seconds ?? 0,
        last_seen: current.last_seen,
      };
    }
    const currentMedia = snapshot.current_media as JsonRecord | undefined;
    if (currentMedia) {
      const artist = String(currentMedia.artist ?? "");
      const title = String(currentMedia.title ?? "");
      const label = artist ? `${artist} - ${title}` : title;
      return {
        app: `${currentMedia.player ?? "media"} (media)`,
        title: label,
        duration: currentMedia.duration_seconds ?? 0,
        last_seen: currentMedia.last_seen,
      };
    }
    return null;
  }

  async getLastInteractionTime(): Promise<number | null> {
    const url = new URL("/sessions/last_interaction", this.daemonUrl);
    url.searchParams.set("user_id", this.config.user_id);
    const { data } = await fetchJson<JsonRecord>(url.toString(), {}, 5000);
    if (!data) {
      return null;
    }
    const value = data.last_interaction_time;
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async getRecentUnacknowledgedNotifications(): Promise<JsonRecord[]> {
    if (!this.config.escalation_enabled) {
      return [];
    }

    const lookbackMs = this.config.escalation_lookback_hours * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs).toISOString();
    const { status, data } = await fetchJson<JsonRecord>(
      new URL("/notifications/recent_unacknowledged", this.daemonUrl).toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: this.config.user_id, since }),
      },
      10_000,
    );

    if (status === 200 && data && Array.isArray(data.notifications)) {
      return data.notifications as JsonRecord[];
    }
    return [];
  }

  async getPreviousContextSummary(): Promise<string | null> {
    const lookbackMinutes = 30;
    const since = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
    const payload = {
      query: "conversation context discussion",
      limit: this.config.embedding_search_limit,
      since,
      rerank_method: "mmr",
      diversity: 0.7,
      entity_values: [],
      user_id: this.config.user_id,
    };

    const { status, data } = await fetchJson<JsonRecord>(
      new URL("/search/hybrid", this.daemonUrl).toString(),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      10_000,
    );

    if (status === 200 && data && Array.isArray(data.results)) {
      const results = data.results as JsonRecord[];
      if (results.length > 0) {
        const summaries = results.slice(0, 3).map((r) => String(r.prompt ?? "").slice(0, 100));
        return summaries.join(" | ");
      }
    }
    return null;
  }

  async getUserEmotionSummary(): Promise<string | null> {
    const { status, data } = await fetchJson<JsonRecord>(
      new URL("/emotion/summary", this.daemonUrl).toString(),
      {},
      5000,
    );
    if (status === 200 && data) {
      const summary = data.summary;
      return typeof summary === "string" ? summary : null;
    }
    return null;
  }

  async getEntityContext(limit = 5): Promise<string | null> {
    const url = new URL("/kg/entities", this.daemonUrl);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort_by", "last_mentioned");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("user_id", this.config.user_id);

    const { status, data } = await fetchJson<JsonRecord>(url.toString(), {}, 10_000);
    if (status === 200 && data && Array.isArray(data.entities)) {
      const names = (data.entities as JsonRecord[])
        .map((entity) => String(entity.name ?? "").trim())
        .filter(Boolean);
      if (names.length > 0) {
        return names.slice(0, limit).join(", ");
      }
    }
    return null;
  }

  async getLastDmMessage(): Promise<JsonRecord | null> {
    const url = new URL(`/conversations/last_dm/${this.config.user_id}`, this.daemonUrl);
    const { status, data } = await fetchJson<JsonRecord>(url.toString(), {}, 5000);
    if (status === 200 && data && data.message) {
      return data;
    }
    return null;
  }

  async getTaskContext(limit = 5): Promise<string | null> {
    const url = new URL("/taskwarrior/tasks", this.daemonUrl);
    url.searchParams.set("status", "pending");
    url.searchParams.set("include_completed", "false");
    const { status, data } = await fetchJson<JsonRecord>(url.toString(), {}, 5000);
    if (status === 200 && data && Array.isArray(data.tasks)) {
      const tasks = data.tasks as TaskwarriorTask[];
      return buildTaskContext(tasks, limit, true, true);
    }
    return null;
  }

  async shouldEngage(options: {
    activityLookbackMinutes?: number;
    currentActivity?: JsonRecord | null | typeof CURRENT_ACTIVITY_UNSET;
  }): Promise<[boolean, JsonRecord | null]> {
    try {
      const lookbackMinutes = options.activityLookbackMinutes ?? 10;
      const isAfk = await this.isUserAfk(lookbackMinutes);
      if (isAfk) {
        log.ambient.debug("User AFK; skipping engagement");
        return [false, null];
      }

      let currentActivity =
        options.currentActivity === CURRENT_ACTIVITY_UNSET
          ? await this.getCurrentActivity(lookbackMinutes)
          : options.currentActivity;

      if (!currentActivity) {
        log.ambient.debug("No current activity detected; skipping");
        return [false, null];
      }

      const durationSeconds = Number(currentActivity.duration ?? 0);
      const durationHours = durationSeconds / 3600;
      log.ambient.debug("Current activity", {
        app: currentActivity.app ?? "unknown",
        durationHours: durationHours.toFixed(1),
      });

      const lastInteraction = await this.getLastInteractionTime();
      let minutesIdle: number | null = null;
      if (lastInteraction) {
        minutesIdle = (Date.now() / 1000 - lastInteraction) / 60;
        if (minutesIdle < this.config.idle_threshold_minutes) {
          log.ambient.debug("User recently active", {
            idleMinutes: Math.round(minutesIdle),
            thresholdMinutes: this.config.idle_threshold_minutes,
          });
          return [false, null];
        }
      }

      const previousContext = await this.getPreviousContextSummary();
      const emotionSummary = await this.getUserEmotionSummary();
      const entityContext = await this.getEntityContext(5);
      const previousNotifications = await this.getRecentUnacknowledgedNotifications();
      const taskContext = await this.getTaskContext(5);

      const fingerprint = this.buildContextFingerprint(currentActivity, entityContext, taskContext);

      if (!this.contextChanged(fingerprint)) {
        if (previousNotifications.length === 0 && !this.hasOverdueTasks(taskContext)) {
          this.lastContext = fingerprint;
          log.ambient.debug("Context stable; skipping engagement");
          return [false, null];
        }
      }

      this.lastContext = fingerprint;
      const contextSnapshot: JsonRecord = {
        activity: currentActivity,
        minutes_idle: minutesIdle,
        previous_context: previousContext,
        emotion_summary: emotionSummary,
        entity_context: entityContext,
        task_context: taskContext,
        previous_notifications: previousNotifications,
      };

      return [true, contextSnapshot];
    } catch (error) {
      log.ambient.error("Engagement analysis failed", { error: String(error) });
      return [false, null];
    }
  }
}
