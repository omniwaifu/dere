import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Simple TOML parser for personality files.
 * Only extracts [prompt].content - not a full TOML parser.
 */
function parsePersonalityToml(text: string): { prompt?: { content?: string } } {
  const lines = text.split("\n");
  let inPromptSection = false;
  let inMultilineString = false;
  let multilineContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Section headers
    if (trimmed === "[prompt]") {
      inPromptSection = true;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inPromptSection && inMultilineString) {
        // End of prompt section while in multiline - close it
        return { prompt: { content: multilineContent.join("\n") } };
      }
      inPromptSection = false;
      continue;
    }

    if (!inPromptSection) continue;

    // Look for content = """
    if (!inMultilineString && trimmed.startsWith("content")) {
      const match = trimmed.match(/^content\s*=\s*"""(.*)$/);
      if (match) {
        inMultilineString = true;
        if (match[1]) multilineContent.push(match[1]);
        continue;
      }
      // Single line: content = "value"
      const singleMatch = trimmed.match(/^content\s*=\s*"([^"]*)"$/);
      if (singleMatch) {
        return { prompt: { content: singleMatch[1] } };
      }
    }

    // Inside multiline string
    if (inMultilineString) {
      if (trimmed.endsWith('"""')) {
        // End of multiline
        const withoutClose = trimmed.slice(0, -3);
        if (withoutClose) multilineContent.push(withoutClose);
        return { prompt: { content: multilineContent.join("\n") } };
      }
      multilineContent.push(line); // Preserve original indentation
    }
  }

  // If we finished in multiline mode, return what we have
  if (inMultilineString && multilineContent.length > 0) {
    return { prompt: { content: multilineContent.join("\n") } };
  }

  return {};
}

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
  // Inline config path logic to avoid @dere/shared-config dependency
  const configDir =
    process.env.CLAUDE_CONFIG_DIR ??
    process.env.XDG_CONFIG_HOME ??
    join(homedir(), ".config", "dere");
  return join(configDir, "personalities");
}

async function loadPersonalityPrompt(name: string): Promise<string | null> {
  const userPath = join(getUserDir(), `${name}.toml`);
  try {
    const text = await readFile(userPath, "utf-8");
    const parsed = parsePersonalityToml(text);
    return parsed.prompt?.content ?? null;
  } catch {
    // fall through to embedded
  }

  const embeddedPath = join(getEmbeddedDir(), `${name}.toml`);
  try {
    const text = await readFile(embeddedPath, "utf-8");
    const parsed = parsePersonalityToml(text);
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
