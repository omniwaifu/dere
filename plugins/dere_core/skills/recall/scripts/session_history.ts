import { getDaemonUrl } from "../../../scripts/config_reader.js";

async function getSessionHistory(sessionId: number): Promise<Record<string, unknown> | null> {
  const daemonUrl = await getDaemonUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${daemonUrl}/sessions/${sessionId}/history`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`Error getting session history: ${response.status} ${response.statusText}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error(`Error getting session history: ${String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const sessionIdArg = process.argv[2];
  if (!sessionIdArg) {
    console.error("Usage: session_history.ts <session_id>");
    process.exit(1);
  }

  const sessionId = Number.parseInt(sessionIdArg, 10);
  if (!Number.isFinite(sessionId)) {
    console.error("Error: session_id must be an integer");
    process.exit(1);
  }

  const result = await getSessionHistory(sessionId);
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
