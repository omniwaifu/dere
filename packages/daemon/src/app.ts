import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadConfig, saveConfig } from "@dere/shared-config";

import { listPersonalityInfos } from "./personalities.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerAgentRoutes } from "./agent.js";
import { registerWorkQueueRoutes } from "./work-queue.js";
import { registerNotificationRoutes } from "./notifications.js";
import { registerPresenceRoutes } from "./presence.js";
import { registerAmbientRoutes } from "./ambient.js";
import { registerRoutingRoutes } from "./routing.js";
import { registerActivityRoutes } from "./activity.js";
import { registerTaskwarriorRoutes } from "./taskwarrior.js";
import { registerEmotionRoutes } from "./emotions.js";
import { registerExplorationRoutes } from "./exploration.js";
import { registerSearchRoutes } from "./search.js";
import { registerMetricsRoutes } from "./metrics.js";
import { registerRecallRoutes } from "./recall.js";
import { registerDashboardRoutes } from "./dashboard.js";
import { registerCoreMemoryRoutes } from "./core-memory.js";
import { registerMissionRoutes } from "./missions.js";
import { registerMemoryConsolidationRoutes } from "./memory-consolidation.js";
import { registerAgentWebSocket, websocket as agentWebsocket } from "./agent-ws.js";
import { registerConversationRoutes } from "./conversations.js";
import { registerQueueRoutes } from "./queue.js";
import { registerStatusRoutes } from "./status.js";
import { registerKnowledgeGraphRoutes } from "./knowledge-graph.js";
import { registerContextRoutes } from "./context.js";
import { registerPersonalityRoutes } from "./personalities-api.js";
import { registerSystemRoutes } from "./system.js";
import { registerLlmRoutes } from "./llm.js";
import { registerSwarmRoutes } from "./swarm.js";

export function createApp(): { app: Hono; websocket: typeof agentWebsocket } {
  const app = new Hono();

  app.get("/config", async (c) => {
    const config = await loadConfig();
    return c.json(config);
  });

  const handleConfigUpdate = async (c: import("hono").Context) => {
    let updates: Record<string, unknown>;
    try {
      updates = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const saved = await saveConfig(updates);
    return c.json(saved);
  };

  app.post("/config", handleConfigUpdate);
  app.put("/config", handleConfigUpdate);

  app.get("/config/schema", async (c) => {
    const schemaRoot = process.env.DERE_SCHEMA_DIR ?? join(process.cwd(), "schemas");
    const schemaPath = join(schemaRoot, "config", "dere_config.schema.json");
    const raw = await readFile(schemaPath, "utf-8");
    return c.json(JSON.parse(raw) as unknown);
  });

  app.get("/agent/models", (c) => {
    return c.json({
      models: [
        {
          id: "claude-opus-4-5",
          name: "Opus 4.5",
          description: "Premium model with maximum intelligence",
        },
        {
          id: "claude-sonnet-4-5",
          name: "Sonnet 4.5",
          description: "Smart model for complex agents and coding",
        },
        {
          id: "claude-haiku-4-5",
          name: "Haiku 4.5",
          description: "Fastest model with near-frontier intelligence",
        },
      ],
    });
  });

  app.get("/agent/output-styles", (c) => {
    return c.json({
      styles: [
        {
          name: "default",
          description: "Default Claude Code output style",
        },
        {
          name: "dere-core:discord",
          description: "Optimized for Discord messaging",
        },
      ],
    });
  });

  app.get("/agent/personalities", async (c) => {
    const personalities = await listPersonalityInfos();
    return c.json({ personalities });
  });

  registerSystemRoutes(app);
  registerSessionRoutes(app);
  registerAgentRoutes(app);
  registerWorkQueueRoutes(app);
  registerNotificationRoutes(app);
  registerPresenceRoutes(app);
  registerAmbientRoutes(app);
  registerRoutingRoutes(app);
  registerActivityRoutes(app);
  registerTaskwarriorRoutes(app);
  registerEmotionRoutes(app);
  registerExplorationRoutes(app);
  registerSearchRoutes(app);
  registerMetricsRoutes(app);
  registerRecallRoutes(app);
  registerDashboardRoutes(app);
  registerCoreMemoryRoutes(app);
  registerMissionRoutes(app);
  registerMemoryConsolidationRoutes(app);
  registerConversationRoutes(app);
  registerQueueRoutes(app);
  registerStatusRoutes(app);
  registerKnowledgeGraphRoutes(app);
  registerContextRoutes(app);
  registerPersonalityRoutes(app);
  registerLlmRoutes(app);
  registerSwarmRoutes(app);
  registerAgentWebSocket(app);

  return { app, websocket: agentWebsocket };
}
