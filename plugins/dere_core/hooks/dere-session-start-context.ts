import { appendFileSync } from "node:fs";
import { stat } from "node:fs/promises";

import { daemonRequest } from "../lib/daemon-client.ts";

const DEFAULT_CONTEXT_TIMEOUT_MS = 10_000;

function logError(message: string): void {
  try {
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
    appendFileSync("/tmp/dere_session_context_hook.log", `[${timestamp}] ${message}\n`);
  } catch {
    // ignore logging failures
  }
}

async function isValidDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function getSessionStartContext(args: {
  sessionId: number;
  userId: string;
  workingDir?: string | null;
  medium?: string | null;
}): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = {
      session_id: args.sessionId,
      user_id: args.userId,
    };
    if (args.workingDir) {
      payload.working_dir = args.workingDir;
    }
    if (args.medium) {
      payload.medium = args.medium;
    }

    const { status, data } = await daemonRequest<{
      status?: string;
      context?: string;
    }>({
      path: "/context/build_session_start",
      method: "POST",
      body: payload,
      timeoutMs: DEFAULT_CONTEXT_TIMEOUT_MS,
    });

    if (status < 200 || status >= 300) {
      logError(`Failed to get session-start context from daemon: ${status}`);
      return null;
    }

    if (data?.status === "ready" || data?.status === "cached") {
      return data.context ?? null;
    }

    logError(`Session-start context not ready: ${String(data?.status ?? "unknown")}`);
    return null;
  } catch (error) {
    logError(`Failed to get session-start context from daemon: ${String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  let stdinJson: Record<string, unknown> | null = null;
  try {
    const stdin = await Bun.stdin.text();
    if (!stdin) {
      return;
    }
    stdinJson = JSON.parse(stdin) as Record<string, unknown>;
  } catch (error) {
    logError(`Error reading input: ${String(error)}`);
    return;
  }

  try {
    const sessionIdValue = Number.parseInt(process.env.DERE_SESSION_ID ?? "", 10);
    const userId = process.env.USER ?? process.env.USERNAME ?? "default";

    if (!Number.isFinite(sessionIdValue)) {
      logError("No DERE_SESSION_ID environment variable, skipping session-start context");
      console.log(JSON.stringify({ suppressOutput: true }));
      return;
    }

    const sessionId = sessionIdValue;
    const workingDirEnv = process.env.PWD;
    const stdinCwd = typeof stdinJson?.cwd === "string" ? stdinJson.cwd : undefined;
    let workingDir = workingDirEnv ?? stdinCwd ?? null;
    const medium = typeof stdinJson?.medium === "string" ? stdinJson.medium : "cli";

    if (workingDir && !(await isValidDirectory(workingDir))) {
      logError(`Working dir ${workingDir} is not a directory, ignoring`);
      workingDir = null;
    }

    const contextStr = await getSessionStartContext({
      sessionId,
      userId,
      workingDir,
      medium,
    });

    if (contextStr && contextStr.trim()) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: `\n${contextStr}\n`,
        },
        suppressOutput: true,
      };
      logError(`Injected session-start context for session ${sessionId}`);
      console.log(JSON.stringify(output));
      return;
    }

    console.log(JSON.stringify({ suppressOutput: true }));
  } catch (error) {
    logError(`Session-start context error: ${String(error)}`);
    console.log(JSON.stringify({ suppressOutput: true }));
  }
}

if (import.meta.main) {
  main().catch((error) => {
    logError(`Fatal session-start hook error: ${String(error)}`);
  });
}
