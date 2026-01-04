import { router, publicProcedure } from "../init.js";
import { listPersonalityInfos } from "../../personalities.js";
import { loadConfig } from "@dere/shared-config";

export const metadataRouter = router({
  models: publicProcedure.query(() => ({
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
  })),

  outputStyles: publicProcedure.query(() => ({
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
  })),

  personalities: publicProcedure.query(async () => {
    const personalities = await listPersonalityInfos();
    return { personalities };
  }),

  userInfo: publicProcedure.query(async () => {
    const config = await loadConfig();
    const user = (config.user ?? {}) as Record<string, unknown>;
    const name = typeof user.name === "string" ? user.name : "";
    return { name };
  }),
});
