/**
 * Centralized state management for swarm execution.
 * Encapsulates global maps that track running swarms and agents.
 *
 * Thread-safety note: JavaScript is single-threaded, but async operations
 * can interleave. This class uses careful state management to prevent
 * race conditions during async gaps.
 */

type CompletionSignal = {
  promise: Promise<void>;
  resolve: () => void;
  /** Timestamp when the signal was created, for debugging stale signals */
  createdAt: number;
};

type SwarmRun = {
  promise: Promise<void>;
  cancelled: boolean;
  completionSignals: Map<number, CompletionSignal>;
  /** Timestamp when the swarm started running */
  startedAt: number;
};

/** Maximum time a swarm can run before being considered stale (24 hours) */
const MAX_SWARM_RUNTIME_MS = 24 * 60 * 60 * 1000;

/** Maximum time an agent can be tracked before being considered stale (2 hours) */
const MAX_AGENT_RUNTIME_MS = 2 * 60 * 60 * 1000;

/**
 * Manages in-memory state for swarm execution.
 * Prevents memory leaks by cleaning up state when swarms complete.
 */
class SwarmStateManager {
  // Tracks running agent promises by agent ID
  private runningAgents = new Map<number, { promise: Promise<void>; startedAt: number }>();

  // Tracks swarm execution state by swarm ID
  private swarmRuns = new Map<number, SwarmRun>();

  // Tracks swarms in the process of starting (race prevention)
  private startingSwarms = new Set<number>();

  // ============================================================================
  // Agent Lifecycle
  // ============================================================================

  /**
   * Register an agent as running.
   * @throws Error if agentId is invalid
   */
  trackAgent(agentId: number, promise: Promise<void>): void {
    if (!Number.isFinite(agentId) || agentId <= 0) {
      throw new Error(`Invalid agentId for tracking: ${agentId}`);
    }

    // Warn if agent is already being tracked (potential bug)
    if (this.runningAgents.has(agentId)) {
      console.warn(`Agent ${agentId} is already being tracked, overwriting`);
    }

    this.runningAgents.set(agentId, { promise, startedAt: Date.now() });
  }

  /**
   * Remove an agent from tracking when it completes.
   */
  untrackAgent(agentId: number): void {
    this.runningAgents.delete(agentId);
  }

  /**
   * Check if an agent is currently running.
   */
  isAgentRunning(agentId: number): boolean {
    return this.runningAgents.has(agentId);
  }

  // ============================================================================
  // Swarm Lifecycle
  // ============================================================================

  /**
   * Check if a swarm is running or starting.
   */
  isSwarmActive(swarmId: number): boolean {
    if (!Number.isFinite(swarmId)) {
      return false;
    }
    return this.swarmRuns.has(swarmId) || this.startingSwarms.has(swarmId);
  }

  /**
   * Check if a swarm is currently running (not just starting).
   */
  isSwarmRunning(swarmId: number): boolean {
    if (!Number.isFinite(swarmId)) {
      return false;
    }
    return this.swarmRuns.has(swarmId);
  }

  /**
   * Mark a swarm as starting. Returns false if already active.
   * Call this before async setup to prevent race conditions.
   * @throws Error if swarmId is invalid
   */
  markStarting(swarmId: number): boolean {
    if (!Number.isFinite(swarmId) || swarmId <= 0) {
      throw new Error(`Invalid swarmId for markStarting: ${swarmId}`);
    }

    if (this.isSwarmActive(swarmId)) {
      return false;
    }
    this.startingSwarms.add(swarmId);
    return true;
  }

  /**
   * Complete the starting phase and register the swarm run.
   * Call this after async setup completes.
   * @throws Error if swarmId is invalid or not in starting state
   */
  registerRun(swarmId: number, promise: Promise<void>): void {
    if (!Number.isFinite(swarmId) || swarmId <= 0) {
      throw new Error(`Invalid swarmId for registerRun: ${swarmId}`);
    }

    // Ensure we're transitioning from starting state
    if (!this.startingSwarms.has(swarmId)) {
      console.warn(`registerRun called for swarm ${swarmId} that wasn't marked as starting`);
    }

    const run: SwarmRun = {
      promise,
      cancelled: false,
      completionSignals: new Map(),
      startedAt: Date.now(),
    };
    this.swarmRuns.set(swarmId, run);
    this.startingSwarms.delete(swarmId);
  }

  /**
   * Clear the starting flag without registering (e.g., on setup failure).
   */
  clearStarting(swarmId: number): void {
    this.startingSwarms.delete(swarmId);
  }

  /**
   * Clean up swarm state when execution completes.
   * Also cleans up any orphaned completion signals.
   */
  cleanupSwarm(swarmId: number): void {
    const run = this.swarmRuns.get(swarmId);
    if (run) {
      // Resolve any remaining completion signals to unblock waiters
      for (const signal of run.completionSignals.values()) {
        signal.resolve();
      }
    }
    this.swarmRuns.delete(swarmId);
    // Also clear from starting in case of edge cases
    this.startingSwarms.delete(swarmId);
  }

  // ============================================================================
  // Cancellation
  // ============================================================================

  /**
   * Check if a swarm has been cancelled.
   */
  isCancelled(swarmId: number): boolean {
    return this.swarmRuns.get(swarmId)?.cancelled ?? false;
  }

  /**
   * Cancel a swarm and resolve all completion signals.
   * Returns true if the swarm was running and is now cancelled.
   */
  cancelSwarm(swarmId: number): boolean {
    const run = this.swarmRuns.get(swarmId);
    if (!run) {
      return false;
    }

    run.cancelled = true;

    // Resolve all completion signals so waiting code unblocks immediately
    for (const signal of run.completionSignals.values()) {
      signal.resolve();
    }

    return true;
  }

  // ============================================================================
  // Completion Signals
  // ============================================================================

  /**
   * Get or create a completion signal for an agent.
   * Completion signals allow code to wait for an agent to complete.
   */
  getCompletionSignal(swarmId: number, agentId: number): CompletionSignal {
    const run = this.swarmRuns.get(swarmId);
    if (!run) {
      // Return an immediately-resolved signal for non-running swarms
      return { promise: Promise.resolve(), resolve: () => {}, createdAt: Date.now() };
    }

    const existing = run.completionSignals.get(agentId);
    if (existing) {
      return existing;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    const entry: CompletionSignal = { promise, resolve, createdAt: Date.now() };
    run.completionSignals.set(agentId, entry);
    return entry;
  }

  // ============================================================================
  // Debugging / Stats / Maintenance
  // ============================================================================

  /**
   * Get current state counts for debugging.
   */
  getStats(): {
    runningAgents: number;
    activeSwarms: number;
    startingSwarms: number;
    staleAgentCount: number;
    staleSwarmCount: number;
  } {
    const now = Date.now();

    // Count stale agents (running longer than MAX_AGENT_RUNTIME_MS)
    let staleAgentCount = 0;
    for (const [, info] of this.runningAgents) {
      if (now - info.startedAt > MAX_AGENT_RUNTIME_MS) {
        staleAgentCount++;
      }
    }

    // Count stale swarms (running longer than MAX_SWARM_RUNTIME_MS)
    let staleSwarmCount = 0;
    for (const [, run] of this.swarmRuns) {
      if (now - run.startedAt > MAX_SWARM_RUNTIME_MS) {
        staleSwarmCount++;
      }
    }

    return {
      runningAgents: this.runningAgents.size,
      activeSwarms: this.swarmRuns.size,
      startingSwarms: this.startingSwarms.size,
      staleAgentCount,
      staleSwarmCount,
    };
  }

  /**
   * Clean up stale state entries that may have been orphaned.
   * Should be called periodically (e.g., every hour) to prevent memory leaks.
   * Returns the number of entries cleaned up.
   */
  cleanupStaleState(): { agents: number; swarms: number; startingSwarms: number } {
    const now = Date.now();
    let agentsCleaned = 0;
    let swarmsCleaned = 0;
    let startingSwarmsCleaned = 0;

    // Clean up stale agents
    for (const [agentId, info] of this.runningAgents) {
      if (now - info.startedAt > MAX_AGENT_RUNTIME_MS) {
        console.warn(`Cleaning up stale agent ${agentId} (running for ${Math.round((now - info.startedAt) / 1000 / 60)} minutes)`);
        this.runningAgents.delete(agentId);
        agentsCleaned++;
      }
    }

    // Clean up stale swarms
    for (const [swarmId, run] of this.swarmRuns) {
      if (now - run.startedAt > MAX_SWARM_RUNTIME_MS) {
        console.warn(`Cleaning up stale swarm ${swarmId} (running for ${Math.round((now - run.startedAt) / 1000 / 60 / 60)} hours)`);
        // Resolve all signals first
        for (const signal of run.completionSignals.values()) {
          signal.resolve();
        }
        this.swarmRuns.delete(swarmId);
        swarmsCleaned++;
      }
    }

    // Clean up starting swarms that have been starting for too long (5 minutes)
    // This shouldn't happen but is a safety net
    // Note: We can't easily track when they were added, so we just clear them if there are orphans
    // after all running swarms are accounted for
    if (this.startingSwarms.size > 0 && this.swarmRuns.size === 0) {
      startingSwarmsCleaned = this.startingSwarms.size;
      console.warn(`Cleaning up ${startingSwarmsCleaned} orphaned starting swarms`);
      this.startingSwarms.clear();
    }

    return { agents: agentsCleaned, swarms: swarmsCleaned, startingSwarms: startingSwarmsCleaned };
  }

  /**
   * Get detailed state for debugging purposes.
   */
  getDetailedState(): {
    agents: Array<{ id: number; runtimeMs: number }>;
    swarms: Array<{ id: number; runtimeMs: number; signalCount: number; cancelled: boolean }>;
    startingSwarmIds: number[];
  } {
    const now = Date.now();

    const agents = Array.from(this.runningAgents.entries()).map(([id, info]) => ({
      id,
      runtimeMs: now - info.startedAt,
    }));

    const swarms = Array.from(this.swarmRuns.entries()).map(([id, run]) => ({
      id,
      runtimeMs: now - run.startedAt,
      signalCount: run.completionSignals.size,
      cancelled: run.cancelled,
    }));

    return {
      agents,
      swarms,
      startingSwarmIds: Array.from(this.startingSwarms),
    };
  }
}

// Singleton instance
export const swarmState = new SwarmStateManager();

// Re-export type for use elsewhere
export type { CompletionSignal };
