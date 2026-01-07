// Swarm utility functions

import type { JsonValue } from "../db-types.js";
import { AgentTimeoutError, MAX_OUTPUT_SIZE } from "./types.js";

export type TimeoutResult<T> = {
  result: T;
  timedOut: false;
} | {
  result: null;
  timedOut: true;
  elapsedSeconds: number;
};

export type TimeoutOptions = {
  /** AbortController to signal cancellation to the underlying operation */
  abortController?: AbortController;
  /** Callback invoked when timeout fires, before rejection */
  onTimeout?: (elapsedSeconds: number) => void;
  /** Grace period in ms after timeout to allow cleanup (default: 1000) */
  gracePeriodMs?: number;
};

/**
 * Race a promise against a timeout with proper cleanup.
 *
 * Key improvements over naive Promise.race:
 * 1. Clears timeout even if promise rejects
 * 2. Supports AbortController for cancelling underlying work
 * 3. Provides grace period for cleanup operations
 * 4. Calls onTimeout callback for logging/state updates
 *
 * @throws AgentTimeoutError if timeout fires before promise resolves
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutSeconds: number,
  options: TimeoutOptions = {},
): Promise<T> {
  const { abortController, onTimeout, gracePeriodMs = 1000 } = options;

  let timeoutId: ReturnType<typeof setTimeout>;
  let resolved = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (resolved) {
        // Promise already resolved, don't trigger timeout
        return;
      }

      const elapsed = timeoutSeconds;

      // Signal abort to underlying operation
      if (abortController && !abortController.signal.aborted) {
        abortController.abort(new AgentTimeoutError(timeoutSeconds));
      }

      // Call timeout callback for logging/state updates
      onTimeout?.(elapsed);

      // Small grace period to allow cleanup before rejection
      setTimeout(() => {
        reject(new AgentTimeoutError(timeoutSeconds));
      }, gracePeriodMs);
    }, timeoutSeconds * 1000);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    resolved = true;
    return result;
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Enhanced timeout wrapper that returns result info instead of throwing.
 * Use this when you want to handle timeout gracefully (e.g., capture partial results).
 */
export async function withTimeoutResult<T>(
  promise: Promise<T>,
  timeoutSeconds: number,
  options: TimeoutOptions = {},
): Promise<TimeoutResult<T>> {
  try {
    const result = await withTimeout(promise, timeoutSeconds, options);
    return { result, timedOut: false };
  } catch (error) {
    if (error instanceof AgentTimeoutError) {
      return { result: null, timedOut: true, elapsedSeconds: timeoutSeconds };
    }
    throw error;
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
