import { parse } from "@iarna/toml";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getConfigPath } from "@dere/shared-config";

type PersonalityDoc = {
  prompt?: {
    content?: string;
  };
};

function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

function getCompressedReminder(prompt: string): string {
  const lines = prompt.trim().split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.includes(".")) {
      return `${line.split(".")[0]}.`;
    }
    return line.slice(0, 100);
  }
  return prompt.slice(0, 50);
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

async function loadPersonalityPrompt(name: string): Promise<string | null> {
  const userPath = join(getUserDir(), `${name}.toml`);
  try {
    const text = await readFile(userPath, "utf-8");
    const parsed = parse(text) as PersonalityDoc;
    return parsed.prompt?.content ?? null;
  } catch {
    // fall through to embedded
  }

  const embeddedPath = join(getEmbeddedDir(), `${name}.toml`);
  try {
    const text = await readFile(embeddedPath, "utf-8");
    const parsed = parse(text) as PersonalityDoc;
    return parsed.prompt?.content ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  try {
    const hookInput = JSON.parse(await Bun.stdin.text()) as Record<string, unknown>;

    const personalityEnv = process.env.DERE_PERSONALITY;
    if (!personalityEnv) {
      console.log(JSON.stringify({}));
      return;
    }

    const toolName = typeof hookInput.tool_name === "string" ? hookInput.tool_name : "";
    const toolResult = hookInput.tool_result ?? "";
    const highOutputTools = new Set(["Read", "Bash", "Grep"]);

    if (!highOutputTools.has(toolName)) {
      console.log(JSON.stringify({}));
      return;
    }

    const outputTokens = estimateTokens(String(toolResult));
    if (outputTokens < 500) {
      console.log(JSON.stringify({}));
      return;
    }

    const personalityName = personalityEnv.split(",")[0]?.trim() ?? "";
    if (!personalityName) {
      console.log(JSON.stringify({}));
      return;
    }

    const promptContent = await loadPersonalityPrompt(personalityName);
    if (!promptContent) {
      console.log(JSON.stringify({}));
      return;
    }

    const compressed = getCompressedReminder(promptContent);
    console.log(JSON.stringify({ additionalContext: compressed }));
  } catch {
    console.log(JSON.stringify({}));
  }
}

if (import.meta.main) {
  void main();
}
