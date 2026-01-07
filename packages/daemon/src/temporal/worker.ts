/**
 * Temporal worker setup.
 *
 * Runs locally, polls task queues, executes workflows and activities.
 * Uses bundleWorkflowCode for ESM/Bun compatibility.
 *
 * Run with: bun packages/daemon/src/temporal/worker.ts
 * Or via justfile: just temporal-worker
 *
 * Environment variables:
 * - TEMPORAL_ADDRESS: Temporal server address (default: localhost:7233)
 * - TEMPORAL_NAMESPACE: Temporal namespace (default: default)
 * - TEMPORAL_TASK_QUEUE: Which queue(s) to poll. Options:
 *   - "exploration" - exploration workflows only
 *   - "swarm" - swarm workflows only
 *   - "all" (default) - poll all queues (runs multiple workers)
 */

import { NativeConnection, Worker, bundleWorkflowCode } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as activities from "./activities/index.js";
import { TASK_QUEUES } from "./client.js";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const TASK_QUEUE_MODE = process.env.TEMPORAL_TASK_QUEUE ?? "all";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getTaskQueues(): string[] {
  switch (TASK_QUEUE_MODE.toLowerCase()) {
    case "exploration":
      return [TASK_QUEUES.EXPLORATION];
    case "swarm":
      return [TASK_QUEUES.SWARM];
    case "all":
    default:
      return [TASK_QUEUES.EXPLORATION, TASK_QUEUES.SWARM];
  }
}

async function run(): Promise<void> {
  console.log(`Connecting to Temporal at ${TEMPORAL_ADDRESS}...`);

  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const taskQueues = getTaskQueues();
  const workers: Worker[] = [];

  try {
    // Bundle workflows at startup (required for ESM)
    // Use .ts extension - bundler handles TypeScript via esbuild
    console.log("Bundling workflows...");
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: resolve(__dirname, "./workflows/index.ts"),
    });

    // Create a worker for each task queue
    for (const taskQueue of taskQueues) {
      console.log(`Starting worker on task queue: ${taskQueue}`);
      const worker = await Worker.create({
        connection,
        namespace: TEMPORAL_NAMESPACE,
        taskQueue,
        workflowBundle,
        activities,
        // Concurrency limits
        maxConcurrentActivityTaskExecutions: 5,
        maxConcurrentWorkflowTaskExecutions: 10,
      });
      workers.push(worker);
    }

    // Graceful shutdown
    const shutdown = async () => {
      console.log("Shutting down workers...");
      await Promise.all(workers.map((w) => w.shutdown()));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(`Workers running on queues: ${taskQueues.join(", ")}. Press Ctrl+C to stop.`);

    // Run all workers concurrently
    await Promise.all(workers.map((w) => w.run()));
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
