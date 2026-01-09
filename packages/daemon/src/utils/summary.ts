/**
 * Shared summary generation utility.
 *
 * Consolidates the 4 separate generateSummary implementations:
 * - trpc/procedures/sessions.ts
 * - missions/executor.ts
 * - sessions/index.ts
 * - swarm/agent-query.ts
 */

import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";

import { log } from "../logger.js";

/** Default model for summary generation */
export const SUMMARY_MODEL = "claude-haiku-4-5";

/** Minimum text length before summary is generated */
export const SUMMARY_THRESHOLD = 1000;

/** Maximum context to send to the model (chars) */
const MAX_CONTEXT = 2000;

/** Working directory for Claude Agent SDK sessions */
const LLM_CWD = process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions";

let cachedClient: TextResponseClient | null = null;

function getClient(model?: string): TextResponseClient {
  // Return cached client if model matches or no model specified
  if (cachedClient && !model) {
    return cachedClient;
  }

  const transport = new ClaudeAgentTransport({
    workingDirectory: LLM_CWD,
  });

  const client = new TextResponseClient({
    transport,
    model: model ?? SUMMARY_MODEL,
  });

  if (!model) {
    cachedClient = client;
  }

  return client;
}

export interface GenerateSummaryOptions {
  /** Override the default model */
  model?: string;
  /** Custom prompt prefix (default: "Summarize this output in 1-2 sentences...") */
  promptPrefix?: string;
  /** Skip threshold check and always attempt summary */
  skipThresholdCheck?: boolean;
  /** Logger category for warnings (default: "summary") */
  logCategory?: "swarm" | "mission" | "session" | "summary";
}

/**
 * Generate a summary of the given text using an LLM.
 *
 * Features:
 * - Skips if text is below SUMMARY_THRESHOLD (unless skipThresholdCheck)
 * - Respects DERE_DISABLE_SUMMARY env var
 * - Smart truncation: if text > 4000 chars, uses first/last 2000 with [...] separator
 * - Configurable model via options or env vars
 *
 * @param text - The text to summarize
 * @param options - Optional configuration
 * @returns Summary string, or null if skipped/failed
 */
export async function generateSummary(
  text: string,
  options: GenerateSummaryOptions = {},
): Promise<string | null> {
  // Global disable check
  if (process.env.DERE_DISABLE_SUMMARY === "1") {
    return null;
  }

  // Threshold check
  if (!options.skipThresholdCheck && text.length < SUMMARY_THRESHOLD) {
    return null;
  }

  // Model resolution: options > env > default
  const model =
    options.model ??
    process.env.DERE_SUMMARY_MODEL ??
    process.env.DERE_SWARM_SUMMARY_MODEL ??
    process.env.DERE_MISSION_SUMMARY_MODEL ??
    SUMMARY_MODEL;

  // Smart context truncation
  const context =
    text.length > MAX_CONTEXT * 2
      ? `${text.slice(0, MAX_CONTEXT)}\n\n[...]\n\n${text.slice(-MAX_CONTEXT)}`
      : text.slice(0, MAX_CONTEXT * 2);

  const promptPrefix =
    options.promptPrefix ?? "Summarize this output in 1-2 sentences. Focus on the main result or outcome.";

  const prompt = `${promptPrefix}

Output:
${context}

Summary:`;

  try {
    const client = getClient(model);
    const summary = await client.generate(prompt);
    return summary.trim() || null;
  } catch (error) {
    const category = options.logCategory ?? "summary";
    const logger = log[category as keyof typeof log] ?? log.summary;
    logger.warn("Summary generation failed", { error: String(error) });
    return null;
  }
}

/**
 * Simple summary for short content (e.g., session titles).
 * Always attempts summary regardless of length.
 * Uses a simpler prompt.
 */
export async function generateShortSummary(text: string): Promise<string | null> {
  return generateSummary(text, {
    skipThresholdCheck: true,
    promptPrefix: "Summarize in 1-2 sentences. No headers or preambles, just the summary.",
  });
}
