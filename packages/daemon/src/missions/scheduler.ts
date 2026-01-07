import { getDb } from "../db.js";
import { getNextCronRun } from "./schedule.js";
import { MissionExecutor } from "./executor.js";
import { log } from "../logger.js";

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
    log.missions.info("Scheduler started", { intervalMs: SCHEDULER_INTERVAL_MS });
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    log.missions.info("Scheduler stopped");
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      await this.checkDueMissions();
    } catch (error) {
      log.missions.error("Scheduler loop error", { error: String(error) });
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

    log.missions.info("Found due missions", { count: missions.length });

    for (const mission of missions) {
      try {
        await this.executor.execute(mission);
        await this.updateNextExecution(mission);
      } catch (error) {
        log.missions.error("Failed to execute mission", { missionId: mission.id, error: String(error) });
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
      log.missions.info("Archived one-off mission", { missionId: mission.id, name: mission.name });
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
      log.missions.warn("Failed to update next execution", { missionId: mission.id, error: String(error) });
    }
  }
}
