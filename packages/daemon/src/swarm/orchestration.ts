// Swarm orchestration - runSwarm, startSwarmExecution, cleanup

import { getDb } from "../db.js";
import { daemonEvents } from "../events.js";
import { log } from "../logger.js";
import { swarmState } from "./state.js";
import { STATUS, SwarmError, type SwarmAgentRow } from "./types.js";
import { nowDate, nowSeconds } from "./utils.js";
import { getSwarmWithAgents, executeAgentWithDependencies, getCompletionSignal } from "./execution.js";

async function updateSwarmCompletion(swarmId: number) {
  const db = await getDb();
  const swarm = await db
    .selectFrom("swarms")
    .selectAll()
    .where("id", "=", swarmId)
    .executeTakeFirst();
  if (!swarm) {
    return;
  }

  const agents = (await db
    .selectFrom("swarm_agents")
    .selectAll()
    .where("swarm_id", "=", swarmId)
    .execute()) as SwarmAgentRow[];

  const finalStatuses = new Set<string>([
    STATUS.COMPLETED,
    STATUS.FAILED,
    STATUS.CANCELLED,
    STATUS.SKIPPED,
    STATUS.TIMED_OUT,
  ]);
  const allDone = agents.every((agent) => finalStatuses.has(agent.status));
  if (!allDone) {
    return;
  }

  // Determine final swarm status based on agent outcomes
  // Priority: CANCELLED > TIMED_OUT > FAILED > COMPLETED
  let finalStatus: string = STATUS.COMPLETED;
  if (agents.some((agent) => agent.status === STATUS.FAILED)) {
    finalStatus = STATUS.FAILED;
  }
  if (agents.some((agent) => agent.status === STATUS.TIMED_OUT)) {
    // Timeout is a specific failure mode - use FAILED for the swarm
    // but we could also use a separate TIMED_OUT status if desired
    finalStatus = STATUS.FAILED;
  }
  if (agents.some((agent) => agent.status === STATUS.CANCELLED)) {
    finalStatus = STATUS.CANCELLED;
  }

  await db
    .updateTable("swarms")
    .set({
      status: finalStatus,
      completed_at: nowDate(),
    })
    .where("id", "=", swarmId)
    .execute();

  await queueMemoryConsolidation(swarmId, swarm.parent_session_id);
}

async function queueMemoryConsolidation(swarmId: number, parentSessionId: number | null) {
  try {
    const db = await getDb();
    let userId: string | null = null;
    if (parentSessionId) {
      const session = await db
        .selectFrom("sessions")
        .select(["user_id"])
        .where("id", "=", parentSessionId)
        .executeTakeFirst();
      userId = session?.user_id ?? null;
    }

    await db
      .insertInto("task_queue")
      .values({
        task_type: "memory_consolidation",
        model_name: "gemma3n:latest",
        content: `Memory consolidation after swarm ${swarmId}`,
        metadata: {
          user_id: userId,
          recency_days: 30,
          update_core_memory: false,
          trigger: "swarm",
          swarm_id: swarmId,
        },
        priority: 5,
        status: "pending",
        session_id: null,
        created_at: nowDate(),
        processed_at: null,
        retry_count: 0,
        error_message: null,
      })
      .execute();
  } catch (error) {
    log.swarm.warn("Failed to queue memory consolidation", { error: String(error) });
  }
}

export async function runSwarm(swarmId: number) {
  const { swarm, agents } = (await getSwarmWithAgents(swarmId)) ?? {};
  if (!swarm || !agents) {
    log.swarm.warn("Swarm not found or has no agents", { swarmId });
    return;
  }

  log.swarm.info("Starting swarm execution", {
    swarmId,
    name: swarm.name,
    agentCount: agents.length,
  });

  // Emit swarm start event
  daemonEvents.emit("swarm:start", {
    swarmId,
    name: swarm.name,
    workingDir: swarm.working_dir,
    agentCount: agents.length,
  });

  const pendingAgents = agents.filter((agent) => agent.status === STATUS.PENDING);

  // Track all agent promises for error handling
  const agentPromises: Array<{ agentId: number; agentName: string; promise: Promise<void> }> = [];

  for (const agent of pendingAgents) {
    const task = executeAgentWithDependencies(swarmId, agent);
    swarmState.trackAgent(agent.id, task);

    // Wrap each task with error handling to catch unhandled rejections
    const wrappedTask = task.catch((error) => {
      // Log the error - agent should already be marked as failed by executeAgentWithDependencies
      if (error instanceof SwarmError) {
        log.swarm.error(`Agent task rejected`, error.toLogContext());
      } else {
        log.swarm.error(`Agent task rejected with unhandled error`, {
          swarmId,
          agentId: agent.id,
          agentName: agent.name,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      // Don't re-throw - we want all agents to complete or fail independently
    });

    agentPromises.push({ agentId: agent.id, agentName: agent.name, promise: wrappedTask });
  }

  // Wait for all agents to complete (either successfully or with failure)
  for (const agent of pendingAgents) {
    const signal = getCompletionSignal(swarmId, agent.id);
    await signal.promise;
  }

  // Also await all promises to ensure error handlers have run
  await Promise.allSettled(agentPromises.map((a) => a.promise));

  try {
    await updateSwarmCompletion(swarmId);
  } catch (error) {
    log.swarm.error("Failed to update swarm completion status", {
      swarmId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Emit swarm end event
  try {
    const finalAgents = await getDb().then((db) =>
      db
        .selectFrom("swarm_agents")
        .select(["name", "status", "output_text"])
        .where("swarm_id", "=", swarmId)
        .execute(),
    );
    const finalSwarm = await getDb().then((db) =>
      db.selectFrom("swarms").select("status").where("id", "=", swarmId).executeTakeFirst(),
    );
    daemonEvents.emit("swarm:end", {
      swarmId,
      status: (finalSwarm?.status ?? "failed") as "completed" | "failed" | "cancelled",
      agentResults: finalAgents.map((a) => ({
        name: a.name,
        status: a.status ?? "unknown",
        hasOutput: !!a.output_text,
      })),
    });
  } catch (error) {
    log.swarm.error("Failed to emit swarm end event", {
      swarmId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Emit a minimal end event so listeners don't hang
    daemonEvents.emit("swarm:end", {
      swarmId,
      status: "failed",
      agentResults: [],
    });
  }

  log.swarm.info("Swarm execution completed", { swarmId });
}

/**
 * Start swarm execution.
 * @param swarmId - The swarm to execute
 * @param alreadyMarkedStarting - If true, caller has already called markStarting() and we skip that check
 */
export async function startSwarmExecution(
  swarmId: number,
  alreadyMarkedStarting = false,
): Promise<void> {
  // Atomic check: already running or already starting
  // Skip if caller already marked the swarm as starting (e.g., route handler)
  if (!alreadyMarkedStarting && !swarmState.markStarting(swarmId)) {
    log.swarm.debug("Swarm already running or starting, skipping", { swarmId });
    return;
  }

  // Create the promise wrapper with comprehensive error handling
  const promise = (async () => {
    try {
      await runSwarm(swarmId);
    } catch (error) {
      // Catch any unhandled errors from runSwarm to ensure we can clean up
      if (error instanceof SwarmError) {
        log.swarm.error("Swarm execution failed", error.toLogContext());
      } else {
        log.swarm.error("Swarm execution failed with unexpected error", {
          swarmId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      // Attempt to mark swarm as failed in database
      try {
        const db = await getDb();
        await db
          .updateTable("swarms")
          .set({
            status: STATUS.FAILED,
            completed_at: nowDate(),
          })
          .where("id", "=", swarmId)
          .where("status", "=", STATUS.RUNNING)
          .execute();
      } catch (dbError) {
        log.swarm.error("Failed to update swarm status after error", {
          swarmId,
          dbError: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
    } finally {
      swarmState.cleanupSwarm(swarmId);
    }
  })();

  // Register the run - this transitions from "starting" to "running" state
  // Must happen synchronously after markStarting to avoid race windows
  swarmState.registerRun(swarmId, promise);

  // Attach unhandled rejection handler to the promise
  promise.catch((error) => {
    // This should never be reached due to the try/catch in the async IIFE above
    // But just in case, log it to prevent unhandled promise rejection
    log.swarm.error("Unhandled swarm promise rejection (should not happen)", {
      swarmId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

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
