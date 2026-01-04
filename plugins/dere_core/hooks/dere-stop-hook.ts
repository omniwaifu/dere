import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { RPCClient } from "./rpc_client.js";

type TranscriptEntry = {
  type?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  };
};

function logDebug(message: string): void {
  try {
    appendFileSync("/tmp/dere_stop_hook_debug.log", `${message}\n`);
  } catch {
    // ignore logging failures
  }
}

async function readTranscript(transcriptPath: string): Promise<TranscriptEntry[]> {
  try {
    const data = await readFile(transcriptPath, "utf-8");
    const lines = data.split("\n");
    const entries: TranscriptEntry[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        entries.push(JSON.parse(trimmed) as TranscriptEntry);
      } catch {
        continue;
      }
    }

    return entries;
  } catch (error) {
    logDebug(`Error reading transcript: ${String(error)}`);
    return [];
  }
}

function extractClaudeResponse(entries: TranscriptEntry[]): string | null {
  try {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.type !== "assistant") {
        continue;
      }
      const message = entry.message;
      if (!message || message.role !== "assistant" || message.content == null) {
        continue;
      }

      const content = message.content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        const textParts = content
          .filter((item) => item?.type === "text")
          .map((item) => item.text ?? "")
          .filter(Boolean);
        return textParts.length ? textParts.join("\n") : null;
      }
    }
    return null;
  } catch (error) {
    logDebug(`Error extracting Claude response: ${String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  logDebug(`Stop hook called with args: ${process.argv.join(" ")}`);

  try {
    const stdin = (await Bun.stdin.text()).trim();
    logDebug(`Stop hook stdin data: ${stdin}`);

    if (!stdin) {
      logDebug("No stdin data received");
      return;
    }

    const hookData = JSON.parse(stdin) as Record<string, unknown>;

    const personality = process.env.DERE_PERSONALITY;
    if (!personality) {
      logDebug("Skipping - not a dere session (no DERE_PERSONALITY)");
      return;
    }

    const sessionId = Number.parseInt(process.env.DERE_SESSION_ID ?? "0", 10);
    const projectPath = process.env.PWD ?? "";
    const transcriptPath =
      typeof hookData.transcript_path === "string" ? hookData.transcript_path : "";

    if (!transcriptPath) {
      logDebug("No transcript path provided");
      return;
    }

    const transcriptEntries = await readTranscript(transcriptPath);
    if (!transcriptEntries.length) {
      logDebug("No transcript entries found");
      return;
    }

    const claudeResponse = extractClaudeResponse(transcriptEntries);
    if (!claudeResponse) {
      logDebug("No Claude response found in transcript");
      return;
    }

    logDebug(`Captured Claude response (length: ${claudeResponse.length})`);

    const rpc = new RPCClient();
    const result = await rpc.captureClaudeResponse(
      sessionId,
      personality,
      projectPath,
      claudeResponse,
    );

    logDebug(`RPC result for Claude response: ${JSON.stringify(result)}`);

    if (result) {
      logDebug("Claude response captured successfully");
    } else {
      logDebug("Failed to capture Claude response");
    }

    console.log(JSON.stringify({ suppressOutput: true }));
  } catch (error) {
    logDebug(`Error in stop hook: ${String(error)}`);
    console.log(JSON.stringify({ suppressOutput: true }));
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
