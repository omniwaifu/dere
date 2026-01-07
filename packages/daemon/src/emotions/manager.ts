import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  AppraisalOutputSchema,
  buildAppraisalPrompt,
  buildEmotionStateFromActive,
  type OCCGoal,
  type OCCStandard,
  type OCCAttitude,
} from "@dere/shared-llm";
import type { AppraisalOutput } from "@dere/shared-llm";

import { getDb } from "../db.js";
import {
  EmotionPhysics,
  EMOTION_CHARACTERISTICS,
  type EmotionInstance,
  type EmotionPhysicsContext,
} from "./physics.js";
import { SmartDecay, DEFAULT_DECAY_CONTEXT, type DecayContext } from "./decay.js";

type StimulusEntry = {
  stimulus: Record<string, unknown> | string;
  context: Record<string, unknown>;
  personaPrompt: string;
  timestamp: number;
};

const MAX_BATCH_SIZE = 8;
const MAX_CONTENT_CHARS = 500;
const DEFAULT_MODEL = "claude-haiku-4-5";
const RECENT_STIMULI_WINDOW_MS = 60 * 60 * 1000;
const RECENT_STIMULI_MAX = 200;

function nowMs(): number {
  return Date.now();
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit);
}

function getClient(): StructuredOutputClient {
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  return new StructuredOutputClient({
    transport,
    model: process.env.DERE_EMOTION_MODEL ?? DEFAULT_MODEL,
  });
}

function stringifyStimulus(value: Record<string, unknown> | string): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectEmotions(active: Record<string, EmotionInstance>): Array<EmotionInstance> {
  return Object.values(active).sort((a, b) => b.intensity - a.intensity);
}

function getTimeOfDay(): DecayContext["time_of_day"] {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return "morning";
  }
  if (hour >= 12 && hour < 17) {
    return "afternoon";
  }
  if (hour >= 17 && hour < 21) {
    return "evening";
  }
  return "night";
}

export class EmotionManager {
  private readonly sessionId: number;
  private readonly goals: OCCGoal[];
  private readonly standards: OCCStandard[];
  private readonly attitudes: OCCAttitude[];
  private readonly physics = new EmotionPhysics();
  private readonly smartDecay = new SmartDecay();
  private activeEmotions: Record<string, EmotionInstance> = {};
  private lastDecayTime = nowMs();
  private lastMajorChangeTime = nowMs();
  private pending: StimulusEntry[] = [];
  private lastStimulusTime = 0;
  private recentStimuli: Array<{ timestamp: number; valence: number }> = [];

  constructor(args: {
    sessionId: number;
    goals: OCCGoal[];
    standards: OCCStandard[];
    attitudes: OCCAttitude[];
  }) {
    this.sessionId = args.sessionId;
    this.goals = args.goals;
    this.standards = args.standards;
    this.attitudes = args.attitudes;
  }

  async initialize(): Promise<void> {
    const db = await getDb();
    const stateRow = await db
      .selectFrom("emotion_states")
      .select(["appraisal_data"])
      .where("session_id", "=", this.sessionId === 0 ? null : this.sessionId)
      .orderBy("last_update", "desc")
      .limit(1)
      .executeTakeFirst();

    if (stateRow?.appraisal_data && typeof stateRow.appraisal_data === "object") {
      const data = stateRow.appraisal_data as Record<string, unknown>;
      const active = data.active_emotions as Record<string, unknown> | undefined;
      const lastDecay = data.last_decay_time;
      if (active && typeof active === "object") {
        const parsed: Record<string, EmotionInstance> = {};
        for (const [key, value] of Object.entries(active)) {
          if (value && typeof value === "object") {
            const record = value as Record<string, unknown>;
            const intensity = typeof record.intensity === "number" ? record.intensity : 0;
            parsed[key] = {
              type: key,
              intensity,
              last_updated: typeof record.last_updated === "number" ? record.last_updated : nowMs(),
            };
          }
        }
        this.activeEmotions = parsed;
      }
      if (typeof lastDecay === "number") {
        this.lastDecayTime = lastDecay;
      }
    }

    try {
      const since = nowMs() - RECENT_STIMULI_WINDOW_MS;
      const history = await db
        .selectFrom("stimulus_history")
        .select(["timestamp", "valence"])
        .where("session_id", "=", this.sessionId === 0 ? null : this.sessionId)
        .where("timestamp", ">=", since)
        .orderBy("timestamp", "asc")
        .limit(RECENT_STIMULI_MAX)
        .execute();

      this.recentStimuli = history
        .map((row) => ({
          timestamp: typeof row.timestamp === "number" ? row.timestamp : 0,
          valence: typeof row.valence === "number" ? row.valence : 0,
        }))
        .filter((entry) => entry.timestamp > 0);
    } catch {
      this.recentStimuli = [];
    }
  }

  bufferStimulus(stimulus: StimulusEntry): void {
    this.pending.push(stimulus);
    this.lastStimulusTime = nowMs();
  }

  hasPendingStimuli(): boolean {
    return this.pending.length > 0;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  getLastStimulusTime(): number {
    return this.lastStimulusTime;
  }

  async flushBatch(): Promise<Record<string, EmotionInstance>> {
    if (this.pending.length === 0) {
      return this.activeEmotions;
    }

    const entries = this.pending.splice(0, MAX_BATCH_SIZE);
    const combinedStimulus =
      entries.length === 1
        ? entries[0]?.stimulus ?? ""
        : entries.map((entry) => stringifyStimulus(entry.stimulus)).join("\n");
    const context = entries[0]?.context ?? {};
    const personaPrompt = entries[0]?.personaPrompt ?? "";
    const currentEmotionState = buildEmotionStateFromActive(this.activeEmotions);

    await this.applyDecay();

    const prompt = buildAppraisalPrompt({
      stimulus: combinedStimulus,
      currentEmotionState,
      context,
      personaPrompt,
      goals: this.goals,
      standards: this.standards,
      attitudes: this.attitudes,
    });

    const client = getClient();
    const appraisal = await client.generate(prompt, AppraisalOutputSchema, {
      schemaName: "appraisal_output",
    });

    const resulting = appraisal.resulting_emotions ?? [];
    const now = nowMs();
    let changed = false;
    const physicsContext = this.buildPhysicsContext(context);

    for (const emotion of resulting) {
      if (!emotion?.type || emotion.type === "neutral") {
        continue;
      }
      const rawIntensity = typeof emotion.intensity === "number" ? emotion.intensity : 0;
      if (rawIntensity <= 0) {
        continue;
      }

      const physicsResult = this.physics.calculateIntensityChange(
        emotion.type,
        rawIntensity,
        physicsContext,
      );

      if (physicsResult.final_intensity > 1) {
        this.activeEmotions[emotion.type] = {
          type: emotion.type,
          intensity: physicsResult.final_intensity,
          last_updated: now,
        };
        changed = true;
      } else if (this.activeEmotions[emotion.type]) {
        delete this.activeEmotions[emotion.type];
        changed = true;
      }
    }

    if (changed) {
      this.lastMajorChangeTime = now;
    }

    await this.persistState(appraisal, entries);

    return this.activeEmotions;
  }

  async applyDecay(): Promise<void> {
    const now = nowMs();
    const minutes = (now - this.lastDecayTime) / (1000 * 60);
    if (minutes < 0.1) {
      return;
    }

    const decayContext = await this.buildDecayContext();
    const pre = this.activeEmotions;
    const result = this.smartDecay.applyDecayToEmotions(pre, minutes, decayContext);
    this.activeEmotions = result.updated_emotions;
    this.lastDecayTime = now;

    if (result.total_decay_activity > 0) {
      await this.persistState(null, []);
    }
  }

  private async persistState(
    appraisal: AppraisalOutput | null,
    entries: StimulusEntry[],
  ): Promise<void> {
    const db = await getDb();
    const now = new Date();

    const sorted = collectEmotions(this.activeEmotions);
    const primary = sorted[0] ?? null;
    const secondary = sorted[1] ?? null;
    const overall = primary ? primary.intensity : null;

    const appraisalData = {
      active_emotions: Object.fromEntries(
        Object.values(this.activeEmotions).map((emotion) => [
          emotion.type,
          { intensity: emotion.intensity, last_updated: emotion.last_updated },
        ]),
      ),
      last_decay_time: this.lastDecayTime,
    };

    await db
      .insertInto("emotion_states")
      .values({
        session_id: this.sessionId === 0 ? null : this.sessionId,
        primary_emotion: primary?.type ?? null,
        primary_intensity: primary?.intensity ?? null,
        secondary_emotion: secondary?.type ?? null,
        secondary_intensity: secondary?.intensity ?? null,
        overall_intensity: overall ?? null,
        appraisal_data: appraisalData,
        trigger_data: appraisal?.reasoning ? { reasoning: appraisal.reasoning } : null,
        last_update: now,
        created_at: now,
      })
      .execute();

    const timestamp = nowMs();
    for (const entry of entries) {
      const valence = appraisal?.resulting_emotions
        ? this.calculateValence(appraisal.resulting_emotions)
        : 0;
      const intensity = appraisal?.resulting_emotions
        ? appraisal.resulting_emotions.reduce((max, e) => Math.max(max, e.intensity ?? 0), 0)
        : 0;

      this.pushRecentStimulus({ timestamp, valence });

      const recordContext: Record<string, unknown> = {
        ...entry.context,
        resulting_emotions: appraisal?.resulting_emotions ?? [],
        reasoning: appraisal?.reasoning ?? null,
      };

      await db
        .insertInto("stimulus_history")
        .values({
          session_id: this.sessionId === 0 ? null : this.sessionId,
          stimulus_type: typeof entry.stimulus === "string" ? "text" : "event",
          valence,
          intensity,
          timestamp,
          context: recordContext,
          created_at: now,
        })
        .execute();
    }
  }

  private buildPhysicsContext(context: Record<string, unknown>): EmotionPhysicsContext {
    const recentWindow = 10 * 60 * 1000;
    const cutoff = nowMs() - recentWindow;
    const socialContext = toJsonRecord(context.social_context);
    return {
      current_emotions: this.activeEmotions,
      recent_stimuli_history: this.recentStimuli.filter((entry) => entry.timestamp >= cutoff),
      time_since_last_major_change: nowMs() - this.lastMajorChangeTime,
      social_context: socialContext,
    };
  }

  private async buildDecayContext(): Promise<DecayContext> {
    const base = { ...DEFAULT_DECAY_CONTEXT };
    const presence = await this.checkUserPresence();
    const recentActivity = this.calculateRecentActivity();
    return {
      ...base,
      is_user_present: presence.isPresent,
      is_user_engaged: presence.isEngaged,
      recent_emotional_activity: recentActivity,
      time_of_day: getTimeOfDay(),
    };
  }

  private calculateRecentActivity(): number {
    const windowMs = 10 * 60 * 1000;
    const cutoff = nowMs() - windowMs;
    const count = this.recentStimuli.filter((entry) => entry.timestamp >= cutoff).length;
    return Math.min(1, count / 10);
  }

  private async checkUserPresence(): Promise<{ isPresent: boolean; isEngaged: boolean }> {
    if (!this.sessionId) {
      return { isPresent: false, isEngaged: false };
    }

    try {
      const db = await getDb();
      const row = await db
        .selectFrom("sessions")
        .select(["last_activity"])
        .where("id", "=", this.sessionId)
        .executeTakeFirst();

      if (row?.last_activity) {
        const diffMs = nowMs() - row.last_activity.getTime();
        return {
          isPresent: diffMs < 5 * 60 * 1000,
          isEngaged: diffMs < 60 * 1000,
        };
      }
    } catch {
      return { isPresent: false, isEngaged: false };
    }

    return { isPresent: false, isEngaged: false };
  }

  private pushRecentStimulus(entry: { timestamp: number; valence: number }) {
    this.recentStimuli.push(entry);
    if (this.recentStimuli.length > RECENT_STIMULI_MAX) {
      this.recentStimuli = this.recentStimuli.slice(-RECENT_STIMULI_MAX);
    }
  }

  private calculateValence(
    resulting: Array<{ type?: string | null; intensity?: number | null }>,
  ): number {
    let valence = 0;
    for (const emotion of resulting) {
      if (!emotion?.type) {
        continue;
      }
      const characteristics = EMOTION_CHARACTERISTICS[emotion.type];
      if (!characteristics) {
        continue;
      }
      const intensity = emotion.intensity ?? 0;
      if (characteristics.valence === "positive") {
        valence += intensity / 10;
      } else if (characteristics.valence === "negative") {
        valence -= intensity / 10;
      }
    }

    return Math.max(-10, Math.min(10, valence));
  }
}

export function trimStimulusInput(input: string): string {
  return truncateText(input, MAX_CONTENT_CHARS);
}

export const EMOTION_BATCH_LIMIT = MAX_BATCH_SIZE;
