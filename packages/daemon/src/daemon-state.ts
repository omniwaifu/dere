/**
 * Daemon state derivation - replaces the FSM with computed state.
 *
 * State is derived from:
 * - Active sessions (engaged)
 * - Suppression flag (suppressed)
 * - Autonomous work count (autonomous) - added in Phase 3
 * - Default (idle)
 *
 * The FSM is dead. Long live the projection.
 */

import { getDb } from "./db.js";
import { log } from "./logger.js";

// ============================================================================
// Types
// ============================================================================

export type DaemonState = "idle" | "engaged" | "autonomous" | "suppressed";

export interface DaemonStateRow {
  user_id: string;
  suppressed_until: Date | null;
  last_interaction_at: Date;
  autonomous_work_count: number;
}

export interface SignalInputs {
  activity: {
    app_name?: string;
    duration_seconds?: number;
  };
  emotion: {
    emotion_type?: string;
    intensity?: number;
  };
  notificationHistory: Array<{ acknowledged?: boolean }>;
  currentHour: number;
  task: {
    overdue_count?: number;
    due_soon_count?: number;
  };
  bond?: {
    affection_level?: number;
    trend?: string;
    streak_days?: number;
  };
}

export interface SignalWeights {
  activity: number;
  emotion: number;
  responsiveness: number;
  temporal: number;
  task: number;
  bond: number;
}

// ============================================================================
// State Derivation (pure functions)
// ============================================================================

/**
 * Derive daemon state from truth sources.
 * Priority: engaged > suppressed > autonomous > idle
 */
export function getState(
  row: DaemonStateRow | null,
  activeSessionCount: number,
): DaemonState {
  // User action wins - if there's an active session, we're engaged
  if (activeSessionCount > 0) return "engaged";

  // No state row yet = idle
  if (!row) return "idle";

  const now = new Date();

  // Suppression gates proactive behavior
  if (row.suppressed_until && row.suppressed_until > now) return "suppressed";

  // Autonomous work in progress (Phase 3: will be > 0 when temporal workflows running)
  if (row.autonomous_work_count > 0) return "autonomous";

  return "idle";
}

/**
 * Check if daemon can initiate proactive contact.
 * Separate from state - even in idle, cooldown may prevent contact.
 */
export function canInitiateProactiveContact(
  row: DaemonStateRow | null,
  activeSessionCount: number,
  cooldownMs: number,
): boolean {
  const state = getState(row, activeSessionCount);

  // Only initiate from idle state
  if (state !== "idle") return false;

  // No state row = first run, allow contact
  if (!row) return true;

  const now = new Date();

  // Suppression check (belt and suspenders - getState already handles this)
  if (row.suppressed_until && row.suppressed_until > now) return false;

  // Cooldown check
  const timeSinceInteraction = now.getTime() - row.last_interaction_at.getTime();
  return timeSinceInteraction > cooldownMs;
}

// ============================================================================
// Signal Evaluation (moved from FSM)
// ============================================================================

function evaluateActivitySignal(activity: SignalInputs["activity"]): number {
  const appName = String(activity.app_name ?? "").toLowerCase();
  const durationSeconds = Number(activity.duration_seconds ?? 0);
  const durationMinutes = durationSeconds / 60;

  // Deep work apps = don't interrupt
  if (
    ["code", "vim", "nvim", "intellij", "pycharm", "vscode"].some((k) =>
      appName.includes(k),
    )
  ) {
    return durationMinutes > 30 ? -0.8 : -0.4;
  }

  // Communication apps = busy
  if (["zoom", "teams", "meet", "slack"].some((k) => appName.includes(k))) {
    return -0.6;
  }

  // Email = maybe receptive
  if (["mail", "thunderbird", "outlook"].some((k) => appName.includes(k))) {
    return 0.3;
  }

  // Browser = neutral
  if (["firefox", "chrome", "browser"].some((k) => appName.includes(k))) {
    return 0.1;
  }

  // Terminal = depends on duration
  if (["terminal", "ghostty", "alacritty"].some((k) => appName.includes(k))) {
    return durationMinutes > 20 ? -0.3 : 0.0;
  }

  return 0.0;
}

function evaluateEmotionSignal(emotion: SignalInputs["emotion"]): number {
  const emotionType = String(emotion.emotion_type ?? "neutral");
  const intensity = Number(emotion.intensity ?? 0);

  // Negative emotions = don't add to stress
  if (["distress", "anger", "fear", "disappointment"].includes(emotionType)) {
    return intensity > 60 ? -0.7 : -0.3;
  }

  // Positive emotions = receptive
  if (["interest", "joy", "satisfaction", "gratification"].includes(emotionType)) {
    return intensity > 50 ? 0.6 : 0.3;
  }

  return 0.0;
}

function evaluateResponsivenessSignal(
  notifications: SignalInputs["notificationHistory"],
): number {
  if (notifications.length === 0) return 0.0;

  const acknowledged = notifications.filter((n) => Boolean(n.acknowledged)).length;
  const ackRate = acknowledged / notifications.length;

  if (ackRate > 0.7) return 0.5;
  if (ackRate < 0.3) return -0.5;
  return 0.0;
}

function evaluateTemporalSignal(currentHour: number): number {
  // Late night / early morning = don't disturb
  if (currentHour < 8 || currentHour >= 23) return -0.8;

  // Work hours = okay
  if (currentHour >= 9 && currentHour < 17) return 0.3;

  // Evening = slightly okay
  if (currentHour >= 17 && currentHour < 22) return 0.2;

  return 0.0;
}

function evaluateTaskSignal(task: SignalInputs["task"]): number {
  const overdueCount = Number(task.overdue_count ?? 0);
  const dueSoonCount = Number(task.due_soon_count ?? 0);

  if (overdueCount > 5) return 0.9;
  if (overdueCount > 2) return 0.6;
  if (dueSoonCount > 3) return 0.4;
  return 0.0;
}

function evaluateBondSignal(bond: SignalInputs["bond"]): number {
  if (!bond) return 0.0;

  const affection = Number(bond.affection_level ?? 50);
  const trend = String(bond.trend ?? "stable");
  const streak = Number(bond.streak_days ?? 0);

  let baseSignal = 0.0;
  if (affection >= 80) baseSignal = 0.7;
  else if (affection >= 65) baseSignal = 0.4;
  else if (affection >= 50) baseSignal = 0.1;
  else if (affection >= 35) baseSignal = -0.2;
  else if (affection >= 20) baseSignal = -0.5;
  else baseSignal = -0.8;

  if (trend === "rising") baseSignal += 0.15;
  else if (trend === "falling") baseSignal -= 0.1;
  else if (trend === "distant") baseSignal -= 0.2;

  if (streak >= 7) baseSignal += 0.1;
  else if (streak >= 3) baseSignal += 0.05;

  return Math.max(-1, Math.min(1, baseSignal));
}

/**
 * Evaluate all signals and return a composite score.
 * Positive = good time to reach out, negative = bad time.
 */
export function evaluateSignals(
  inputs: SignalInputs,
  weights: SignalWeights,
): number {
  return (
    weights.activity * evaluateActivitySignal(inputs.activity) +
    weights.emotion * evaluateEmotionSignal(inputs.emotion) +
    weights.responsiveness * evaluateResponsivenessSignal(inputs.notificationHistory) +
    weights.temporal * evaluateTemporalSignal(inputs.currentHour) +
    weights.task * evaluateTaskSignal(inputs.task) +
    weights.bond * evaluateBondSignal(inputs.bond)
  );
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Get daemon state row for a user, creating if needed.
 */
export async function getDaemonState(userId: string): Promise<DaemonStateRow> {
  const db = await getDb();

  // Try to get existing row
  const existing = await db
    .selectFrom("daemon_state")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (existing) {
    return {
      user_id: existing.user_id,
      suppressed_until: existing.suppressed_until
        ? new Date(existing.suppressed_until)
        : null,
      last_interaction_at: existing.last_interaction_at
        ? new Date(existing.last_interaction_at)
        : new Date(),
      autonomous_work_count: existing.autonomous_work_count,
    };
  }

  // Create new row
  const now = new Date();
  await db
    .insertInto("daemon_state")
    .values({
      user_id: userId,
      suppressed_until: null,
      last_interaction_at: now,
      autonomous_work_count: 0,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .execute();

  return {
    user_id: userId,
    suppressed_until: null,
    last_interaction_at: now,
    autonomous_work_count: 0,
  };
}

/**
 * Update last interaction timestamp.
 */
export async function touchInteraction(userId: string): Promise<void> {
  const db = await getDb();
  const now = new Date();

  await db
    .insertInto("daemon_state")
    .values({
      user_id: userId,
      last_interaction_at: now,
      autonomous_work_count: 0,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        last_interaction_at: now,
        updated_at: now,
      }),
    )
    .execute();

  log.ambient.debug("Interaction touched", { userId });
}

/**
 * Suppress proactive contact until a specific time.
 */
export async function suppressUntil(
  userId: string,
  until: Date,
): Promise<void> {
  const db = await getDb();
  const now = new Date();

  await db
    .insertInto("daemon_state")
    .values({
      user_id: userId,
      suppressed_until: until,
      last_interaction_at: now,
      autonomous_work_count: 0,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        suppressed_until: until,
        updated_at: now,
      }),
    )
    .execute();

  log.ambient.info("Suppression set", { userId, until: until.toISOString() });
}

/**
 * Clear suppression.
 */
export async function clearSuppression(userId: string): Promise<void> {
  const db = await getDb();
  const now = new Date();

  await db
    .updateTable("daemon_state")
    .set({
      suppressed_until: null,
      updated_at: now,
    })
    .where("user_id", "=", userId)
    .execute();

  log.ambient.info("Suppression cleared", { userId });
}

/**
 * Get count of recently active sessions for a user.
 * A session is considered "active" if it had activity within the last hour.
 * Sessions without end_time but no recent activity are considered stale.
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  const db = await getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const result = await db
    .selectFrom("sessions")
    .select(db.fn.count<number>("id").as("count"))
    .where("user_id", "=", userId)
    .where("last_activity", ">", oneHourAgo)
    .executeTakeFirst();

  return Number(result?.count ?? 0);
}
