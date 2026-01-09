// Swarm execution helpers - most execution logic moved to Temporal workflows

import { getDb } from "../db.js";
import type { SwarmRow, SwarmAgentRow } from "./types.js";

/**
 * Get a swarm and all its agents by swarm ID.
 * Used by routes.ts for status queries.
 */
export async function getSwarmWithAgents(
  swarmId: number,
): Promise<{ swarm: SwarmRow; agents: SwarmAgentRow[] } | null> {
  const db = await getDb();
  const swarm = await db
    .selectFrom("swarms")
    .selectAll()
    .where("id", "=", swarmId)
    .executeTakeFirst();
  if (!swarm) {
    return null;
  }
  const agents = await db
    .selectFrom("swarm_agents")
    .selectAll()
    .where("swarm_id", "=", swarmId)
    .execute();
  return { swarm: swarm as SwarmRow, agents: agents as SwarmAgentRow[] };
}
