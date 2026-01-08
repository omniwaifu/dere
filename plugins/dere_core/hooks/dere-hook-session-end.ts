import { appendFileSync } from "node:fs";

import { RPCClient } from "./rpc_client.js";

function logDebug(message: string): void {
  try {
    appendFileSync("/tmp/dere_session_end_debug.log", `${message}\n`);
  } catch {
    // ignore logging failures
  }
}

async function main(): Promise<void> {
  const timestamp = new Date().toLocaleString();
  logDebug(`\n--- Session End Hook called at ${timestamp} ---`);

  // Not a dere session - exit silently
  const sessionId = Number.parseInt(process.env.DERE_SESSION_ID ?? "0", 10);
  if (!sessionId || !process.env.DERE_PERSONALITY) {
    logDebug("Not a dere session, skipping");
    console.log(JSON.stringify({ suppressOutput: true }));
    return;
  }

  try {
    const stdin = await Bun.stdin.text();
    const data = JSON.parse(stdin) as Record<string, unknown>;
    logDebug(`Received JSON: ${JSON.stringify(data)}`);

    const exitReason = typeof data.reason === "string" ? data.reason : "normal";

    logDebug(`Using DERE_SESSION_ID: ${sessionId}`);
    logDebug(`Exit reason: ${exitReason}`);

    const rpc = new RPCClient();
    const result = await rpc.endSession(sessionId, exitReason);

    logDebug(`RPC result: ${JSON.stringify(result)}`);

    console.log(JSON.stringify({ suppressOutput: true }));

    if (!result) {
      // Daemon unavailable - fail silently, don't clutter output
      logDebug("Daemon unavailable, exiting silently");
    }
  } catch (error) {
    // Fail silently - don't show errors to user for optional daemon features
    logDebug(`Error: ${String(error)}`);
    console.log(JSON.stringify({ suppressOutput: true }));
  }
}

if (import.meta.main) {
  void main();
}
