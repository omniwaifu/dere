import type { Hono } from "hono";

import { getDb } from "./db.js";
import { log } from "./logger.js";

function nowDate(): Date {
  return new Date();
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === "object" && !Array.isArray(item))
  );
}

const CLEANUP_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 5 * 60_000;

export function startPresenceCleanupLoop(): void {
  const cleanup = async () => {
    try {
      const db = await getDb();
      const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);
      await db.deleteFrom("medium_presence").where("last_heartbeat", "<", threshold).execute();
    } catch (error) {
      log.daemon.warn("Presence cleanup failed", { error: String(error) });
    }
  };

  setInterval(() => {
    cleanup().catch(() => {});
  }, CLEANUP_INTERVAL_MS);
}

export function registerPresenceRoutes(app: Hono): void {
  app.post("/presence/register", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const medium = payload.medium;
    const userId = payload.user_id;
    const availableChannels = payload.available_channels;

    if (
      typeof medium !== "string" ||
      typeof userId !== "string" ||
      !isRecordArray(availableChannels)
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const db = await getDb();
    const now = nowDate();

    const existing = await db
      .selectFrom("medium_presence")
      .select(["medium"])
      .where("medium", "=", medium)
      .where("user_id", "=", userId)
      .executeTakeFirst();

    // pg driver requires jsonb values to be stringified
    const channelsJson = JSON.stringify(availableChannels) as unknown as typeof availableChannels;

    if (existing) {
      await db
        .updateTable("medium_presence")
        .set({
          available_channels: channelsJson,
          last_heartbeat: now,
        })
        .where("medium", "=", medium)
        .where("user_id", "=", userId)
        .execute();
    } else {
      await db
        .insertInto("medium_presence")
        .values({
          medium,
          user_id: userId,
          status: "online",
          last_heartbeat: now,
          available_channels: channelsJson,
          created_at: now,
        })
        .execute();
    }

    return c.json({ status: "registered" });
  });

  app.post("/presence/heartbeat", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const medium = payload.medium;
    const userId = payload.user_id;

    if (typeof medium !== "string" || typeof userId !== "string") {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const db = await getDb();
    await db
      .updateTable("medium_presence")
      .set({ last_heartbeat: nowDate() })
      .where("medium", "=", medium)
      .where("user_id", "=", userId)
      .execute();

    return c.json({ status: "ok" });
  });

  app.post("/presence/unregister", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const medium = payload.medium;
    const userId = payload.user_id;

    if (typeof medium !== "string" || typeof userId !== "string") {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const db = await getDb();
    await db
      .deleteFrom("medium_presence")
      .where("medium", "=", medium)
      .where("user_id", "=", userId)
      .execute();

    return c.json({ status: "unregistered" });
  });

  app.get("/presence/available", async (c) => {
    const userId = c.req.query("user_id");
    if (!userId) {
      return c.json({ error: "user_id is required" }, 400);
    }

    const db = await getDb();
    const staleThreshold = new Date(Date.now() - 60_000);

    const rows = await db
      .selectFrom("medium_presence")
      .select(["medium", "available_channels", "last_heartbeat"])
      .where("user_id", "=", userId)
      .where("last_heartbeat", ">=", staleThreshold)
      .execute();

    return c.json({
      mediums: rows.map((row) => ({
        medium: row.medium,
        available_channels: row.available_channels ?? [],
        last_heartbeat: row.last_heartbeat,
      })),
    });
  });
}
