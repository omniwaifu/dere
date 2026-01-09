/**
 * Swarm routes - aggregates all swarm-related HTTP endpoints.
 */

import type { Hono } from "hono";

import { registerSpawnRoutes } from "./spawn.js";
import { registerStatusRoutes } from "./status.js";
import { registerControlRoutes } from "./control.js";
import { registerScratchpadRoutes } from "./scratchpad.js";

/**
 * Register all swarm routes on the Hono app.
 */
export function registerSwarmRoutes(app: Hono): void {
  registerSpawnRoutes(app);
  registerStatusRoutes(app);
  registerControlRoutes(app);
  registerScratchpadRoutes(app);
}
