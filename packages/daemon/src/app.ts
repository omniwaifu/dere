import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";

import { registerSessionRoutes } from "./sessions.js";
import { registerWorkQueueRoutes } from "./work-queue.js";
import { registerNotificationRoutes } from "./notifications.js";
import { registerPresenceRoutes } from "./presence.js";
import { registerRoutingRoutes } from "./routing.js";
import { registerActivityRoutes } from "./activity.js";
import { registerExplorationRoutes } from "./exploration.js";
import { registerSearchRoutes } from "./search.js";
import { registerMetricsRoutes } from "./metrics.js";
import { registerAgentWebSocket, websocket as agentWebsocket } from "./agent-ws.js";
import { registerConversationRoutes } from "./conversations.js";
import { registerQueueRoutes } from "./queue.js";
import { registerStatusRoutes } from "./status.js";
import { registerContextRoutes } from "./context.js";
import { registerPersonalityRoutes } from "./personalities-api.js";
import { registerSystemRoutes } from "./system.js";
import { registerLlmRoutes } from "./llm.js";
import { registerSwarmRoutes } from "./swarm.js";

export function createApp(): { app: Hono; websocket: typeof agentWebsocket } {
  const app = new Hono();

  // tRPC handler
  app.all("/trpc/*", async (c) => {
    return fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
    });
  });

  registerSystemRoutes(app);
  registerSessionRoutes(app);
  registerWorkQueueRoutes(app);
  registerNotificationRoutes(app);
  registerPresenceRoutes(app);
  registerRoutingRoutes(app);
  registerActivityRoutes(app);
  registerExplorationRoutes(app);
  registerSearchRoutes(app);
  registerMetricsRoutes(app);
  registerConversationRoutes(app);
  registerQueueRoutes(app);
  registerStatusRoutes(app);
  registerContextRoutes(app);
  registerPersonalityRoutes(app);
  registerLlmRoutes(app);
  registerSwarmRoutes(app);
  registerAgentWebSocket(app);

  return { app, websocket: agentWebsocket };
}
