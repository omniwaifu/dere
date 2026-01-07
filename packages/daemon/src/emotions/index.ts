import type { Hono } from "hono";
import { getDb } from "../db.js";
import { getOccProfileSnapshot } from "./runtime.js";

type EmotionEvent = {
  timestamp: number;
  stimulus_type: string;
  valence: number;
  intensity: number;
  resulting_emotions: Array<{ type: string; intensity: number }>;
  reasoning: string | null;
};

function formatSummary(emotion: string | null, intensity: number | null): string {
  if (!emotion || emotion === "neutral") {
    return "Note: No particular emotional signals detected.";
  }

  const name = emotion.replace(/_/g, " ").toLowerCase();
  const intensityValue = intensity ?? 0;

  let guidance = "Minor signal, don't overreact.";
  if (intensityValue > 70) {
    guidance = "Respond with care and attention to this.";
  } else if (intensityValue > 40) {
    guidance = "Keep this in mind when responding.";
  }

  return `Context: User showing signs of ${name}. ${guidance}`;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toEmotionEvents(
  rows: Array<{
    timestamp: number;
    stimulus_type: string;
    valence: number;
    intensity: number;
    context: unknown;
  }>,
): EmotionEvent[] {
  return rows.map((row) => {
    const ctx = toJsonRecord(row.context) ?? {};
    const resulting = Array.isArray(ctx.resulting_emotions)
      ? ctx.resulting_emotions
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            type: String((item as Record<string, unknown>).type ?? ""),
            intensity: toNumber((item as Record<string, unknown>).intensity, 0),
          }))
      : [];
    return {
      timestamp: row.timestamp,
      stimulus_type: row.stimulus_type,
      valence: row.valence,
      intensity: row.intensity,
      resulting_emotions: resulting,
      reasoning: typeof ctx.reasoning === "string" ? ctx.reasoning : null,
    };
  });
}

async function loadEmotionSummary(sessionId: number | null): Promise<string> {
  const db = await getDb();
  const row = await db
    .selectFrom("emotion_states")
    .select(["primary_emotion", "primary_intensity"])
    .where("session_id", "=", sessionId ?? null)
    .orderBy("last_update", "desc")
    .limit(1)
    .executeTakeFirst();

  return formatSummary(row?.primary_emotion ?? null, row?.primary_intensity ?? null);
}

export function registerEmotionRoutes(app: Hono): void {
  app.get("/emotion/state", async (c) => {
    const db = await getDb();
    const row = await db
      .selectFrom("emotion_states")
      .select([
        "primary_emotion",
        "primary_intensity",
        "secondary_emotion",
        "secondary_intensity",
        "last_update",
      ])
      .where("session_id", "is", null)
      .orderBy("last_update", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!row || !row.primary_emotion || row.primary_emotion === "neutral") {
      return c.json({ has_emotion: false, state: "neutral" });
    }

    const activeEmotions: Record<
      string,
      { intensity: number | null; last_updated: string | null }
    > = {};
    if (row.primary_emotion) {
      activeEmotions[row.primary_emotion] = {
        intensity: row.primary_intensity ?? null,
        last_updated: row.last_update ? row.last_update.toISOString() : null,
      };
    }
    if (row.secondary_emotion) {
      activeEmotions[row.secondary_emotion] = {
        intensity: row.secondary_intensity ?? null,
        last_updated: row.last_update ? row.last_update.toISOString() : null,
      };
    }

    return c.json({
      has_emotion: true,
      dominant_emotion: row.primary_emotion,
      intensity: row.primary_intensity ?? null,
      last_updated: row.last_update ? row.last_update.toISOString() : null,
      active_emotions: activeEmotions,
    });
  });

  app.get("/emotion/summary", async (c) => {
    const summary = await loadEmotionSummary(null);
    return c.json({ summary });
  });

  app.get("/emotion/summary/:sessionId", async (c) => {
    const raw = c.req.param("sessionId");
    const sessionId = Number(raw);
    if (!Number.isFinite(sessionId)) {
      return c.json({ summary: formatSummary(null, null) });
    }

    const summary = await loadEmotionSummary(sessionId);
    return c.json({ summary });
  });

  app.get("/emotion/history", async (c) => {
    const limit = Math.max(1, toNumber(c.req.query("limit"), 100));
    const nowMs = Date.now();
    const cutoff = nowMs - 60 * 60 * 1000;

    const db = await getDb();
    const rows = await db
      .selectFrom("stimulus_history")
      .select(["timestamp", "stimulus_type", "valence", "intensity", "context"])
      .where("session_id", "is", null)
      .where("timestamp", ">=", cutoff)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .execute();

    const events = toEmotionEvents(rows);
    return c.json({
      events,
      total_count: events.length,
    });
  });

  app.get("/emotion/history/db", async (c) => {
    const nowMs = Date.now();
    const endTime = toNumber(c.req.query("end_time"), nowMs);
    const startTime = toNumber(c.req.query("start_time"), nowMs - 24 * 60 * 60 * 1000);
    const limit = Math.max(1, toNumber(c.req.query("limit"), 500));

    const db = await getDb();
    const rows = await db
      .selectFrom("stimulus_history")
      .select(["timestamp", "stimulus_type", "valence", "intensity", "context"])
      .where("session_id", "is", null)
      .where("timestamp", ">=", startTime)
      .where("timestamp", "<=", endTime)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .execute();

    const events = toEmotionEvents(rows);
    return c.json({
      events,
      total_count: events.length,
      start_time: startTime,
      end_time: endTime,
    });
  });

  app.get("/emotion/profile", async (c) => {
    const profile = await getOccProfileSnapshot();
    return c.json({
      has_profile: profile.hasProfile,
      profile_path: profile.profilePath,
      goals: profile.goals,
      standards: profile.standards,
      attitudes: profile.attitudes,
    });
  });
}
