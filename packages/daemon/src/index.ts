import * as Sentry from "@sentry/bun";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { getDaemonUrlFromConfig, loadConfig } from "@dere/shared-config";

import { createApp } from "./app.js";
import { startAmbientMonitor } from "./ambient/monitor.js";
import { startEngagementKickoff } from "./engagement-kickoff.js";
import { initMissionRuntime } from "./missions/runtime.js";
import { startSessionSummaryLoop } from "./sessions/summary.js";
import { startEmotionLoop } from "./emotions/runtime.js";
import { startMemoryConsolidationLoop } from "./memory/consolidation.js";
import { startRecallEmbeddingLoop } from "./memory/embeddings.js";
import { startPresenceCleanupLoop } from "./routes/presence.js";
import { cleanupOrphanedSwarms } from "./swarm/index.js";
import { initEventHandlers } from "./event-handlers.js";
import { cleanupStaleTasks } from "./temporal/cleanup.js";
import { log } from "./logger.js";

// Sentry error tracking (optional)
const sentryDsn = process.env.DERE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV ?? "development",
  });
  log.daemon.info("Sentry initialized");
}

// PID file management
function getPidPath(): string {
  const dataDir =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "dere")
      : join(homedir(), ".local", "share", "dere");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return join(dataDir, "daemon.pid");
}

const pidPath = getPidPath();
writeFileSync(pidPath, String(process.pid));

function cleanup(): void {
  try {
    unlinkSync(pidPath);
  } catch {
    // ignore
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

function parsePortFromUrl(value: string): number | null {
  try {
    const url = new URL(value);
    const port = Number(url.port);
    if (!Number.isFinite(port)) {
      return null;
    }
    return port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function resolveDaemonPort(): Promise<number> {
  const config = await loadConfig();
  const daemonUrl = getDaemonUrlFromConfig(config);
  const port = parsePortFromUrl(daemonUrl);
  if (!port) {
    throw new Error(`daemon_url missing port: ${daemonUrl}`);
  }
  return port;
}

async function main(): Promise<void> {
  // Initialize event handlers before anything else
  initEventHandlers();

  const { app, websocket: agentWebsocket } = createApp();

  // Clean up any swarms that were running when daemon crashed
  await cleanupOrphanedSwarms().catch((error) => {
    log.swarm.warn("Orphan cleanup failed", { error: String(error) });
  });

  // Release tasks stuck in_progress from crashed workflows
  await cleanupStaleTasks().catch((error) => {
    log.ambient.warn("Stale task cleanup failed", { error: String(error) });
  });

  startAmbientMonitor().catch((error) => {
    log.ambient.warn("Failed to start ambient monitor", { error: String(error) });
  });

  // Engagement kickoff: agent-driven autonomous behavior
  startEngagementKickoff().catch((error) => {
    log.ambient.warn("Failed to start engagement kickoff", { error: String(error) });
  });

  initMissionRuntime();
  startSessionSummaryLoop();
  startEmotionLoop();
  startMemoryConsolidationLoop();
  startRecallEmbeddingLoop();
  startPresenceCleanupLoop();

  const port = await resolveDaemonPort();
  const udsPath = process.env.DERE_DAEMON_UDS;

  // TCP server
  Bun.serve({
    port,
    fetch: app.fetch,
    websocket: agentWebsocket,
  });
  log.daemon.info(`Listening on http://localhost:${port}`, { port });

  // UDS server (optional)
  if (udsPath) {
    try {
      if (existsSync(udsPath)) {
        unlinkSync(udsPath);
      }
      Bun.serve({
        unix: udsPath,
        fetch: app.fetch,
        websocket: agentWebsocket,
      });
      log.daemon.info(`Listening on unix:${udsPath}`, { udsPath });
    } catch (error) {
      log.daemon.error("Failed to start UDS server", { error: String(error) });
    }
  }
}

void main();
