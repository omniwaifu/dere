import { getDb } from "./db.js";
import { getNextCronRun } from "./mission-schedule.js";
import { MissionExecutor } from "./mission-executor.js";

const SCHEDULER_INTERVAL_MS = 60_000;

type MissionRow = {
  id: number;
  name: string;
  cron_expression: string;
  timezone: string;
  status: string;
  next_execution_at: Date | null;
  last_execution_at: Date | null;
  run_once: boolean;
};

export class MissionScheduler {
  private readonly executor: MissionExecutor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(executor: MissionExecutor) {
    this.executor = executor;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, SCHEDULER_INTERVAL_MS);
    console.log(`[missions] scheduler started (interval=${SCHEDULER_INTERVAL_MS}ms)`);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    console.log("[missions] scheduler stopped");
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      await this.checkDueMissions();
    } catch (error) {
      console.log(`[missions] scheduler loop error: ${String(error)}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async checkDueMissions(): Promise<void> {
    const now = new Date();
    const db = await getDb();
    const missions = await db
      .selectFrom("missions")
      .selectAll()
      .where("status", "=", "active")
      .where("next_execution_at", "<=", now)
      .execute();

    if (missions.length === 0) {
      return;
    }

    console.log(`[missions] found ${missions.length} due mission(s)`);

    for (const mission of missions) {
      try {
        await this.executor.execute(mission);
        await this.updateNextExecution(mission);
      } catch (error) {
        console.log(`[missions] failed to execute mission ${mission.id}: ${String(error)}`);
      }
    }
  }

  private async updateNextExecution(mission: MissionRow): Promise<void> {
    const db = await getDb();
    const now = new Date();

    if (mission.run_once) {
      await db
        .updateTable("missions")
        .set({
          status: "archived",
          next_execution_at: null,
          last_execution_at: now,
          updated_at: now,
        })
        .where("id", "=", mission.id)
        .execute();
      console.log(`[missions] archived one-off mission ${mission.id} (${mission.name})`);
      return;
    }

    try {
      const nextRun = getNextCronRun(mission.cron_expression, now, mission.timezone);
      await db
        .updateTable("missions")
        .set({
          next_execution_at: nextRun,
          last_execution_at: now,
          updated_at: now,
        })
        .where("id", "=", mission.id)
        .execute();
    } catch (error) {
      console.log(
        `[missions] failed to update next execution for mission ${mission.id}: ${String(error)}`,
      );
    }
  }
}
