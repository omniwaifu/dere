import type { Hono } from "hono";
import { getDb } from "../db.js";

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

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function registerNotificationRoutes(app: Hono): void {
  app.post("/notifications/create", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const userId = payload.user_id;
    const targetMedium = payload.target_medium;
    const targetLocation = payload.target_location;
    const message = payload.message;
    const priority = payload.priority;
    const routingReasoning = payload.routing_reasoning;

    if (
      typeof userId !== "string" ||
      typeof targetMedium !== "string" ||
      typeof targetLocation !== "string" ||
      typeof message !== "string" ||
      typeof priority !== "string" ||
      typeof routingReasoning !== "string"
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const db = await getDb();
    const now = nowDate();

    const notification = await db
      .insertInto("ambient_notifications")
      .values({
        user_id: userId,
        target_medium: targetMedium,
        target_location: targetLocation,
        message,
        priority,
        routing_reasoning: routingReasoning,
        status: "pending",
        created_at: now,
        delivered_at: null,
        parent_notification_id:
          typeof payload.parent_notification_id === "number"
            ? payload.parent_notification_id
            : null,
        acknowledged: false,
        acknowledged_at: null,
        response_time: null,
        error_message: null,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    if (payload.context_snapshot || payload.trigger_type) {
      await db
        .insertInto("notification_context")
        .values({
          notification_id: notification.id,
          trigger_type: typeof payload.trigger_type === "string" ? payload.trigger_type : null,
          trigger_id: typeof payload.trigger_id === "string" ? payload.trigger_id : null,
          trigger_data: toJsonRecord(payload.trigger_data),
          context_snapshot: toJsonRecord(payload.context_snapshot),
          created_at: now,
        })
        .execute();
    }

    return c.json({ notification_id: notification.id, status: "queued" });
  });

  app.get("/notifications/recent", async (c) => {
    const userId = c.req.query("user_id");
    const limit = Number(c.req.query("limit") ?? 5);
    if (!userId) {
      return c.json({ error: "user_id is required" }, 400);
    }

    const db = await getDb();
    const notifications = await db
      .selectFrom("ambient_notifications")
      .select(["id", "message", "priority", "status", "created_at", "delivered_at"])
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(Number.isFinite(limit) ? limit : 5)
      .execute();

    return c.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        message: n.message,
        priority: n.priority,
        status: n.status,
        created_at: n.created_at ? n.created_at.toISOString() : null,
        delivered_at: n.delivered_at ? n.delivered_at.toISOString() : null,
      })),
    });
  });

  app.get("/notifications/pending", async (c) => {
    const medium = c.req.query("medium");
    if (!medium) {
      return c.json({ error: "medium is required" }, 400);
    }

    const db = await getDb();
    const notifications = await db
      .selectFrom("ambient_notifications")
      .select([
        "id",
        "user_id",
        "target_location",
        "message",
        "priority",
        "routing_reasoning",
        "created_at",
      ])
      .where("target_medium", "=", medium)
      .where("status", "=", "pending")
      .orderBy("priority", "desc")
      .orderBy("created_at", "asc")
      .execute();

    return c.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        user_id: n.user_id,
        target_location: n.target_location,
        message: n.message,
        priority: n.priority,
        routing_reasoning: n.routing_reasoning,
        created_at: n.created_at,
      })),
    });
  });

  app.post("/notifications/recent_unacknowledged", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const userId = payload?.user_id;
    const since = payload?.since;
    if (typeof userId !== "string" || typeof since !== "string") {
      return c.json({ error: "user_id and since are required" }, 400);
    }

    const sinceTime = new Date(since);
    if (Number.isNaN(sinceTime.getTime())) {
      return c.json({ error: "since must be ISO timestamp" }, 400);
    }

    const db = await getDb();
    const notifications = await db
      .selectFrom("ambient_notifications")
      .select([
        "id",
        "message",
        "priority",
        "created_at",
        "delivered_at",
        "status",
        "acknowledged",
        "parent_notification_id",
      ])
      .where("user_id", "=", userId)
      .where("created_at", ">=", sinceTime)
      .where("status", "=", "delivered")
      .where("acknowledged", "=", false)
      .orderBy("created_at", "desc")
      .limit(10)
      .execute();

    return c.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        message: n.message,
        priority: n.priority,
        created_at: n.created_at ? n.created_at.toISOString() : null,
        delivered_at: n.delivered_at ? n.delivered_at.toISOString() : null,
        status: n.status,
        acknowledged: n.acknowledged,
        parent_notification_id: n.parent_notification_id,
      })),
    });
  });

  app.post("/notifications/:notification_id/delivered", async (c) => {
    const notificationId = Number(c.req.param("notification_id"));
    if (!Number.isFinite(notificationId)) {
      return c.json({ error: "Invalid notification_id" }, 400);
    }

    const db = await getDb();
    await db
      .updateTable("ambient_notifications")
      .set({ status: "delivered", delivered_at: nowDate() })
      .where("id", "=", notificationId)
      .execute();

    return c.json({ status: "delivered" });
  });

  app.post("/notifications/:notification_id/acknowledge", async (c) => {
    const notificationId = Number(c.req.param("notification_id"));
    if (!Number.isFinite(notificationId)) {
      return c.json({ error: "Invalid notification_id" }, 400);
    }

    const db = await getDb();
    await db
      .updateTable("ambient_notifications")
      .set({ acknowledged: true, acknowledged_at: nowDate() })
      .where("id", "=", notificationId)
      .execute();

    return c.json({ status: "acknowledged" });
  });

  app.post("/notifications/:notification_id/failed", async (c) => {
    const notificationId = Number(c.req.param("notification_id"));
    if (!Number.isFinite(notificationId)) {
      return c.json({ error: "Invalid notification_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const errorMessage = typeof payload?.error_message === "string" ? payload.error_message : null;
    if (!errorMessage) {
      return c.json({ error: "error_message is required" }, 400);
    }

    const db = await getDb();
    await db
      .updateTable("ambient_notifications")
      .set({ status: "failed", error_message: errorMessage, delivered_at: nowDate() })
      .where("id", "=", notificationId)
      .execute();

    return c.json({ status: "failed" });
  });
}
