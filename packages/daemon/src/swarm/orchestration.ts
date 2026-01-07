// Swarm orchestration - runSwarm, startSwarmExecution, cleanup

import { getDb } from "../db.js";
import { daemonEvents } from "../events.js";
import { log } from "../logger.js";
import { swarmState } from "./state.js";
import { STATUS, type SwarmAgentRow } from "./types.js";
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
  ]);
  const allDone = agents.every((agent) => finalStatuses.has(agent.status));
  if (!allDone) {
    return;
  }

  let finalStatus: string = STATUS.COMPLETED;
  if (agents.some((agent) => agent.status === STATUS.FAILED)) {
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
    return;
  }

  // Emit swarm start event
  daemonEvents.emit("swarm:start", {
    swarmId,
    name: swarm.name,
    workingDir: swarm.working_dir,
    agentCount: agents.length,
  });

  const pendingAgents = agents.filter((agent) => agent.status === STATUS.PENDING);
  for (const agent of pendingAgents) {
    const task = executeAgentWithDependencies(swarmId, agent);
    swarmState.trackAgent(agent.id, task);
  }

  for (const agent of pendingAgents) {
    const signal = getCompletionSignal(swarmId, agent.id);
    await signal.promise;
  }

  await updateSwarmCompletion(swarmId);

  // Emit swarm end event
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
}

export async function startSwarmExecution(swarmId: number): Promise<void> {
  // Atomic check: already running or already starting
  if (!swarmState.markStarting(swarmId)) {
    return;
  }

  try {
    const promise = (async () => {
      try {
        await runSwarm(swarmId);
      } finally {
        swarmState.cleanupSwarm(swarmId);
      }
    })();
    swarmState.registerRun(swarmId, promise);
  } catch {
    swarmState.clearStarting(swarmId);
  }
}

/**
 * Clean up orphaned swarms that were RUNNING when the daemon crashed/restarted.
 * Called on daemon startup.
 */
export async function cleanupOrphanedSwarms(): Promise<void> {
  const db = await getDb();

  // Find swarms that were RUNNING when daemon died
  const orphanedSwarms = await db
    .selectFrom("swarms")
    .select(["id", "name"])
    .where("status", "=", STATUS.RUNNING)
    .execute();

  if (orphanedSwarms.length === 0) {
    return;
  }

  log.swarm.info("Found orphaned swarms from previous run", { count: orphanedSwarms.length });

  for (const swarm of orphanedSwarms) {
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
    });
  }

  log.swarm.info("Orphan cleanup complete");
}
