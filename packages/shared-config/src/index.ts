import { parse } from "@iarna/toml";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { DereConfigSchema } from "./schema.js";
import type { DereConfig } from "./schema.js";

export class ConfigError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export type { DereConfig };

export function getDaemonUrlFromConfig(config: DereConfig): string {
  const ambientUrl = config.ambient?.daemon_url;
  if (typeof ambientUrl === "string" && ambientUrl.trim().length > 0) {
    return ambientUrl.trim();
  }

  const daemonSection = (config as Record<string, unknown>).daemon;
  if (daemonSection && typeof daemonSection === "object" && !Array.isArray(daemonSection)) {
    const record = daemonSection as Record<string, unknown>;
    if (typeof record.url === "string" && record.url.trim().length > 0) {
      return record.url.trim();
    }
    if (typeof record.daemon_url === "string" && record.daemon_url.trim().length > 0) {
      return record.daemon_url.trim();
    }
  }

  throw new ConfigError("daemon_url missing in config (ambient.daemon_url)");
}

export function parseTomlString(text: string): unknown {
  try {
    return parse(text) as unknown;
  } catch (error) {
    throw new ConfigError("Failed to parse TOML config", error);
  }
}

export async function loadConfigFile<TSchema extends z.ZodTypeAny>(
  path: string,
  schema: TSchema = DereConfigSchema as TSchema,
): Promise<z.infer<TSchema>> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (error) {
    throw new ConfigError(`Failed to read config file: ${path}`, error);
  }

  const parsed = parseTomlString(text);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError("Config validation failed", result.error);
  }

  return result.data;
}

export * from "./config.types.js";
export { DereConfigSchema };
export * from "./storage.js";
