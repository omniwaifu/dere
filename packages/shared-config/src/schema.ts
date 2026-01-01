import { z } from "zod";
import { convertJsonSchemaToZod } from "zod-from-json-schema";

import dereConfigSchema from "../../../schemas/config/dere_config.schema.json" assert { type: "json" };

export const DereConfigSchema = convertJsonSchemaToZod(
  dereConfigSchema as Record<string, unknown>,
) as z.ZodTypeAny;

export type DereConfig = z.infer<typeof DereConfigSchema>;
