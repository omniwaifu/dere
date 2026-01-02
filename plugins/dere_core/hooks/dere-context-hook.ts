import { appendFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { daemonRequest } from "@dere/shared-runtime";

const DEFAULT_DOCS_TIMEOUT_MS = 10_000;
const DEFAULT_CONTEXT_TIMEOUT_MS = 5_000;

function logError(message: string): void {
  try {
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
    appendFileSync("/tmp/dere_context_hook.log", `[${timestamp}] ${message}\n`);
  } catch {
    // ignore logging failures
  }
}

async function loadInitialDocuments(sessionId: number | null): Promise<void> {
  if (!sessionId) {
    return;
  }

  const stateFile = `/tmp/dere_docs_loaded_${sessionId}`;
  if (existsSync(stateFile)) {
    return;
  }

  const withDocs = process.env.DERE_WITH_DOCS ?? "";
  const withTags = process.env.DERE_WITH_TAGS ?? "";

  if (!withDocs && !withTags) {
    return;
  }

  const requestData: Record<string, unknown> = {};
  if (withDocs) {
    const docIds = withDocs
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    if (docIds.length) {
      requestData.doc_ids = docIds;
    }
  }
  if (withTags) {
    const tags = withTags
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (tags.length) {
      requestData.tags = tags;
    }
  }

  if (!Object.keys(requestData).length) {
    return;
  }

  try {
    const userId = process.env.USER ?? process.env.USERNAME ?? "default";
    const { status } = await daemonRequest({
      path: `/sessions/${sessionId}/documents/load`,
      method: "POST",
      query: { user_id: userId },
      body: requestData,
      timeoutMs: DEFAULT_DOCS_TIMEOUT_MS,
    });

    if (status < 200 || status >= 300) {
      logError(`Failed to load initial documents: ${status}`);
      return;
    }

    await writeFile(stateFile, "");
    logError(`Loaded documents for session ${sessionId}: ${JSON.stringify(requestData)}`);
  } catch (error) {
    logError(`Failed to load initial documents: ${String(error)}`);
  }
}

async function getContextFromDaemon(sessionId: number | null): Promise<string | null> {
  try {
    const { status, data } = await daemonRequest<{ context?: string }>({
      path: "/context",
      method: "GET",
      query: sessionId ? { session_id: sessionId } : undefined,
      timeoutMs: DEFAULT_CONTEXT_TIMEOUT_MS,
    });

    if (status < 200 || status >= 300) {
      logError(`Failed to get context from daemon: ${status}`);
      return null;
    }

    return data?.context ?? null;
  } catch (error) {
    logError(`Failed to get context from daemon: ${String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  try {
    const stdin = await Bun.stdin.text();
    if (!stdin) {
      return;
    }
    JSON.parse(stdin);
  } catch (error) {
    logError(`Error reading input: ${String(error)}`);
    return;
  }

  try {
    const sessionId = Number.parseInt(process.env.DERE_SESSION_ID ?? "", 10);
    const sessionIdValue = Number.isFinite(sessionId) ? sessionId : null;

    await loadInitialDocuments(sessionIdValue);

    const contextStr = await getContextFromDaemon(sessionIdValue);
    if (contextStr) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `\n${contextStr}\n`,
        },
        suppressOutput: true,
      };
      console.log(JSON.stringify(output));
      return;
    }

    console.log(JSON.stringify({ suppressOutput: true }));
  } catch (error) {
    logError(`Context gathering error: ${String(error)}`);
    console.log(JSON.stringify({ suppressOutput: true }));
  }
}

if (import.meta.main) {
  main().catch((error) => {
    logError(`Fatal context hook error: ${String(error)}`);
  });
}
