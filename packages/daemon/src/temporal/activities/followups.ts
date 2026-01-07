/**
 * Follow-up task creation for temporal activities.
 * Includes exploration follow-ups, gap detection, and underexplored entity tasks.
 */

import {
  findUnexploredEntities,
  findUnderexploredEntities,
} from "@dere/graph";

import { getDb } from "../../db.js";
import { log } from "../../logger.js";
import type { CuriosityTask } from "./types.js";

/**
 * Create follow-up curiosity tasks from exploration questions.
 */
export async function spawnFollowUps(
  task: CuriosityTask,
  questions: string[],
): Promise<number> {
  const followUps = questions.filter(Boolean).slice(0, 5);
  if (followUps.length === 0) {
    return 0;
  }

  const db = await getDb();
  let created = 0;

  for (const question of followUps) {
    const existing = await db
      .selectFrom("project_tasks")
      .select(["id"])
      .where("task_type", "=", "curiosity")
      .where("title", "=", question)
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      continue;
    }

    const now = new Date();
    const extra = {
      curiosity_type: "research_chain",
      source_context: task.title,
      trigger_reason: "follow_up_from_exploration",
    };

    await db
      .insertInto("project_tasks")
      .values({
        working_dir: task.working_dir,
        title: question,
        description: `Follow-up from exploration of '${task.title}'`,
        task_type: "curiosity",
        priority: 1,
        status: "ready",
        extra,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        acceptance_criteria: null,
        context_summary: null,
        scope_paths: null,
        required_tools: null,
        tags: null,
        estimated_effort: null,
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        attempt_count: 0,
        blocked_by: null,
        related_task_ids: null,
        created_by_session_id: null,
        created_by_agent_id: null,
        discovered_from_task_id: task.id,
        discovery_reason: "research_chain",
        outcome: null,
        completion_notes: null,
        files_changed: null,
        follow_up_task_ids: null,
        last_error: null,
      })
      .execute();

    created += 1;
  }

  return created;
}

/**
 * Create curiosity tasks from unexplored entities in the knowledge graph.
 *
 * This is the key integration point between graph-native gap detection
 * and the exploration system. Entities that are mentioned but unexplored
 * become curiosity tasks.
 */
export async function createGapTasks(
  groupId: string,
  workingDir: string,
  options: {
    /** Maximum tasks to create (default: 5) */
    limit?: number;
    /** Priority for created tasks (default: 2, higher than follow-ups) */
    priority?: number;
    /** Minimum inbound references to consider (default: 2) */
    minInbound?: number;
  } = {},
): Promise<{ created: number; skipped: number }> {
  const limit = options.limit ?? 5;
  const priority = options.priority ?? 2;
  const minInbound = options.minInbound ?? 2;

  let unexplored;
  try {
    unexplored = await findUnexploredEntities(groupId, {
      minInbound,
      limit: limit * 2, // Fetch extra in case some already exist as tasks
      excludeWithSummary: false,
    });
  } catch (error) {
    log.ambient.warn("Gap detection query failed", { error: String(error) });
    return { created: 0, skipped: 0 };
  }

  if (unexplored.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const db = await getDb();
  let created = 0;
  let skipped = 0;

  for (const entity of unexplored) {
    if (created >= limit) {
      break;
    }

    // Check if task already exists for this entity by UUID (not title - names can change)
    const existing = await db
      .selectFrom("project_tasks")
      .select(["id"])
      .where("task_type", "=", "curiosity")
      .where("extra", "@>", JSON.stringify({ entity_uuid: entity.uuid }))
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      skipped += 1;
      continue;
    }

    const title = `Learn more about ${entity.name}`;

    const now = new Date();
    const labelStr = entity.labels.length > 0 ? ` (${entity.labels.join(", ")})` : "";
    const extra = {
      curiosity_type: "gap_detection",
      trigger_reason: "unexplored_entity",
      entity_uuid: entity.uuid,
      entity_name: entity.name,
      entity_labels: entity.labels,
      inbound_references: entity.inbound_count,
    };

    await db
      .insertInto("project_tasks")
      .values({
        working_dir: workingDir,
        title,
        description: `Entity "${entity.name}"${labelStr} is referenced ${entity.inbound_count} times but has no outgoing relationships. This is a knowledge gap worth exploring.`,
        task_type: "curiosity",
        priority,
        status: "ready",
        extra,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        acceptance_criteria: null,
        context_summary: entity.summary || null,
        scope_paths: null,
        required_tools: null,
        tags: ["gap-detection"],
        estimated_effort: null,
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        attempt_count: 0,
        blocked_by: null,
        related_task_ids: null,
        created_by_session_id: null,
        created_by_agent_id: null,
        discovered_from_task_id: null,
        discovery_reason: "gap_detection",
        outcome: null,
        completion_notes: null,
        files_changed: null,
        follow_up_task_ids: null,
        last_error: null,
      })
      .execute();

    created += 1;
    log.ambient.debug("Created gap task", {
      entity: entity.name,
      inboundCount: entity.inbound_count,
    });
  }

  return { created, skipped };
}

/**
 * Create curiosity tasks from underexplored entities (ratio-based).
 *
 * More nuanced than gap detection - finds entities with many inbound
 * references but proportionally few outbound relationships.
 */
export async function createUnderexploredTasks(
  groupId: string,
  workingDir: string,
  options: {
    /** Maximum tasks to create (default: 3) */
    limit?: number;
    /** Priority for created tasks (default: 1) */
    priority?: number;
  } = {},
): Promise<{ created: number; skipped: number }> {
  const limit = options.limit ?? 3;
  const priority = options.priority ?? 1;

  let underexplored;
  try {
    underexplored = await findUnderexploredEntities(groupId, {
      minEdges: 3,
      maxRatio: 0.3,
      limit: limit * 2,
    });
  } catch (error) {
    log.ambient.warn("Underexplored query failed", { error: String(error) });
    return { created: 0, skipped: 0 };
  }

  if (underexplored.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const db = await getDb();
  let created = 0;
  let skipped = 0;

  for (const entity of underexplored) {
    if (created >= limit) {
      break;
    }

    // Check if task already exists for this entity by UUID (not title - names can change)
    const existing = await db
      .selectFrom("project_tasks")
      .select(["id"])
      .where("task_type", "=", "curiosity")
      .where("extra", "@>", JSON.stringify({ entity_uuid: entity.uuid }))
      .limit(1)
      .executeTakeFirst();

    if (existing) {
      skipped += 1;
      continue;
    }

    const title = `Explore ${entity.name} in more depth`;

    const now = new Date();
    const ratioPercent = Math.round(entity.exploration_ratio * 100);
    const extra = {
      curiosity_type: "underexplored",
      trigger_reason: "low_exploration_ratio",
      entity_uuid: entity.uuid,
      entity_name: entity.name,
      entity_labels: entity.labels,
      inbound_references: entity.inbound_count,
      outbound_references: entity.outbound_count,
      exploration_ratio: entity.exploration_ratio,
    };

    await db
      .insertInto("project_tasks")
      .values({
        working_dir: workingDir,
        title,
        description: `Entity "${entity.name}" has ${entity.inbound_count} inbound but only ${entity.outbound_count} outbound relationships (${ratioPercent}% exploration ratio). Worth investigating what it relates to.`,
        task_type: "curiosity",
        priority,
        status: "ready",
        extra,
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
        acceptance_criteria: null,
        context_summary: entity.summary || null,
        scope_paths: null,
        required_tools: null,
        tags: ["underexplored"],
        estimated_effort: null,
        claimed_by_session_id: null,
        claimed_by_agent_id: null,
        claimed_at: null,
        attempt_count: 0,
        blocked_by: null,
        related_task_ids: null,
        created_by_session_id: null,
        created_by_agent_id: null,
        discovered_from_task_id: null,
        discovery_reason: "underexplored",
        outcome: null,
        completion_notes: null,
        files_changed: null,
        follow_up_task_ids: null,
        last_error: null,
      })
      .execute();

    created += 1;
    log.ambient.debug("Created underexplored task", {
      entity: entity.name,
      ratio: entity.exploration_ratio,
    });
  }

  return { created, skipped };
}
