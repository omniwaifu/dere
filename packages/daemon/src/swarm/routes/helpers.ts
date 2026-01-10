/**
 * Shared helpers for swarm routes.
 */

import type { Context } from "hono";

import { log } from "../../logger.js";
import { GitError } from "../git.js";
import { SwarmDatabaseError } from "../types.js";

/**
 * Check if an error is a database connection/availability error.
 */
export function isDbConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("too many connections") ||
    message.includes("database")
  );
}

/**
 * Log and format error response for route handlers.
 */
export function handleRouteError(operation: string, error: unknown, c: Context): Response {
  const message = error instanceof Error ? error.message : String(error);

  log.swarm.error(`Route error in ${operation}`, {
    operation,
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (isDbConnectionError(error)) {
    return c.json(
      { error: "Database temporarily unavailable", details: message },
      503,
    );
  }

  if (error instanceof GitError) {
    return c.json(
      { error: "Git operation failed", details: message, code: error.code },
      500,
    );
  }

  if (error instanceof SwarmDatabaseError) {
    return c.json(
      { error: "Database operation failed", details: message, operation: error.operation },
      500,
    );
  }

  return c.json({ error: "Internal server error", details: message }, 500);
}
