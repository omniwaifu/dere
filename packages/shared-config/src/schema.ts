import { z } from "zod";
import { convertJsonSchemaToZod } from "zod-from-json-schema";

import dereConfigSchema from "../../../schemas/config/dere_config.schema.json" assert { type: "json" };

// Re-export the generated type from config.types.ts (generated from JSON schema)
export type { DereConfig } from "./config.types.js";

// Runtime schema for validation - type is erased at compile time
// but the generated DereConfig interface above provides the static type
export const DereConfigSchema = convertJsonSchemaToZod(
  dereConfigSchema as Record<string, unknown>,
) as unknown as z.ZodTypeAny;
