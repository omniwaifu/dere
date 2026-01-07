import { MissionExecutor } from "./executor.js";
import { MissionScheduler } from "./scheduler.js";

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
