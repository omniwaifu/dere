/**
 * Temporal worker setup.
 *
 * Runs locally, polls task queues, executes workflows and activities.
 * Uses bundleWorkflowCode for ESM/Bun compatibility.
 *
 * Run with: bun packages/daemon/src/temporal/worker.ts
 * Or via justfile: just temporal-worker
 */

import { NativeConnection, Worker, bundleWorkflowCode } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as activities from "./activities/index.js";
import { TASK_QUEUES } from "./client.js";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run(): Promise<void> {
  console.log(`Connecting to Temporal at ${TEMPORAL_ADDRESS}...`);

  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  try {
    // Bundle workflows at startup (required for ESM)
    // Use .ts extension - bundler handles TypeScript via esbuild
    console.log("Bundling workflows...");
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: resolve(__dirname, "./workflows/index.ts"),
    });

    console.log(`Starting worker on task queue: ${TASK_QUEUES.EXPLORATION}`);
    const worker = await Worker.create({
      connection,
      namespace: TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUES.EXPLORATION,
      workflowBundle,
      activities,
      // Concurrency limits
      maxConcurrentActivityTaskExecutions: 5,
      maxConcurrentWorkflowTaskExecutions: 10,
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log("Shutting down worker...");
      await worker.shutdown();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log("Worker running. Press Ctrl+C to stop.");
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
