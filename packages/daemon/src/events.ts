/**
 * Typed event system for cross-cutting concerns.
 * Allows modules to subscribe to and emit events without tight coupling.
 */

import { EventEmitter } from "node:events";

// ============================================================================
// Event Types
// ============================================================================

export type SessionStartEvent = {
  sessionId: number;
  workingDir: string;
  userId: string | null;
  medium: string | null;
};

export type SessionEndEvent = {
  sessionId: number;
  reason: "completed" | "failed" | "cancelled";
};

export type SwarmStartEvent = {
  swarmId: number;
  name: string;
  workingDir: string;
  agentCount: number;
};

export type SwarmEndEvent = {
  swarmId: number;
  status: "completed" | "failed" | "cancelled";
  agentResults: Array<{
    name: string;
    status: string;
    hasOutput: boolean;
  }>;
};

export type AgentStartEvent = {
  agentId: number;
  swarmId: number;
  name: string;
  role: string;
};

export type AgentEndEvent = {
  agentId: number;
  swarmId: number;
  name: string;
  status: "completed" | "failed" | "cancelled" | "skipped";
  durationSeconds: number;
};

export type ErrorEvent = {
  source: string;
  error: Error;
  context?: Record<string, unknown>;
};

export type MissionExecuteEvent = {
  missionId: number;
  name: string;
  trigger: "scheduled" | "manual";
};

export type MissionCompleteEvent = {
  missionId: number;
  name: string;
  status: "success" | "failed";
  durationSeconds: number;
};

export type EmotionUpdateEvent = {
  userId: string;
  valence: number;
  arousal: number;
  dominantEmotion: string;
};

export type MemoryConsolidateEvent = {
  userId: string;
  factsExtracted: number;
  entitiesUpdated: number;
};

export type RecallEmbedEvent = {
  count: number;
  durationMs: number;
};

export type AmbientExploreEvent = {
  type: "curiosity" | "exploration" | "finding";
  workingDir: string;
  description: string;
};

// ============================================================================
// Event Map
// ============================================================================

export interface DaemonEvents {
  "session:start": SessionStartEvent;
  "session:end": SessionEndEvent;
  "swarm:start": SwarmStartEvent;
  "swarm:end": SwarmEndEvent;
  "agent:start": AgentStartEvent;
  "agent:end": AgentEndEvent;
  "mission:execute": MissionExecuteEvent;
  "mission:complete": MissionCompleteEvent;
  "emotion:update": EmotionUpdateEvent;
  "memory:consolidate": MemoryConsolidateEvent;
  "recall:embed": RecallEmbedEvent;
  "ambient:explore": AmbientExploreEvent;
  error: ErrorEvent;
}

// ============================================================================
// Typed Event Emitter
// ============================================================================

type EventHandler<T> = (event: T) => void | Promise<void>;

class TypedEventEmitter {
  private emitter = new EventEmitter();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends keyof DaemonEvents>(
    event: K,
    handler: EventHandler<DaemonEvents[K]>,
  ): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  /**
   * Subscribe to an event for a single occurrence.
   */
  once<K extends keyof DaemonEvents>(
    event: K,
    handler: EventHandler<DaemonEvents[K]>,
  ): void {
    this.emitter.once(event, handler);
  }

  /**
   * Emit an event. Handlers are called asynchronously.
   * Errors in handlers are caught and logged.
   */
  emit<K extends keyof DaemonEvents>(event: K, data: DaemonEvents[K]): void {
    // Use setImmediate to make emission non-blocking
    setImmediate(() => {
      try {
        this.emitter.emit(event, data);
      } catch (error) {
        console.error(`[events] handler error for ${event}:`, error);
      }
    });
  }

  /**
   * Emit an event and wait for all handlers to complete.
   * Use sparingly - prefer emit() for fire-and-forget.
   */
  async emitAsync<K extends keyof DaemonEvents>(
    event: K,
    data: DaemonEvents[K],
  ): Promise<void> {
    const listeners = this.emitter.listeners(event) as EventHandler<DaemonEvents[K]>[];
    await Promise.allSettled(listeners.map((fn) => fn(data)));
  }

  /**
   * Remove all listeners for an event.
   */
  removeAllListeners<K extends keyof DaemonEvents>(event?: K): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * Get the number of listeners for an event.
   */
  listenerCount<K extends keyof DaemonEvents>(event: K): number {
    return this.emitter.listenerCount(event);
  }
}

// Singleton instance
export const daemonEvents = new TypedEventEmitter();

// ============================================================================
// Helper: Log all events (useful for debugging)
// ============================================================================

let debugUnsubscribers: Array<() => void> = [];

export function enableEventDebugLogging(): void {
  const events: Array<keyof DaemonEvents> = [
    "session:start",
    "session:end",
    "swarm:start",
    "swarm:end",
    "agent:start",
    "agent:end",
    "error",
  ];

  for (const event of events) {
    const unsub = daemonEvents.on(event, (data) => {
      console.log(`[events] ${event}:`, JSON.stringify(data, null, 2));
    });
    debugUnsubscribers.push(unsub);
  }
}

export function disableEventDebugLogging(): void {
  for (const unsub of debugUnsubscribers) {
    unsub();
  }
  debugUnsubscribers = [];
}
