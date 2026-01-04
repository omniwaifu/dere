import { MissionExecutor } from "./mission-executor.js";
import { MissionScheduler } from "./mission-scheduler.js";

let executor: MissionExecutor | null = null;
let scheduler: MissionScheduler | null = null;

export function initMissionRuntime(): { executor: MissionExecutor; scheduler: MissionScheduler } {
  if (!executor) {
    executor = new MissionExecutor();
  }
  if (!scheduler) {
    scheduler = new MissionScheduler(executor);
    scheduler.start();
  }

  return { executor, scheduler };
}

export function getMissionExecutor(): MissionExecutor | null {
  return executor;
}

export function stopMissionRuntime(): void {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
}
