import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  AmbientMissionDecisionSchema,
} from "@dere/shared-llm";

import { loadAmbientConfig, type AmbientConfig } from "./ambient-config.js";
import { ContextAnalyzer } from "./ambient-analyzer.js";
import { AmbientExplorer } from "./ambient-explorer.js";
import { AmbientFSM } from "./ambient-fsm.js";
import { getDb } from "./db.js";

type JsonRecord = Record<string, unknown>;

function nowDate(): Date {
  return new Date();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickBestChannel(
  channels: Array<Record<string, unknown> | string>,
): Record<string, unknown> | string | null {
  if (channels.length === 0) {
    return null;
  }
  const dictChannels = channels.filter((ch) => typeof ch === "object" && ch !== null) as Record<
    string,
    unknown
  >[];
  const dmChannels = dictChannels.filter((ch) => {
    const type = String(ch.type ?? "").toLowerCase();
    return ["dm", "private", "direct_message"].includes(type);
  });
  if (dmChannels.length > 0) {
    return dmChannels[0] ?? null;
  }
  const generalChannels = dictChannels.filter((ch) => {
    const name = String(ch.name ?? "").toLowerCase();
    return ["general", "main", "chat"].some((keyword) => name.includes(keyword));
  });
  if (generalChannels.length > 0) {
    return generalChannels[0] ?? null;
  }
  return channels[0] ?? null;
}

class AmbientMonitor {
  private config: AmbientConfig;
  private analyzer: ContextAnalyzer;
  private fsm: AmbientFSM | null;
  private explorer: AmbientExplorer | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  private lastCheckAt: Date | null = null;
  private activityStreakKey: [string, string] | null = null;
  private activityStreakSeconds = 0;
  private activityStreakUpdatedAt: Date | null = null;
  private lastExplorationAt: Date | null = null;
  private explorationDay: string | null = null;
  private explorationsToday = 0;

  constructor(config: AmbientConfig) {
    this.config = config;
    this.analyzer = new ContextAnalyzer(config);

    if (config.fsm_enabled) {
      this.fsm = new AmbientFSM(
        {
          idle: config.fsm_idle_interval,
          monitoring: config.fsm_monitoring_interval,
          engaged: config.fsm_engaged_interval,
          cooldown: config.fsm_cooldown_interval,
          escalating: config.fsm_escalating_interval,
          suppressed: config.fsm_suppressed_interval,
          exploring: config.exploring.exploration_interval_minutes,
        },
        {
          activity: config.fsm_weight_activity,
          emotion: config.fsm_weight_emotion,
          responsiveness: config.fsm_weight_responsiveness,
          temporal: config.fsm_weight_temporal,
          task: config.fsm_weight_task,
          bond: 0.15,
        },
      );
      console.log("[ambient] FSM initialized");
    } else {
      this.fsm = null;
      console.log("[ambient] FSM disabled, using fixed intervals");
    }

    if (config.exploring.enabled) {
      this.explorer = new AmbientExplorer(config);
      console.log("[ambient] exploration initialized");
    }
  }

  getState(): { fsm_state: string; is_enabled: boolean } {
    return {
      fsm_state: this.fsm ? this.fsm.state : "disabled",
      is_enabled: this.running,
    };
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log("[ambient] monitoring disabled in config");
      return;
    }
    if (this.running) {
      console.log("[ambient] monitor already running");
      return;
    }
    this.running = true;
    this.loopPromise = this.monitorLoop();
    console.log(
      `[ambient] monitor started (interval ${this.config.check_interval_minutes}m, idle threshold ${this.config.idle_threshold_minutes}m)`,
    );
  }

  async shutdown(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
    }
  }

  private async monitorLoop(): Promise<void> {
    if (this.config.startup_delay_seconds > 0) {
      console.log(`[ambient] startup delay ${this.config.startup_delay_seconds}s`);
      await sleep(this.config.startup_delay_seconds * 1000);
    }

    while (this.running) {
      try {
        await this.checkAndEngage();
      } catch (error) {
        console.log(`[ambient] monitor loop error: ${String(error)}`);
      }

      const intervalSeconds = this.fsm
        ? this.fsm.calculateNextIntervalSeconds()
        : this.config.check_interval_minutes * 60;

      console.log(`[ambient] next check in ${(intervalSeconds / 60).toFixed(1)}m`);
      await sleep(intervalSeconds * 1000);
    }
  }

  private computeActivityLookbackMinutes(now: Date): number {
    const maxLookback = Math.max(10, this.config.activity_lookback_hours * 60);
    const minLookback = 10;
    const deltaMinutes = this.lastCheckAt
      ? Math.floor((now.getTime() - this.lastCheckAt.getTime()) / 60000)
      : this.config.check_interval_minutes;
    return Math.max(minLookback, Math.min(maxLookback, deltaMinutes));
  }

  private updateActivityStreak(activity: JsonRecord | null, now: Date): JsonRecord | null {
    if (!activity) {
      this.activityStreakKey = null;
      this.activityStreakSeconds = 0;
      this.activityStreakUpdatedAt = now;
      return null;
    }

    const app = String(activity.app ?? "").trim();
    const title = String(activity.title ?? "").trim();
    if (!app && !title) {
      this.activityStreakKey = null;
      this.activityStreakSeconds = 0;
      this.activityStreakUpdatedAt = now;
      return activity;
    }

    const key: [string, string] = [app, title];
    if (
      this.activityStreakKey &&
      this.activityStreakKey[0] === key[0] &&
      this.activityStreakKey[1] === key[1]
    ) {
      if (this.activityStreakUpdatedAt) {
        const deltaSeconds = (now.getTime() - this.activityStreakUpdatedAt.getTime()) / 1000;
        if (deltaSeconds > 0) {
          this.activityStreakSeconds += deltaSeconds;
        }
      }
    } else {
      this.activityStreakKey = key;
      this.activityStreakSeconds = Number(activity.duration ?? 0);
    }

    this.activityStreakUpdatedAt = now;

    const streakSeconds = Math.floor(this.activityStreakSeconds);
    return {
      ...activity,
      duration_window_seconds: activity.duration,
      duration: streakSeconds,
      streak_seconds: streakSeconds,
      streak_minutes: Math.floor(streakSeconds / 60),
    };
  }

  private async checkAndEngage(): Promise<void> {
    const now = nowDate();
    const lookbackMinutes = this.computeActivityLookbackMinutes(now);
    let currentActivity = await this.analyzer.getCurrentActivity(lookbackMinutes);
    currentActivity = this.updateActivityStreak(currentActivity, now);
    this.lastCheckAt = now;

    if (this.fsm) {
      await this.evaluateFsmState();
    }

    if (
      await this.maybeRunExploration({
        now,
        lookbackMinutes,
        currentActivity,
      })
    ) {
      return;
    }

    if (this.fsm && this.fsm.lastNotificationTime !== null) {
      const elapsedSeconds = Date.now() / 1000 - this.fsm.lastNotificationTime;
      const minIntervalSeconds = this.config.min_notification_interval_minutes * 60;
      if (elapsedSeconds < minIntervalSeconds) {
        const remaining = (minIntervalSeconds - elapsedSeconds) / 60;
        console.log(`[ambient] minimum interval not elapsed (${remaining.toFixed(0)}m remaining)`);
        return;
      }
    }

    const [shouldEngage, contextSnapshot] = await this.analyzer.shouldEngage({
      activityLookbackMinutes: lookbackMinutes,
      currentActivity,
    });

    if (!shouldEngage || !contextSnapshot) {
      return;
    }

    const missionResult = await this.runAmbientMission(contextSnapshot);
    if (!missionResult) {
      console.log("[ambient] no actionable ambient mission output");
      return;
    }

    await this.deliverNotification(missionResult, contextSnapshot);
    if (this.fsm) {
      this.fsm.transitionTo("engaged", "notification sent");
      this.fsm.lastNotificationTime = Date.now() / 1000;
    }
  }

  private async maybeRunExploration(options: {
    now: Date;
    lookbackMinutes: number;
    currentActivity: JsonRecord | null;
  }): Promise<boolean> {
    if (!this.explorer || !this.config.exploring.enabled) {
      return false;
    }

    if (this.fsm && (this.fsm.state === "engaged" || this.fsm.state === "escalating")) {
      return false;
    }

    const dayKey = options.now.toISOString().slice(0, 10);
    if (this.explorationDay !== dayKey) {
      this.explorationDay = dayKey;
      this.explorationsToday = 0;
    }

    if (this.explorationsToday >= this.config.exploring.max_explorations_per_day) {
      if (this.fsm && this.fsm.state === "exploring") {
        this.fsm.transitionTo("idle", "daily exploration limit reached");
      }
      return false;
    }

    const hasPending = await this.explorer.hasPendingCuriosities();
    if (!hasPending) {
      if (this.fsm && this.fsm.state === "exploring") {
        this.fsm.transitionTo("idle", "no curiosity backlog");
      }
      return false;
    }

    const maxHoursBetween = this.config.exploring.max_hours_between_explorations;
    let forceExploration = false;
    if (maxHoursBetween > 0) {
      if (!this.lastExplorationAt) {
        forceExploration = true;
        console.log("[ambient] forcing exploration: first run");
      } else {
        const hoursSince = (options.now.getTime() - this.lastExplorationAt.getTime()) / 3600000;
        if (hoursSince >= maxHoursBetween) {
          forceExploration = true;
          console.log(
            `[ambient] forcing exploration: ${hoursSince.toFixed(1)}h since last (threshold ${maxHoursBetween}h)`,
          );
        }
      }
    }

    if (!forceExploration) {
      const lastInteraction = await this.analyzer.getLastInteractionTime();
      if (lastInteraction) {
        const minutesIdle = (Date.now() / 1000 - lastInteraction) / 60;
        if (minutesIdle < this.config.exploring.min_idle_minutes) {
          if (this.fsm && this.fsm.state === "exploring") {
            this.fsm.transitionTo("monitoring", "user active");
          }
          return false;
        }
      }

      let isAway = options.currentActivity === null;
      if (!isAway) {
        isAway = await this.analyzer.isUserAfk(options.lookbackMinutes);
      }
      if (!isAway) {
        if (this.fsm && this.fsm.state === "exploring") {
          this.fsm.transitionTo("monitoring", "user active");
        }
        return false;
      }
    }

    if (this.fsm && this.fsm.state !== "exploring") {
      const reason = forceExploration ? "time threshold reached" : "idle and backlog available";
      this.fsm.transitionTo("exploring", reason);
    }

    const outcome = await this.explorer.exploreNext();
    if (!outcome) {
      if (this.fsm && this.fsm.state === "exploring") {
        this.fsm.transitionTo("idle", "no claimable curiosity tasks");
      }
      return false;
    }

    this.explorationsToday += 1;
    this.lastExplorationAt = options.now;

    if (outcome.result && outcome.result.worth_sharing && outcome.result.confidence >= 0.8) {
      console.log("[ambient] exploration produced high-confidence shareable finding");
    }

    return true;
  }

  private buildMissionPrompt(contextSnapshot: JsonRecord): string {
    const payload = JSON.stringify(contextSnapshot);
    return (
      "You are an ambient agent. Use the context to decide if there is a high-signal, " +
      "actionable message to send. If there is nothing useful, respond with send=false.\n\n" +
      "Return structured output that matches the configured JSON schema.\n\n" +
      `Context:\n${payload}\n`
    );
  }

  private async runAmbientMission(
    contextSnapshot: JsonRecord,
  ): Promise<{ message: string; priority: string; confidence: number } | null> {
    const db = await getDb();
    const now = nowDate();

    const mission = await db
      .insertInto("missions")
      .values({
        name: `ambient-${now.toISOString()}`,
        description: "Ambient micro-session",
        prompt: this.buildMissionPrompt(contextSnapshot),
        cron_expression: "0 0 * * *",
        natural_language_schedule: null,
        timezone: "UTC",
        run_once: true,
        personality: this.config.personality,
        allowed_tools: null,
        mcp_servers: null,
        plugins: null,
        thinking_budget: null,
        model: process.env.DERE_AMBIENT_MODEL ?? "claude-haiku-4-5",
        working_dir: "/workspace",
        sandbox_mode: true,
        sandbox_mount_type: "none",
        sandbox_settings: null,
        status: "paused",
        next_execution_at: null,
        last_execution_at: null,
        user_id: this.config.user_id,
        created_at: now,
        updated_at: now,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const startedAt = nowDate();
    let decision: JsonRecord | null = null;
    let errorMessage: string | null = null;
    try {
      const transport = new ClaudeAgentTransport({
        workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
      });
      const client = new StructuredOutputClient({
        transport,
        model: process.env.DERE_AMBIENT_MODEL ?? "claude-haiku-4-5",
      });

      decision = (await client.generate(
        this.buildMissionPrompt(contextSnapshot),
        AmbientMissionDecisionSchema,
        { schemaName: "ambient_mission_decision" },
      )) as JsonRecord;
    } catch (error) {
      errorMessage = String(error);
    }

    const completedAt = nowDate();
    await db
      .insertInto("mission_executions")
      .values({
        mission_id: mission.id,
        status: decision ? "completed" : "failed",
        trigger_type: "manual",
        triggered_by: "ambient",
        started_at: startedAt,
        completed_at: completedAt,
        output_text: decision ? JSON.stringify(decision) : null,
        output_summary: decision && typeof decision.message === "string" ? decision.message : null,
        tool_count: 0,
        error_message: errorMessage,
        execution_metadata: decision ? { structured_output: decision } : { error: errorMessage },
        created_at: completedAt,
      })
      .execute();

    await db
      .updateTable("missions")
      .set({ status: "archived", updated_at: completedAt })
      .where("id", "=", mission.id)
      .execute();

    if (!decision || decision.send !== true) {
      return null;
    }

    const message = typeof decision.message === "string" ? decision.message : null;
    const priority = typeof decision.priority === "string" ? decision.priority : "conversation";
    const confidenceRaw =
      typeof decision.confidence === "number"
        ? decision.confidence
        : Number(decision.confidence ?? 0);
    const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : 0;

    if (!message || confidence < 0.5) {
      return null;
    }

    return { message, priority, confidence };
  }

  private async evaluateFsmState(): Promise<void> {
    if (!this.fsm) {
      return;
    }

    const snapshot = await this.analyzer.getActivitySnapshot(10, 1);
    let activity: JsonRecord = {};
    if (snapshot) {
      const current = (snapshot.current_window ?? snapshot.current_media) as JsonRecord | undefined;
      if (current) {
        activity = {
          app_name: current.app ?? current.player ?? "",
          duration_seconds: current.duration_seconds ?? 0,
        };
      }
    }

    const notificationHistory = await this.getRecentNotifications();
    const taskData = { overdue_count: 0, due_soon_count: 0 };
    const bondData = await this.getBondData();

    const newState = this.fsm.shouldTransition({
      activity,
      emotion: { emotion_type: "neutral", intensity: 0 },
      notificationHistory,
      task: taskData,
      currentHour: new Date().getHours(),
      bond: bondData,
    });

    if (newState) {
      this.fsm.transitionTo(newState, "signal evaluation");
    }
  }

  private async getRecentNotifications(): Promise<JsonRecord[]> {
    const db = await getDb();
    const rows = await db
      .selectFrom("ambient_notifications")
      .select(["id", "message", "priority", "status", "acknowledged", "created_at"])
      .where("user_id", "=", this.config.user_id)
      .orderBy("created_at", "desc")
      .limit(5)
      .execute();
    return rows as JsonRecord[];
  }

  private async getBondData(): Promise<JsonRecord> {
    const daemonUrl = this.config.daemon_url;
    try {
      const response = await fetch(new URL("/dashboard/state", daemonUrl));
      if (response.ok) {
        const data = (await response.json()) as JsonRecord;
        if (isPlainObject(data.bond)) {
          return data.bond as JsonRecord;
        }
      }
    } catch {
      // ignore
    }
    return { affection_level: 50, trend: "stable", streak_days: 0 };
  }

  private async routeMessage(
    _message: string,
    _priority: string,
    _userActivity: JsonRecord | null,
  ): Promise<{ medium: string; location: string; reasoning: string } | null> {
    const method = this.config.notification_method.toLowerCase();
    if (method === "notify-send") {
      return {
        medium: "desktop",
        location: "notify-send",
        reasoning: "notification_method=notify-send",
      };
    }

    const db = await getDb();
    const staleThreshold = new Date(Date.now() - 60_000);
    const mediums = await db
      .selectFrom("medium_presence")
      .select(["medium", "available_channels", "last_heartbeat"])
      .where("user_id", "=", this.config.user_id)
      .where("last_heartbeat", ">=", staleThreshold)
      .orderBy("last_heartbeat", "desc")
      .execute();

    if (mediums.length === 0) {
      if (method === "daemon") {
        return null;
      }
      return {
        medium: "desktop",
        location: "notify-send",
        reasoning: "No conversational mediums online",
      };
    }

    const active = mediums[0];
    if (!active) {
      return null;
    }
    const channels = (active.available_channels ?? []) as Array<Record<string, unknown> | string>;
    const selected = pickBestChannel(channels);
    const location =
      selected && typeof selected === "object"
        ? String((selected as Record<string, unknown>).id ?? selected)
        : String(selected ?? "notify-send");

    return {
      medium: active.medium,
      location,
      reasoning: `Routing to ${active.medium} (most recently active)`,
    };
  }

  private async deliverNotification(
    result: { message: string; priority: string; confidence: number },
    contextSnapshot: JsonRecord,
  ): Promise<void> {
    const routing = await this.routeMessage(
      result.message,
      result.priority,
      (contextSnapshot.activity as JsonRecord) ?? {},
    );
    if (!routing) {
      console.log("[ambient] routing skipped notification delivery");
      return;
    }

    const db = await getDb();
    const now = nowDate();
    const previousNotifications = contextSnapshot.previous_notifications as
      | JsonRecord[]
      | undefined;
    const parentId =
      previousNotifications && previousNotifications.length > 0
        ? (previousNotifications[0]?.id as number | null)
        : null;

    const inserted = await db
      .insertInto("ambient_notifications")
      .values({
        user_id: this.config.user_id,
        target_medium: routing.medium,
        target_location: routing.location,
        message: result.message,
        priority: result.priority,
        routing_reasoning: routing.reasoning,
        status: "pending",
        created_at: now,
        delivered_at: null,
        parent_notification_id: parentId,
        acknowledged: false,
        acknowledged_at: null,
        response_time: null,
        error_message: null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await db
      .insertInto("notification_context")
      .values({
        notification_id: inserted.id,
        trigger_type: "ambient_mission",
        trigger_id: null,
        trigger_data: null,
        context_snapshot: contextSnapshot,
        created_at: now,
      })
      .execute();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let ambientMonitor: AmbientMonitor | null = null;

export async function startAmbientMonitor(): Promise<AmbientMonitor | null> {
  if (ambientMonitor) {
    return ambientMonitor;
  }
  const config = await loadAmbientConfig();
  ambientMonitor = new AmbientMonitor(config);
  await ambientMonitor.start();
  return ambientMonitor;
}

export function getAmbientMonitor(): AmbientMonitor | null {
  return ambientMonitor;
}
