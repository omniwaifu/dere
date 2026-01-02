import { parse } from "@iarna/toml";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getConfigPath } from "@dere/shared-config";
import { RPCClient } from "./rpc_client.js";

type PersonalityConfig = {
  identity?: {
    archetype?: string;
    core_traits?: string[];
  };
  goals?: string[];
  standards?: string[];
};

function logDebug(message: string): void {
  try {
    appendFileSync("/tmp/dere_subagent_pre_start_debug.log", `${message}\n`);
  } catch {
    // ignore logging failures
  }
}

function getEmbeddedDir(): string {
  return (
    process.env.DERE_EMBEDDED_PERSONALITIES_DIR ??
    join(process.cwd(), "packages", "shared-assets", "personalities")
  );
}

function getUserDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? dirname(getConfigPath());
  return join(configDir, "personalities");
}

async function loadPersonalityConfig(name: string): Promise<PersonalityConfig | null> {
  const candidates = [join(getEmbeddedDir(), `${name}.toml`), join(getUserDir(), `${name}.toml`)];

  for (const path of candidates) {
    try {
      const text = await readFile(path, "utf-8");
      return parse(text) as PersonalityConfig;
    } catch {
      // try next path
    }
  }

  return null;
}

function formatPersonalityContext(
  personalityName: string,
  config: PersonalityConfig | null,
): string {
  if (!config) {
    return `[Personality: ${personalityName}]`;
  }

  const identity = config.identity ?? {};
  const goals = config.goals ?? [];
  const standards = config.standards ?? [];

  const contextParts: string[] = [`[Personality: ${personalityName}]`];

  if (identity.archetype) {
    contextParts.push(`Archetype: ${identity.archetype}`);
  }

  if (identity.core_traits?.length) {
    contextParts.push(`Core traits: ${identity.core_traits.join(", ")}`);
  }

  if (goals.length) {
    contextParts.push(`Goals: ${goals.slice(0, 3).join(", ")}`);
  }

  if (standards.length) {
    contextParts.push(`Standards: ${standards.slice(0, 3).join(", ")}`);
  }

  return contextParts.join("\n");
}

async function main(): Promise<void> {
  logDebug(`PreToolUse hook called with args: ${process.argv.join(" ")}`);

  try {
    const stdin = (await Bun.stdin.text()).trim();
    logDebug(`Stdin data: ${stdin}`);

    if (!stdin) {
      logDebug("No stdin data received");
      console.log(JSON.stringify({ permissionDecision: "allow" }));
      return;
    }

    const hookData = JSON.parse(stdin) as Record<string, unknown>;
    const toolName = typeof hookData.tool_name === "string" ? hookData.tool_name : "";

    if (toolName !== "Task") {
      logDebug(`Not a Task call (tool_name=${toolName}), skipping`);
      console.log(JSON.stringify({ permissionDecision: "allow" }));
      return;
    }

    const personalityEnv = process.env.DERE_PERSONALITY;
    if (!personalityEnv) {
      logDebug("Skipping - not a dere session (no DERE_PERSONALITY)");
      console.log(JSON.stringify({ permissionDecision: "allow" }));
      return;
    }

    const personality = personalityEnv.split(",")[0]?.trim() ?? "";
    const toolInput = (hookData.tool_input ?? {}) as Record<string, unknown>;
    const subagentType =
      typeof toolInput.subagent_type === "string" ? toolInput.subagent_type : "unknown";
    const description = typeof toolInput.description === "string" ? toolInput.description : "";
    const prompt = typeof toolInput.prompt === "string" ? toolInput.prompt : "";

    logDebug(`Subagent invocation detected: ${subagentType}`);
    logDebug(`Description: ${description}`);

    const config = await loadPersonalityConfig(personality);
    const personalityContext = formatPersonalityContext(personality, config);

    const enhancedPrompt = `${personalityContext}\n\n${prompt}\n\nRemember to maintain personality consistency throughout this subagent task.\n`;

    logDebug("Personality context injected into subagent prompt");

    try {
      const sessionId = Number.parseInt(process.env.DERE_SESSION_ID ?? "0", 10);
      if (sessionId > 0) {
        const rpc = new RPCClient();
        const rpcResult = await rpc.callMethod("log_subagent_start", {
          session_id: sessionId,
          personality,
          subagent_type: subagentType,
          description,
        });
        logDebug(`Logged subagent start to daemon: ${JSON.stringify(rpcResult)}`);
      }
    } catch (error) {
      logDebug(`Failed to log subagent start (non-fatal): ${String(error)}`);
    }

    const output = {
      permissionDecision: "allow",
      updatedInput: { prompt: enhancedPrompt },
    };

    console.log(JSON.stringify(output));
    logDebug("PreToolUse hook completed successfully");
  } catch (error) {
    logDebug(`Error in PreToolUse hook: ${String(error)}`);
    console.log(JSON.stringify({ permissionDecision: "allow" }));
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
