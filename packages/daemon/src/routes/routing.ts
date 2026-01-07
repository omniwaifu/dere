import type { Hono } from "hono";

import { getDb } from "../db.js";

function nowDate(): Date {
  return new Date();
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

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function registerRoutingRoutes(app: Hono): void {
  app.post("/routing/decide", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const userId = payload.user_id;
    const message = payload.message;
    const priority = payload.priority;

    if (typeof userId !== "string" || typeof message !== "string" || typeof priority !== "string") {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const db = await getDb();
    const staleThreshold = new Date(nowDate().getTime() - 60_000);
    const presences = await db
      .selectFrom("medium_presence")
      .select(["medium", "available_channels", "last_heartbeat"])
      .where("user_id", "=", userId)
      .where("last_heartbeat", ">=", staleThreshold)
      .orderBy("last_heartbeat", "desc")
      .execute();

    const available = presences.map((p) => ({
      medium: p.medium,
      available_channels: p.available_channels ?? [],
      last_heartbeat: p.last_heartbeat,
    }));

    if (available.length === 0) {
      return c.json({
        medium: "desktop",
        location: "notify-send",
        reasoning: "No conversational mediums online",
        fallback: true,
      });
    }

    const active = available[0];
    if (!active) {
      return c.json({
        medium: "desktop",
        location: "notify-send",
        reasoning: "No conversational mediums online",
        fallback: true,
      });
    }
    const channels = (active.available_channels ?? []) as Array<Record<string, unknown> | string>;
    const selected = pickBestChannel(channels);
    const location =
      selected && typeof selected === "object"
        ? String((selected as Record<string, unknown>).id ?? selected)
        : String(selected ?? "notify-send");

    return c.json({
      medium: active.medium,
      location,
      reasoning: `Routing to ${active.medium} (most recently active)`,
      fallback: false,
    });
  });
}
