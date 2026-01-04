import { router } from "./init.js";
import { configRouter } from "./procedures/config.js";
import { emotionsRouter } from "./procedures/emotions.js";
import { sessionsRouter } from "./procedures/sessions.js";
import { missionsRouter } from "./procedures/missions.js";
import { knowledgeGraphRouter } from "./procedures/knowledge-graph.js";
import { agentRouter } from "./procedures/agent.js";
import { dashboardRouter, ambientRouter } from "./procedures/misc.js";
import { metadataRouter } from "./procedures/metadata.js";
import { taskwarriorRouter } from "./procedures/taskwarrior.js";
import { memoryRouter, recallRouter } from "./procedures/memory.js";
import { personalitiesRouter } from "./procedures/personalities.js";

export const appRouter = router({
  config: configRouter,
  emotions: emotionsRouter,
  sessions: sessionsRouter,
  missions: missionsRouter,
  knowledgeGraph: knowledgeGraphRouter,
  agent: agentRouter,
  dashboard: dashboardRouter,
  ambient: ambientRouter,
  metadata: metadataRouter,
  taskwarrior: taskwarriorRouter,
  memory: memoryRouter,
  recall: recallRouter,
  personalities: personalitiesRouter,
});

export type AppRouter = typeof appRouter;
