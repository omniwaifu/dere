import { parse, stringify } from "@iarna/toml";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

import { DereConfigSchema } from "./schema.js";
import type { DereConfig } from "./schema.js";

export class ConfigStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigStorageError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return join(xdgConfig, "dere");
  }
  return join(homedir(), ".config", "dere");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.toml");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(updates)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function loadConfig(schema: z.ZodTypeAny = DereConfigSchema): Promise<DereConfig> {
  const configPath = getConfigPath();
  let rawData: Record<string, unknown> = {};

  try {
    const text = await readFile(configPath, "utf-8");
    rawData = parse(text) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Log-style error handling: return defaults on read/parse failure.
      rawData = {};
    }
  }

  try {
    return schema.parse(rawData) as DereConfig;
  } catch {
    // Fall back to defaults if validation fails.
    return schema.parse({}) as DereConfig;
  }
}

export async function saveConfig(
  updates: Record<string, unknown>,
  schema: z.ZodTypeAny = DereConfigSchema,
): Promise<DereConfig> {
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};

  try {
    const text = await readFile(configPath, "utf-8");
    existing = parse(text) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigStorageError(`Failed to read config file at ${configPath}`, error);
    }
  }

  const merged = deepMerge(existing, updates);
  const validated = schema.parse(merged) as DereConfig;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, stringify(merged as Record<string, unknown>), "utf-8");

  return validated;
}
