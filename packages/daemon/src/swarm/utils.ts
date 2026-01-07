// Swarm utility functions

import type { JsonValue } from "../db-types.js";
import { AgentTimeoutError, MAX_OUTPUT_SIZE } from "./types.js";

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutSeconds: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AgentTimeoutError(timeoutSeconds)), timeoutSeconds * 1000);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export function nowDate(): Date {
  return new Date();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value as JsonValue;
  }
  if (typeof value === "object") {
    return value as JsonValue;
  }
  return null;
}

export async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_SIZE) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_SIZE)}\n\n[Output truncated]`;
}

export function resolvePluginPaths(
  plugins: string[] | null,
): Array<{ type: "local"; path: string }> | undefined {
  const resolved = plugins ?? ["dere_core"];
  if (resolved.length === 0) {
    return undefined;
  }
  const base = `${process.cwd()}/plugins`;
  return resolved.map((name) => ({ type: "local", path: `${base}/${name}` }));
}

export function collectText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(collectText).join("");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.content)) {
      return record.content.map(collectText).join("");
    }
  }
  return "";
}
