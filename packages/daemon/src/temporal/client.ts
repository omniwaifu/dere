/**
 * Temporal client connection setup.
 *
 * Used by daemon to start/interact with workflows.
 * Worker uses NativeConnection instead.
 */

import { Client, Connection } from "@temporalio/client";

let cachedClient: Client | null = null;

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

export async function getTemporalClient(): Promise<Client> {
  if (cachedClient) {
    return cachedClient;
  }

  const connection = await Connection.connect({
    address: TEMPORAL_ADDRESS,
  });

  cachedClient = new Client({
    connection,
    namespace: TEMPORAL_NAMESPACE,
  });

  return cachedClient;
}

export async function closeTemporalClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.connection.close();
    cachedClient = null;
  }
}

export const TASK_QUEUES = {
  EXPLORATION: "dere-exploration",
  MISSIONS: "dere-missions",
  SWARM: "dere-swarm",
} as const;
