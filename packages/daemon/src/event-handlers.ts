/**
 * Event handlers that wire daemon events to logging, metrics, and other cross-cutting concerns.
 */

import { daemonEvents } from "./events.js";
import { log } from "./logger.js";

/**
 * Initialize all event handlers.
 * Call this once at daemon startup.
 */
export function initEventHandlers(): void {
  // Swarm lifecycle logging
  daemonEvents.on("swarm:start", (event) => {
    log.swarm.info(`Starting swarm "${event.name}"`, {
      swarmId: event.swarmId,
      workingDir: event.workingDir,
      agentCount: event.agentCount,
    });
  });

  daemonEvents.on("swarm:end", (event) => {
    const level = event.status === "completed" ? "info" : "warn";
    const completedCount = event.agentResults.filter((a) => a.status === "completed").length;
    const failedCount = event.agentResults.filter((a) => a.status === "failed").length;

    log.swarm[level](`Swarm ${event.status}`, {
      swarmId: event.swarmId,
      status: event.status,
      completed: completedCount,
      failed: failedCount,
      total: event.agentResults.length,
    });
  });

  // Agent lifecycle logging
  daemonEvents.on("agent:start", (event) => {
    log.agent.info(`Agent "${event.name}" started`, {
      agentId: event.agentId,
      swarmId: event.swarmId,
      role: event.role,
    });
  });

  daemonEvents.on("agent:end", (event) => {
    const level = event.status === "completed" ? "info" : event.status === "failed" ? "warn" : "debug";
    const durationStr = event.durationSeconds.toFixed(1);

    log.agent[level](`Agent "${event.name}" ${event.status}`, {
      agentId: event.agentId,
      swarmId: event.swarmId,
      status: event.status,
      duration: `${durationStr}s`,
    });
  });

  // Session lifecycle logging
  daemonEvents.on("session:start", (event) => {
    log.session.info("Session started", {
      sessionId: event.sessionId,
      workingDir: event.workingDir,
      medium: event.medium,
    });
  });

  daemonEvents.on("session:end", (event) => {
    log.session.info("Session ended", {
      sessionId: event.sessionId,
      reason: event.reason,
    });
  });

  // Mission lifecycle logging
  daemonEvents.on("mission:execute", (event) => {
    log.missions.info(`Executing mission "${event.name}"`, {
      missionId: event.missionId,
      trigger: event.trigger,
    });
  });

  daemonEvents.on("mission:complete", (event) => {
    const level = event.status === "success" ? "info" : "warn";
    log.missions[level](`Mission "${event.name}" ${event.status}`, {
      missionId: event.missionId,
      duration: `${event.durationSeconds.toFixed(1)}s`,
    });
  });

  // Emotion updates
  daemonEvents.on("emotion:update", (event) => {
    log.emotion.debug(`Emotion updated for ${event.userId}`, {
      valence: event.valence.toFixed(2),
      arousal: event.arousal.toFixed(2),
      dominant: event.dominantEmotion,
    });
  });

  // Memory consolidation
  daemonEvents.on("memory:consolidate", (event) => {
    log.memory.info(`Memory consolidated for ${event.userId}`, {
      facts: event.factsExtracted,
      entities: event.entitiesUpdated,
    });
  });

  // Recall embeddings
  daemonEvents.on("recall:embed", (event) => {
    log.recall.debug("Embeddings generated", {
      count: event.count,
      duration: `${event.durationMs}ms`,
    });
  });

  // Ambient exploration
  daemonEvents.on("ambient:explore", (event) => {
    log.ambient.info(`Ambient ${event.type}`, {
      workingDir: event.workingDir,
      description: event.description,
    });
  });

  // Error logging with Sentry capture
  daemonEvents.on("error", (event) => {
    log.events.captureError(event.error, {
      source: event.source,
      ...event.context,
    });
  });

  log.events.debug("Event handlers initialized");
}
