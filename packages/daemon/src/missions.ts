import type { Hono } from "hono";

import { getDb } from "./db.js";
import { getMissionExecutor } from "./mission-runtime.js";
import { getNextCronRun, parseSchedule } from "./mission-schedule.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

type MissionRow = {
  id: number;
  name: string;
  description: string | null;
  prompt: string;
  cron_expression: string;
  natural_language_schedule: string | null;
  timezone: string;
  status: string;
  next_execution_at: Date | null;
  last_execution_at: Date | null;
  personality: string | null;
  allowed_tools: string[] | null;
  mcp_servers: string[] | null;
  plugins: string[] | null;
  thinking_budget: number | null;
  model: string;
  working_dir: string;
  sandbox_mode: boolean;
  sandbox_mount_type: string;
  sandbox_settings: unknown;
  run_once: boolean;
  created_at: Date | null;
  updated_at: Date | null;
};

type MissionExecutionRow = {
  id: number;
  mission_id: number;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  output_text: string | null;
  output_summary: string | null;
  tool_count: number | null;
  error_message: string | null;
  created_at: Date | null;
};

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

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((item) => typeof item === "string") as string[];
  return items.length > 0 ? items : [];
}

function toMissionResponse(row: MissionRow): MissionRow {
  return row;
}

function toExecutionResponse(row: MissionExecutionRow): MissionExecutionRow {
  return row;
}

export function registerMissionRoutes(app: Hono): void {
  app.post("/missions", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const name = payload.name;
    const prompt = payload.prompt;
    const schedule = payload.schedule;

    if (typeof name !== "string" || !name.trim()) {
      return c.json({ error: "name is required" }, 400);
    }
    if (typeof prompt !== "string" || !prompt.trim()) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (typeof schedule !== "string" || !schedule.trim()) {
      return c.json({ error: "schedule is required" }, 400);
    }

    let scheduleResult: {
      cron_expression: string;
      timezone: string;
      natural_language_schedule: string | null;
    };
    try {
      scheduleResult = await parseSchedule(schedule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    let nextRun: Date;
    try {
      nextRun = getNextCronRun(scheduleResult.cron_expression, nowDate(), scheduleResult.timezone);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    const db = await getDb();
    const now = nowDate();
    const inserted = await db
      .insertInto("missions")
      .values({
        name: name.trim(),
        description: typeof payload.description === "string" ? payload.description : null,
        prompt: prompt.trim(),
        cron_expression: scheduleResult.cron_expression,
        natural_language_schedule: scheduleResult.natural_language_schedule,
        timezone: scheduleResult.timezone,
        next_execution_at: nextRun,
        personality: typeof payload.personality === "string" ? payload.personality : null,
        allowed_tools: toStringArray(payload.allowed_tools),
        mcp_servers: toStringArray(payload.mcp_servers),
        plugins: toStringArray(payload.plugins),
        thinking_budget:
          typeof payload.thinking_budget === "number" ? payload.thinking_budget : null,
        model: typeof payload.model === "string" ? payload.model : DEFAULT_MODEL,
        working_dir: typeof payload.working_dir === "string" ? payload.working_dir : "/workspace",
        sandbox_mode: typeof payload.sandbox_mode === "boolean" ? payload.sandbox_mode : true,
        sandbox_mount_type:
          typeof payload.sandbox_mount_type === "string" ? payload.sandbox_mount_type : "none",
        sandbox_settings:
          payload.sandbox_settings && typeof payload.sandbox_settings === "object"
            ? (payload.sandbox_settings as Record<string, unknown>)
            : null,
        run_once: typeof payload.run_once === "boolean" ? payload.run_once : false,
        status: "active",
        last_execution_at: null,
        user_id: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    console.log(
      `[missions] created mission ${inserted.id} (${inserted.name}) next=${nextRun.toISOString()}`,
    );

    return c.json(toMissionResponse(inserted));
  });

  app.get("/missions", async (c) => {
    const status = c.req.query("status");
    const db = await getDb();
    let query = db.selectFrom("missions").selectAll().orderBy("created_at", "desc");
    if (status) {
      query = query.where("status", "=", status);
    }
    const rows = await query.execute();
    return c.json(rows.map((row) => toMissionResponse(row)));
  });

  app.get("/missions/:mission_id", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .selectAll()
      .where("id", "=", missionId)
      .executeTakeFirst();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    return c.json(toMissionResponse(mission));
  });

  app.patch("/missions/:mission_id", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .selectAll()
      .where("id", "=", missionId)
      .executeTakeFirst();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    const updates: Record<string, unknown> = { updated_at: nowDate() };

    if (typeof payload.name === "string") {
      updates.name = payload.name;
    }
    if (typeof payload.description === "string" || payload.description === null) {
      updates.description = payload.description as string | null;
    }
    if (typeof payload.prompt === "string") {
      updates.prompt = payload.prompt;
    }
    if (typeof payload.personality === "string" || payload.personality === null) {
      updates.personality = payload.personality as string | null;
    }
    if ("allowed_tools" in payload) {
      updates.allowed_tools = toStringArray(payload.allowed_tools);
    }
    if ("mcp_servers" in payload) {
      updates.mcp_servers = toStringArray(payload.mcp_servers);
    }
    if ("plugins" in payload) {
      updates.plugins = toStringArray(payload.plugins);
    }
    if (typeof payload.thinking_budget === "number" || payload.thinking_budget === null) {
      updates.thinking_budget = payload.thinking_budget as number | null;
    }
    if (typeof payload.model === "string") {
      updates.model = payload.model;
    }
    if (typeof payload.working_dir === "string") {
      updates.working_dir = payload.working_dir;
    }
    if (typeof payload.sandbox_mode === "boolean") {
      updates.sandbox_mode = payload.sandbox_mode;
    }
    if (typeof payload.sandbox_mount_type === "string") {
      updates.sandbox_mount_type = payload.sandbox_mount_type;
    }
    if (payload.sandbox_settings && typeof payload.sandbox_settings === "object") {
      updates.sandbox_settings = payload.sandbox_settings as Record<string, unknown>;
    }
    if (typeof payload.run_once === "boolean") {
      updates.run_once = payload.run_once;
    }

    if (typeof payload.schedule === "string" && payload.schedule.trim()) {
      try {
        const scheduleResult = await parseSchedule(payload.schedule);
        const nextRun = getNextCronRun(
          scheduleResult.cron_expression,
          nowDate(),
          scheduleResult.timezone,
        );
        updates.cron_expression = scheduleResult.cron_expression;
        updates.timezone = scheduleResult.timezone;
        updates.natural_language_schedule = scheduleResult.natural_language_schedule;
        updates.next_execution_at = nextRun;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 400);
      }
    }

    const updated = await db
      .updateTable("missions")
      .set(updates)
      .where("id", "=", missionId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return c.json(toMissionResponse(updated));
  });

  app.delete("/missions/:mission_id", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .select(["id", "name"])
      .where("id", "=", missionId)
      .executeTakeFirst();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    await db.deleteFrom("missions").where("id", "=", missionId).execute();

    console.log(`[missions] deleted mission ${missionId} (${mission.name})`);
    return c.json({ status: "deleted", id: missionId });
  });

  app.post("/missions/:mission_id/pause", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const db = await getDb();
    const updated = await db
      .updateTable("missions")
      .set({ status: "paused", updated_at: nowDate() })
      .where("id", "=", missionId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return c.json({ error: "Mission not found" }, 404);
    }

    return c.json(toMissionResponse(updated));
  });

  app.post("/missions/:mission_id/resume", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .selectAll()
      .where("id", "=", missionId)
      .executeTakeFirst();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    let nextRun: Date | null = null;
    try {
      nextRun = getNextCronRun(mission.cron_expression, nowDate(), mission.timezone);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    const updated = await db
      .updateTable("missions")
      .set({
        status: "active",
        next_execution_at: nextRun,
        updated_at: nowDate(),
      })
      .where("id", "=", missionId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return c.json(toMissionResponse(updated));
  });

  app.post("/missions/:mission_id/execute", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .selectAll()
      .where("id", "=", missionId)
      .executeTakeFirst();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    const executor = getMissionExecutor();
    if (!executor) {
      return c.json({ error: "Mission executor not available" }, 503);
    }

    void executor.execute(mission, "manual", "user").catch((error) => {
      console.log(`[missions] manual execution failed for ${missionId}: ${String(error)}`);
    });

    return c.json({ status: "triggered", mission_id: missionId });
  });

  app.get("/missions/:mission_id/executions", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    if (!Number.isFinite(missionId)) {
      return c.json({ error: "Invalid mission_id" }, 400);
    }

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.max(1, Number(limitParam)) : 50;

    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .select(["id"])
      .where("id", "=", missionId)
      .executeTakeFirst();

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    const executions = await db
      .selectFrom("mission_executions")
      .selectAll()
      .where("mission_id", "=", missionId)
      .orderBy("started_at", "desc")
      .limit(Number.isFinite(limit) ? limit : 50)
      .execute();

    return c.json(executions.map((exec) => toExecutionResponse(exec)));
  });

  app.get("/missions/:mission_id/executions/:execution_id", async (c) => {
    const missionId = Number(c.req.param("mission_id"));
    const executionId = Number(c.req.param("execution_id"));
    if (!Number.isFinite(missionId) || !Number.isFinite(executionId)) {
      return c.json({ error: "Invalid mission_id or execution_id" }, 400);
    }

    const db = await getDb();
    const execution = await db
      .selectFrom("mission_executions")
      .selectAll()
      .where("id", "=", executionId)
      .executeTakeFirst();

    if (!execution || execution.mission_id !== missionId) {
      return c.json({ error: "Execution not found" }, 404);
    }

    return c.json(toExecutionResponse(execution));
  });
}
