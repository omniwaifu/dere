import type { Hono } from "hono";

import {
  ClaudeAgentTransport,
  TextResponseClient,
  isAuthError,
  markAuthFailed,
} from "@dere/shared-llm";

import { buildSessionContextXml } from "../context/prompt.js";

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function registerLlmRoutes(app: Hono): void {
  app.post("/llm/generate", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    if (!prompt.trim()) {
      return c.json({ error: "prompt is required" }, 400);
    }

    const model = typeof payload.model === "string" ? payload.model : "claude-haiku-4-5";
    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    const includeContext = Boolean(payload.include_context);
    const isolateSession = Boolean(payload.isolate_session);

    let finalPrompt = prompt;
    if (includeContext) {
      try {
        const context = await buildSessionContextXml({
          sessionId,
          includeContext: true,
        });
        if (context) {
          finalPrompt = `${context}\n\n${finalPrompt}`;
        }
      } catch {
        // ignore context failures
      }
    }

    const workingDirectory = isolateSession
      ? "/tmp/dere_internal"
      : (process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions");

    try {
      const transport = new ClaudeAgentTransport({ workingDirectory });
      const client = new TextResponseClient({ transport, model });
      const response = await client.generate(finalPrompt);
      return c.json({ response });
    } catch (error) {
      if (isAuthError(error)) {
        markAuthFailed();
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
