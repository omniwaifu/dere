import type { Hono } from "hono";

import { isAuthFailed, resetAuthState } from "@dere/shared-llm";

import { graphAvailable } from "@dere/graph";

export function registerSystemRoutes(app: Hono): void {
  app.get("/health", async (c) => {
    const dereGraph = (await graphAvailable()) ? "available" : "unavailable";
    const claudeAuth = isAuthFailed() ? "expired" : "ok";
    return c.json({
      status: "healthy",
      dere_graph: dereGraph,
      claude_auth: claudeAuth,
    });
  });

  app.post("/auth/reset", async (c) => {
    resetAuthState();
    return c.json({ status: "ok", message: "Auth state reset. LLM features re-enabled." });
  });
}
