// Swarm orchestration - cleanup only (execution moved to Temporal)

import { getDb } from "../db.js";
import { log } from "../logger.js";
import { STATUS, type SwarmAgentRow } from "./types.js";
import { nowDate, nowSeconds } from "./utils.js";

/**
 * Clean up orphaned swarms that were RUNNING when the daemon crashed/restarted.
 * Called on daemon startup.
 */
export async function cleanupOrphanedSwarms(): Promise<void> {
  let db;
  try {
    db = await getDb();
  } catch (error) {
    log.swarm.error("Failed to get database connection for orphan cleanup", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // Find swarms that were RUNNING when daemon died
  let orphanedSwarms;
  try {
    orphanedSwarms = await db
      .selectFrom("swarms")
      .select(["id", "name"])
      .where("status", "=", STATUS.RUNNING)
      .execute();
  } catch (error) {
    log.swarm.error("Failed to query for orphaned swarms", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (orphanedSwarms.length === 0) {
    return;
  }

  log.swarm.info("Found orphaned swarms from previous run", { count: orphanedSwarms.length });

  let cleanedCount = 0;
  let failedCount = 0;

  for (const swarm of orphanedSwarms) {
    try {
      log.swarm.info("Cleaning up orphaned swarm", { swarmId: swarm.id, name: swarm.name });

      // Use transaction to ensure all cleanup operations succeed or fail together
      await db.transaction().execute(async (trx) => {
        const now = nowDate();

        // Mark swarm as failed
        await trx
          .updateTable("swarms")
          .set({ status: STATUS.FAILED, completed_at: now })
          .where("id", "=", swarm.id)
          .execute();

        // Mark running/pending agents as failed
        await trx
          .updateTable("swarm_agents")
          .set({
            status: STATUS.FAILED,
            completed_at: now,
            error_message: "Daemon restarted during execution",
          })
          .where("swarm_id", "=", swarm.id)
          .where("status", "in", [STATUS.PENDING, STATUS.RUNNING])
          .execute();

        // Close any open sessions for this swarm's agents
        await trx
          .updateTable("sessions")
          .set({ end_time: nowSeconds(), is_locked: true })
          .where("id", "in", (qb) =>
            qb
              .selectFrom("swarm_agents")
              .select("session_id")
              .where("swarm_id", "=", swarm.id)
              .where("session_id", "is not", null),
          )
          .where("end_time", "is", null)
          .execute();

        // Release any tasks claimed by agents in this swarm (autonomous agents)
        await trx
          .updateTable("project_tasks")
          .set({
            status: "ready",
            claimed_by_agent_id: null,
            claimed_at: null,
            last_error: "Daemon restarted while task was claimed",
            updated_at: now,
          })
          .where("claimed_by_agent_id", "in", (qb) =>
            qb
              .selectFrom("swarm_agents")
              .select("id")
              .where("swarm_id", "=", swarm.id),
          )
          .where("status", "=", "claimed")
          .execute();
      });

      cleanedCount++;
    } catch (error) {
      failedCount++;
      log.swarm.error("Failed to clean up orphaned swarm", {
        swarmId: swarm.id,
        name: swarm.name,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with other swarms - don't let one failure stop the whole cleanup
    }
  }

  log.swarm.info("Orphan cleanup complete", { cleanedCount, failedCount });
}
