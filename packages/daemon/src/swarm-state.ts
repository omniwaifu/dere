/**
 * Centralized state management for swarm execution.
 * Encapsulates global maps that track running swarms and agents.
 */

type CompletionSignal = {
  promise: Promise<void>;
  resolve: () => void;
};

type SwarmRun = {
  promise: Promise<void>;
  cancelled: boolean;
  completionSignals: Map<number, CompletionSignal>;
};

/**
 * Manages in-memory state for swarm execution.
 * Prevents memory leaks by cleaning up state when swarms complete.
 */
class SwarmStateManager {
  // Tracks running agent promises by agent ID
  private runningAgents = new Map<number, Promise<void>>();

  // Tracks swarm execution state by swarm ID
  private swarmRuns = new Map<number, SwarmRun>();

  // Tracks swarms in the process of starting (race prevention)
  private startingSwarms = new Set<number>();

  // ============================================================================
  // Agent Lifecycle
  // ============================================================================

  /**
   * Register an agent as running.
   */
  trackAgent(agentId: number, promise: Promise<void>): void {
    this.runningAgents.set(agentId, promise);
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
    return this.swarmRuns.has(swarmId) || this.startingSwarms.has(swarmId);
  }

  /**
   * Check if a swarm is currently running (not just starting).
   */
  isSwarmRunning(swarmId: number): boolean {
    return this.swarmRuns.has(swarmId);
  }

  /**
   * Mark a swarm as starting. Returns false if already active.
   * Call this before async setup to prevent race conditions.
   */
  markStarting(swarmId: number): boolean {
    if (this.isSwarmActive(swarmId)) {
      return false;
    }
    this.startingSwarms.add(swarmId);
    return true;
  }

  /**
   * Complete the starting phase and register the swarm run.
   * Call this after async setup completes.
   */
  registerRun(swarmId: number, promise: Promise<void>): void {
    const run: SwarmRun = {
      promise,
      cancelled: false,
      completionSignals: new Map(),
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
   */
  cleanupSwarm(swarmId: number): void {
    this.swarmRuns.delete(swarmId);
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
      return { promise: Promise.resolve(), resolve: () => {} };
    }

    const existing = run.completionSignals.get(agentId);
    if (existing) {
      return existing;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    const entry = { promise, resolve };
    run.completionSignals.set(agentId, entry);
    return entry;
  }

  // ============================================================================
  // Debugging / Stats
  // ============================================================================

  /**
   * Get current state counts for debugging.
   */
  getStats(): { runningAgents: number; activeSwarms: number; startingSwarms: number } {
    return {
      runningAgents: this.runningAgents.size,
      activeSwarms: this.swarmRuns.size,
      startingSwarms: this.startingSwarms.size,
    };
  }
}

// Singleton instance
export const swarmState = new SwarmStateManager();

// Re-export type for use elsewhere
export type { CompletionSignal };
