import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db.js";
import { getMissionExecutor } from "../../mission-runtime.js";
import { getNextCronRun, parseSchedule } from "../../mission-schedule.js";
import { router, publicProcedure } from "../init.js";
import { log } from "../../logger.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

function nowDate(): Date {
  return new Date();
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((item) => typeof item === "string") as string[];
  return items.length > 0 ? items : [];
}

const createMissionInput = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  schedule: z.string().min(1),
  description: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  allowed_tools: z.array(z.string()).nullable().optional(),
  mcp_servers: z.array(z.string()).nullable().optional(),
  plugins: z.array(z.string()).nullable().optional(),
  thinking_budget: z.number().nullable().optional(),
  model: z.string().optional(),
  working_dir: z.string().optional(),
  sandbox_mode: z.boolean().optional(),
  sandbox_mount_type: z.string().optional(),
  sandbox_settings: z.record(z.string(), z.unknown()).nullable().optional(),
  run_once: z.boolean().optional(),
});

const updateMissionInput = z.object({
  mission_id: z.number(),
  name: z.string().optional(),
  prompt: z.string().optional(),
  schedule: z.string().optional(),
  description: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  allowed_tools: z.array(z.string()).nullable().optional(),
  mcp_servers: z.array(z.string()).nullable().optional(),
  plugins: z.array(z.string()).nullable().optional(),
  thinking_budget: z.number().nullable().optional(),
  model: z.string().optional(),
  working_dir: z.string().optional(),
  sandbox_mode: z.boolean().optional(),
  sandbox_mount_type: z.string().optional(),
  sandbox_settings: z.record(z.string(), z.unknown()).nullable().optional(),
  run_once: z.boolean().optional(),
});

export const missionsRouter = router({
  create: publicProcedure.input(createMissionInput).mutation(async ({ input }) => {
    let scheduleResult: {
      cron_expression: string;
      timezone: string;
      natural_language_schedule: string | null;
    };
    try {
      scheduleResult = await parseSchedule(input.schedule);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    let nextRun: Date;
    try {
      nextRun = getNextCronRun(scheduleResult.cron_expression, nowDate(), scheduleResult.timezone);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const db = await getDb();
    const now = nowDate();
    const inserted = await db
      .insertInto("missions")
      .values({
        name: input.name.trim(),
        description: input.description ?? null,
        prompt: input.prompt.trim(),
        cron_expression: scheduleResult.cron_expression,
        natural_language_schedule: scheduleResult.natural_language_schedule,
        timezone: scheduleResult.timezone,
        next_execution_at: nextRun,
        personality: input.personality ?? null,
        allowed_tools: toStringArray(input.allowed_tools),
        mcp_servers: toStringArray(input.mcp_servers),
        plugins: toStringArray(input.plugins),
        thinking_budget: input.thinking_budget ?? null,
        model: input.model ?? DEFAULT_MODEL,
        working_dir: input.working_dir ?? "/workspace",
        sandbox_mode: input.sandbox_mode ?? true,
        sandbox_mount_type: input.sandbox_mount_type ?? "none",
        sandbox_settings: input.sandbox_settings ?? null,
        run_once: input.run_once ?? false,
        status: "active",
        last_execution_at: null,
        user_id: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    log.mission.info("Created mission", {
      missionId: inserted.id,
      name: inserted.name,
      nextRun: nextRun.toISOString(),
    });

    return inserted;
  }),

  list: publicProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      let query = db.selectFrom("missions").selectAll().orderBy("created_at", "desc");
      if (input?.status) {
        query = query.where("status", "=", input.status);
      }
      return query.execute();
    }),

  get: publicProcedure.input(z.object({ mission_id: z.number() })).query(async ({ input }) => {
    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .selectAll()
      .where("id", "=", input.mission_id)
      .executeTakeFirst();

    if (!mission) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
    }

    return mission;
  }),

  update: publicProcedure.input(updateMissionInput).mutation(async ({ input }) => {
    const db = await getDb();
    const mission = await db
      .selectFrom("missions")
      .selectAll()
      .where("id", "=", input.mission_id)
      .executeTakeFirst();

    if (!mission) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
    }

    const updates: Record<string, unknown> = { updated_at: nowDate() };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.prompt !== undefined) updates.prompt = input.prompt;
    if (input.personality !== undefined) updates.personality = input.personality;
    if (input.allowed_tools !== undefined) updates.allowed_tools = toStringArray(input.allowed_tools);
    if (input.mcp_servers !== undefined) updates.mcp_servers = toStringArray(input.mcp_servers);
    if (input.plugins !== undefined) updates.plugins = toStringArray(input.plugins);
    if (input.thinking_budget !== undefined) updates.thinking_budget = input.thinking_budget;
    if (input.model !== undefined) updates.model = input.model;
    if (input.working_dir !== undefined) updates.working_dir = input.working_dir;
    if (input.sandbox_mode !== undefined) updates.sandbox_mode = input.sandbox_mode;
    if (input.sandbox_mount_type !== undefined) updates.sandbox_mount_type = input.sandbox_mount_type;
    if (input.sandbox_settings !== undefined) updates.sandbox_settings = input.sandbox_settings;
    if (input.run_once !== undefined) updates.run_once = input.run_once;

    if (input.schedule) {
      try {
        const scheduleResult = await parseSchedule(input.schedule);
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const updated = await db
      .updateTable("missions")
      .set(updates)
      .where("id", "=", input.mission_id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return updated;
  }),

  delete: publicProcedure
    .input(z.object({ mission_id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const mission = await db
        .selectFrom("missions")
        .select(["id", "name"])
        .where("id", "=", input.mission_id)
        .executeTakeFirst();

      if (!mission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      }

      await db.deleteFrom("missions").where("id", "=", input.mission_id).execute();

      log.mission.info("Deleted mission", { missionId: input.mission_id, name: mission.name });
      return { status: "deleted", id: input.mission_id };
    }),

  pause: publicProcedure
    .input(z.object({ mission_id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const updated = await db
        .updateTable("missions")
        .set({ status: "paused", updated_at: nowDate() })
        .where("id", "=", input.mission_id)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      }

      return updated;
    }),

  resume: publicProcedure
    .input(z.object({ mission_id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const mission = await db
        .selectFrom("missions")
        .selectAll()
        .where("id", "=", input.mission_id)
        .executeTakeFirst();

      if (!mission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      }

      let nextRun: Date;
      try {
        nextRun = getNextCronRun(mission.cron_expression, nowDate(), mission.timezone);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const updated = await db
        .updateTable("missions")
        .set({
          status: "active",
          next_execution_at: nextRun,
          updated_at: nowDate(),
        })
        .where("id", "=", input.mission_id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return updated;
    }),

  execute: publicProcedure
    .input(z.object({ mission_id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const mission = await db
        .selectFrom("missions")
        .selectAll()
        .where("id", "=", input.mission_id)
        .executeTakeFirst();

      if (!mission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      }

      const executor = getMissionExecutor();
      if (!executor) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Mission executor not available",
        });
      }

      void executor.execute(mission, "manual", "user").catch((error) => {
        log.mission.error("Manual execution failed", { missionId: input.mission_id, error: String(error) });
      });

      return { status: "triggered", mission_id: input.mission_id };
    }),

  executions: publicProcedure
    .input(z.object({ mission_id: z.number(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      const limit = input.limit ?? 50;

      const db = await getDb();
      const mission = await db
        .selectFrom("missions")
        .select(["id"])
        .where("id", "=", input.mission_id)
        .executeTakeFirst();

      if (!mission) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mission not found" });
      }

      const executions = await db
        .selectFrom("mission_executions")
        .selectAll()
        .where("mission_id", "=", input.mission_id)
        .orderBy("started_at", "desc")
        .limit(Math.max(1, limit))
        .execute();

      return executions;
    }),

  execution: publicProcedure
    .input(z.object({ mission_id: z.number(), execution_id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const execution = await db
        .selectFrom("mission_executions")
        .selectAll()
        .where("id", "=", input.execution_id)
        .executeTakeFirst();

      if (!execution || execution.mission_id !== input.mission_id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Execution not found" });
      }

      return execution;
    }),
});
