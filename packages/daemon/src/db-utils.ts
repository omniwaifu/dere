/**
 * Shared database utilities for common upsert patterns.
 * These prevent race conditions by using INSERT ON CONFLICT.
 */

import { sql, type Kysely } from "kysely";
import type { Database } from "./db-types.js";

// ============================================================================
// Session Utilities
// ============================================================================

export type SessionInsert = {
  id: number;
  workingDir: string;
  userId: string | null;
  medium: string | null;
  name?: string | null;
  personality?: string | null;
  thinkingBudget?: number | null;
  sandboxMode?: boolean;
  sandboxMountType?: string;
  sandboxSettings?: Record<string, unknown> | null;
  missionId?: number | null;
  continuedFrom?: number | null;
  projectType?: string | null;
};

export type SessionResult = {
  id: number;
  working_dir: string;
  medium: string | null;
  user_id: string | null;
};

/**
 * Ensure a session exists. Creates if missing, returns existing if present.
 * Uses INSERT ON CONFLICT DO NOTHING to handle race conditions.
 */
export async function ensureSession(
  db: Kysely<Database>,
  session: SessionInsert,
): Promise<SessionResult> {
  const now = new Date();
  const nowSeconds = Math.floor(Date.now() / 1000);

  await db
    .insertInto("sessions")
    .values({
      id: session.id,
      name: session.name ?? null,
      working_dir: session.workingDir,
      start_time: nowSeconds,
      end_time: null,
      last_activity: now,
      continued_from: session.continuedFrom ?? null,
      project_type: session.projectType ?? null,
      claude_session_id: null,
      personality: session.personality ?? null,
      medium: session.medium ?? "cli",
      user_id: session.userId,
      thinking_budget: session.thinkingBudget ?? null,
      sandbox_mode: session.sandboxMode ?? false,
      sandbox_mount_type: session.sandboxMountType ?? "none",
      sandbox_settings: session.sandboxSettings ?? null,
      is_locked: false,
      mission_id: session.missionId ?? null,
      created_at: now,
      summary: null,
      summary_updated_at: null,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  // Fetch the session (either we just created it or it already existed)
  const result = await db
    .selectFrom("sessions")
    .select(["id", "working_dir", "medium", "user_id"])
    .where("id", "=", session.id)
    .executeTakeFirst();

  return (
    result ?? {
      id: session.id,
      working_dir: session.workingDir,
      medium: session.medium ?? "cli",
      user_id: session.userId,
    }
  );
}

/**
 * Mark a session as ended.
 */
export async function closeSession(
  db: Kysely<Database>,
  sessionId: number,
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  await db
    .updateTable("sessions")
    .set({ end_time: nowSeconds, is_locked: true })
    .where("id", "=", sessionId)
    .execute();
}

// ============================================================================
// Context Cache Utilities
// ============================================================================

export type ContextCacheValues = {
  contextText: string;
  contextMetadata: Record<string, unknown>;
};

/**
 * Upsert context cache with full replacement.
 * Uses INSERT ON CONFLICT DO UPDATE to handle race conditions.
 */
export async function upsertContextCache(
  db: Kysely<Database>,
  sessionId: number,
  values: ContextCacheValues,
): Promise<void> {
  const now = new Date();

  await db
    .insertInto("context_cache")
    .values({
      session_id: sessionId,
      context_text: values.contextText,
      context_metadata: values.contextMetadata,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("session_id").doUpdateSet({
        context_text: values.contextText,
        context_metadata: values.contextMetadata,
        updated_at: now,
      }),
    )
    .execute();
}

/**
 * Upsert context cache with JSONB metadata merge.
 * Existing metadata fields are preserved, new fields are added/updated.
 * Uses INSERT ON CONFLICT with JSONB || operator for atomic merge.
 */
export async function mergeContextCacheMetadata(
  db: Kysely<Database>,
  sessionId: number,
  metadata: Record<string, unknown>,
  contextText = "",
): Promise<void> {
  const now = new Date();

  await db
    .insertInto("context_cache")
    .values({
      session_id: sessionId,
      context_text: contextText,
      context_metadata: metadata,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column("session_id").doUpdateSet({
        context_metadata: sql`COALESCE(context_cache.context_metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`,
        updated_at: now,
      }),
    )
    .execute();
}

// ============================================================================
// Scratchpad Utilities
// ============================================================================

export type ScratchpadEntry = {
  swarmId: number;
  key: string;
  value: Record<string, unknown> | unknown[] | string | number | boolean | null;
  agentId: number | null;
  agentName: string | null;
};

/**
 * Upsert a scratchpad entry.
 * Uses INSERT ON CONFLICT DO UPDATE to handle race conditions.
 */
export async function upsertScratchpadEntry(
  db: Kysely<Database>,
  entry: ScratchpadEntry,
): Promise<void> {
  const now = new Date();

  await db
    .insertInto("swarm_scratchpad")
    .values({
      swarm_id: entry.swarmId,
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.agentId,
      set_by_agent_name: entry.agentName,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(["swarm_id", "key"]).doUpdateSet({
        value: entry.value,
        set_by_agent_id: entry.agentId,
        set_by_agent_name: entry.agentName,
        updated_at: now,
      }),
    )
    .execute();
}
