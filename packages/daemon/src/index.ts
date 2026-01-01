import * as Sentry from "@sentry/bun";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { createApp } from "./app.js";
import { startAmbientMonitor } from "./ambient-monitor.js";
import { initMissionRuntime } from "./mission-runtime.js";
import { startSessionSummaryLoop } from "./session-summary.js";
import { startEmotionLoop } from "./emotion-runtime.js";
import { startMemoryConsolidationLoop } from "./memory-consolidation.js";
import { startRecallEmbeddingLoop } from "./recall-embeddings.js";
import { startPresenceCleanupLoop } from "./presence.js";

// Sentry error tracking (optional)
const sentryDsn = process.env.DERE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV ?? "development",
  });
  console.log("[sentry] initialized");
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

const { app, websocket: agentWebsocket } = createApp();

startAmbientMonitor().catch((error) => {
  console.log(`[ambient] failed to start: ${String(error)}`);
});

initMissionRuntime();
startSessionSummaryLoop();
startEmotionLoop();
startMemoryConsolidationLoop();
startRecallEmbeddingLoop();
startPresenceCleanupLoop();

const port = Number(process.env.DERE_DAEMON_PORT ?? 3000);
const udsPath = process.env.DERE_DAEMON_UDS;

// TCP server
Bun.serve({
  port,
  fetch: app.fetch,
  websocket: agentWebsocket,
});
console.log(`[daemon] listening on http://localhost:${port}`);

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
    console.log(`[daemon] listening on unix:${udsPath}`);
  } catch (error) {
    console.error(`[daemon] failed to start UDS server: ${String(error)}`);
  }
}
