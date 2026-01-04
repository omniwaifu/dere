import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig, saveConfig } from "@dere/shared-config";
import { router, publicProcedure } from "../init.js";

export const configRouter = router({
  get: publicProcedure.query(async () => {
    const config = await loadConfig();
    return config;
  }),

  update: publicProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => {
      const saved = await saveConfig(input);
      return saved;
    }),

  schema: publicProcedure.query(async () => {
    const repoRoot = join(import.meta.dirname, "../../../../..");
    const schemaRoot = process.env.DERE_SCHEMA_DIR ?? join(repoRoot, "schemas");
    const schemaPath = join(schemaRoot, "config", "dere_config.schema.json");
    const raw = await readFile(schemaPath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  }),
});
