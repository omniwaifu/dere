/**
 * Session management activities for swarm agents.
 *
 * These activities handle creating and closing database sessions for agents.
 * They are idempotent - safe to retry on failure.
 */

import { getDb } from "../../../db.js";
import { closeSession as dbCloseSession } from "../../../db-utils.js";
import type { CreateSessionInput, CloseSessionInput } from "./types.js";

/**
 * Create a database session for an agent.
 * Called before agent execution begins.
 */
export async function createAgentSession(input: CreateSessionInput): Promise<number> {
  const { swarm, agent } = input;
  const db = await getDb();
  const now = new Date();
  const sandboxMountType = agent.sandboxMode ? "copy" : "none";

  const session = await db
    .insertInto("sessions")
    .values({
      name: `swarm:${swarm.name}:${agent.name}`,
      working_dir: swarm.workingDir,
      start_time: Math.floor(now.getTime() / 1000),
      end_time: null,
      last_activity: now,
      continued_from: null,
      project_type: null,
      claude_session_id: null,
      personality: agent.personality,
      medium: "agent_api",
      user_id: null,
      thinking_budget: agent.thinkingBudget,
      sandbox_mode: agent.sandboxMode,
      sandbox_mount_type: sandboxMountType,
      sandbox_settings: null,
      is_locked: false,
      mission_id: null,
      created_at: now,
      summary: null,
      summary_updated_at: null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return session.id;
}

/**
 * Close a session after agent completion.
 * Called in finally block - always runs regardless of success/failure.
 */
export async function closeAgentSession(input: CloseSessionInput): Promise<void> {
  const { sessionId } = input;
  const db = await getDb();
  await dbCloseSession(db, sessionId);
}
