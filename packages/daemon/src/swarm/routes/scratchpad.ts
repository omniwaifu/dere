/**
 * Scratchpad CRUD routes for swarm inter-agent communication.
 */

import type { Hono } from "hono";

import { getDb } from "../../db.js";
import { upsertScratchpadEntry } from "../../db-utils.js";
import { parseJson, toJsonValue } from "../utils.js";
import { handleRouteError } from "./helpers.js";

export function registerScratchpadRoutes(app: Hono): void {
  // List scratchpad entries
  app.get("/swarm/:swarm_id/scratchpad", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const prefix = c.req.query("prefix");
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    try {
      const db = await getDb();
      let query = db.selectFrom("swarm_scratchpad").selectAll().where("swarm_id", "=", swarmId);
      if (prefix) {
        query = query.where("key", "like", `${prefix}%`);
      }

      const entries = await query.orderBy("key", "asc").execute();
      return c.json(
        entries.map((entry) => ({
          key: entry.key,
          value: entry.value,
          set_by_agent_id: entry.set_by_agent_id,
          set_by_agent_name: entry.set_by_agent_name,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
        })),
      );
    } catch (error) {
      return handleRouteError("getScratchpad", error, c);
    }
  });

  // Get single scratchpad entry
  app.get("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const db = await getDb();
    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();
    if (!entry) {
      return c.json({ error: `Key '${key}' not found in swarm ${swarmId}` }, 404);
    }

    return c.json({
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.set_by_agent_id,
      set_by_agent_name: entry.set_by_agent_name,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  });

  // Set scratchpad entry
  app.put("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const db = await getDb();
    const scratchValue = toJsonValue(payload.value);
    const agentId = typeof payload.agent_id === "number" ? payload.agent_id : null;
    const agentName = typeof payload.agent_name === "string" ? payload.agent_name : null;

    await upsertScratchpadEntry(db, {
      swarmId,
      key,
      value: scratchValue,
      agentId,
      agentName,
    });

    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirstOrThrow();

    return c.json({
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.set_by_agent_id,
      set_by_agent_name: entry.set_by_agent_name,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  });

  // Delete scratchpad entry
  app.delete("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const db = await getDb();
    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();

    if (!entry) {
      return c.json({ error: `Key '${key}' not found in swarm ${swarmId}` }, 404);
    }

    await db.deleteFrom("swarm_scratchpad").where("id", "=", entry.id).execute();
    return c.json({ deleted: true, key });
  });
}
