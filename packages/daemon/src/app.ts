import { Hono } from "hono";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";

import { registerSessionRoutes } from "./sessions/index.js";
import { registerWorkQueueRoutes } from "./routes/work-queue.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerPresenceRoutes } from "./routes/presence.js";
import { registerRoutingRoutes } from "./routes/routing.js";
import { registerActivityRoutes } from "./routes/activity.js";
import { registerExplorationRoutes } from "./routes/exploration.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerMetricsRoutes } from "./metrics.js";
import { registerAgentWebSocket, websocket as agentWebsocket } from "./agents/ws.js";
import { registerConversationRoutes } from "./sessions/conversations.js";
import { registerQueueRoutes } from "./routes/queue.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerContextRoutes } from "./context/index.js";
import { registerPersonalityRoutes } from "./personalities/api.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerLlmRoutes } from "./routes/llm.js";
import { registerSwarmRoutes } from "./swarm/index.js";

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
