import type { Hono } from "hono";

import { buildActivitySnapshot, classifyActivity } from "./activity.js";
import { getAmbientMonitor } from "../ambient/monitor.js";
import { getDb } from "../db.js";

export function registerDashboardRoutes(app: Hono): void {
  app.get("/dashboard/state", async (c) => {
    const now = new Date();
    const db = await getDb();
    const row = await db
      .selectFrom("emotion_states")
      .select(["primary_emotion", "primary_intensity", "last_update"])
      .where("session_id", "is", null)
      .orderBy("last_update", "desc")
      .limit(1)
      .executeTakeFirst();

    const emotion =
      row && row.primary_emotion && row.primary_emotion !== "neutral"
        ? {
            type: row.primary_emotion,
            intensity: row.primary_intensity ?? 0,
            last_updated: row.last_update ? Math.floor(row.last_update.getTime() / 1000) : null,
          }
        : { type: "neutral", intensity: 0, last_updated: null };

    const snapshot = await buildActivitySnapshot({
      lookbackMinutes: 5,
      top: 3,
      recencySeconds: 120,
      includeRecent: false,
      recentLimit: 5,
    });

    let currentApp: string | null = null;
    let currentTitle: string | null = null;
    let isIdle = true;
    let idleDuration = 0;
    let category = "absent";

    const current = (snapshot.current_window ?? snapshot.current_media) as
      | Record<string, unknown>
      | undefined;
    if (current) {
      currentApp =
        (current.app as string | undefined) ?? (current.player as string | undefined) ?? null;
      if (current.app) {
        currentTitle = (current.title as string | undefined) ?? null;
      } else {
        const artist = current.artist as string | undefined;
        const title = current.title as string | undefined;
        currentTitle = artist ? `${artist} - ${title ?? ""}` : (title ?? null);
      }
    }

    isIdle = snapshot.presence === "away";
    idleDuration = isIdle ? ((snapshot.idle_seconds as number | undefined) ?? 0) : 0;

    if (!isIdle && currentApp) {
      category =
        (snapshot.current_category as string | undefined) ??
        classifyActivity(currentApp, currentTitle ?? "");
    }

    const activity = {
      current_app: currentApp,
      current_title: currentTitle,
      is_idle: isIdle,
      idle_duration_seconds: idleDuration,
      activity_category: category,
    };

    const monitorState = await getAmbientMonitor()?.getStateInfo();
    const ambient = {
      fsm_state: monitorState?.daemon_state ?? "unknown",
      next_check_at: null,
      is_enabled: monitorState?.is_enabled ?? false,
    };

    return c.json({
      emotion,
      activity,
      ambient,
      timestamp: now.toISOString(),
    });
  });
}
