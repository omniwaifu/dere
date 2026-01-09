/**
 * Control routes for swarm execution (start, resume, wait, cancel, merge).
 */

import type { Hono } from "hono";

import { getDb } from "../../db.js";
import { log } from "../../logger.js";
import { STATUS, isAgentTerminal, type SwarmRow, type SwarmAgentRow } from "../types.js";
import { nowDate, parseJson } from "../utils.js";
import { swarmState } from "../state.js";
import { startSwarmViaTemporal, cancelSwarmWorkflow } from "../temporal-bridge.js";
import { createBranch, mergeBranch } from "../git.js";
import { handleRouteError } from "./helpers.js";

export function registerControlRoutes(app: Hono): void {
  // Start a pending swarm
  app.post("/swarm/:swarm_id/start", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    // Check in-memory state first to fail fast
    if (swarmState.isSwarmActive(swarmId)) {
      return c.json({ error: "Swarm is already running or starting" }, 400);
    }

    const db = await getDb();
    const swarm = await db
      .selectFrom("swarms")
      .selectAll()
      .where("id", "=", swarmId)
      .executeTakeFirst();
    if (!swarm) {
      return c.json({ error: "Swarm not found" }, 404);
    }
    if (swarm.status !== STATUS.PENDING) {
      return c.json({ error: "Swarm is not in pending state" }, 400);
    }

    // Use transaction to ensure status update is atomic with validation
    const now = nowDate();
    const updated = await db.transaction().execute(async (trx) => {
      // Re-check status inside transaction to prevent race
      const current = await trx
        .selectFrom("swarms")
        .select("status")
        .where("id", "=", swarmId)
        .executeTakeFirst();
      if (current?.status !== STATUS.PENDING) {
        return false;
      }

      await trx
        .updateTable("swarms")
        .set({ status: STATUS.RUNNING, started_at: now })
        .where("id", "=", swarmId)
        .execute();
      return true;
    });

    if (!updated) {
      return c.json({ error: "Swarm is not in pending state" }, 400);
    }

    // Mark in-memory state as starting AFTER DB transaction succeeds
    // This ensures DB and in-memory state stay synchronized
    if (!swarmState.markStarting(swarmId)) {
      // Another request beat us to it after the transaction - this shouldn't happen
      // but if it does, log and return success since swarm is already starting
      return c.json({ status: "started", swarm_id: swarmId, note: "Already starting" });
    }

    // Fetch all agents for workflow input and git branch creation
    const agents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    if (swarm.git_branch_prefix) {
      for (const agent of agents) {
        if (!agent.git_branch) {
          continue;
        }
        try {
          await createBranch(swarm.working_dir, agent.git_branch, swarm.base_branch ?? "HEAD");
        } catch {
          // ignore git errors
        }
      }
    }

    // Start execution via Temporal workflow
    try {
      await startSwarmViaTemporal(swarm as SwarmRow, agents as SwarmAgentRow[]);
    } catch (error) {
      log.swarm.error("Failed to start Temporal workflow", {
        swarmId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Rollback status on failure
      await db
        .updateTable("swarms")
        .set({ status: STATUS.PENDING, started_at: null })
        .where("id", "=", swarmId)
        .execute();
      return handleRouteError("startSwarm", error, c);
    }

    return c.json({ status: "started", swarm_id: swarmId });
  });

  // Resume failed/cancelled agents in a swarm
  app.post("/swarm/:swarm_id/resume", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    // Check in-memory state first to fail fast
    if (swarmState.isSwarmActive(swarmId)) {
      return c.json({ error: "Swarm is already running or starting" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const fromAgents = Array.isArray(payload?.from_agents) ? payload.from_agents.map(String) : null;
    const resetFailed = payload?.reset_failed !== false;

    const db = await getDb();
    const now = nowDate();

    // Use transaction to ensure all agent resets and swarm status update are atomic
    const resumedAgentIds = await db.transaction().execute(async (trx) => {
      const agents = await trx
        .selectFrom("swarm_agents")
        .selectAll()
        .where("swarm_id", "=", swarmId)
        .execute();

      const targets = agents.filter((agent) => {
        if (fromAgents && fromAgents.length > 0) {
          return fromAgents.includes(agent.name);
        }
        if (resetFailed) {
          return agent.status === STATUS.FAILED || agent.status === STATUS.CANCELLED;
        }
        return agent.status === STATUS.FAILED;
      });

      if (targets.length === 0) {
        return [];
      }

      const targetIds = targets.map((a) => a.id);

      // Reset all target agents atomically
      await trx
        .updateTable("swarm_agents")
        .set({
          status: STATUS.PENDING,
          error_message: null,
          output_text: null,
          output_summary: null,
          completed_at: null,
          started_at: null,
        })
        .where("id", "in", targetIds)
        .execute();

      // Update swarm status - include started_at for proper timing tracking on resume
      await trx
        .updateTable("swarms")
        .set({ status: STATUS.RUNNING, started_at: now, completed_at: null })
        .where("id", "=", swarmId)
        .execute();

      return targetIds;
    });

    if (resumedAgentIds.length === 0) {
      return c.json({ error: "No agents to resume" }, 400);
    }

    // Fetch swarm and agents for workflow input
    const swarm = await db
      .selectFrom("swarms")
      .selectAll()
      .where("id", "=", swarmId)
      .executeTakeFirst();
    const agents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    if (!swarm) {
      return c.json({ error: "Swarm not found after resume" }, 500);
    }

    // Start execution via Temporal workflow
    try {
      await startSwarmViaTemporal(swarm as SwarmRow, agents as SwarmAgentRow[]);
    } catch (error) {
      log.swarm.error("Failed to start Temporal workflow on resume", {
        swarmId,
        error: error instanceof Error ? error.message : String(error),
      });
      return handleRouteError("resumeSwarm", error, c);
    }

    return c.json({ status: "resumed", swarm_id: swarmId, agents_reset: resumedAgentIds.length });
  });

  // Wait for agents to complete (blocking poll)
  app.post("/swarm/:swarm_id/wait", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const agentNames = Array.isArray(payload?.agent_names) ? payload.agent_names.map(String) : null;
    const timeoutSeconds =
      typeof payload?.timeout_seconds === "number" ? payload.timeout_seconds : null;

    const db = await getDb();
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds ? timeoutSeconds * 1000 : 300_000; // default 5 min
    const pollIntervalMs = 2_000; // poll every 2 seconds

    // Poll database until all target agents are in terminal state
    let timedOut = false;
    while (true) {
      const agents = await db
        .selectFrom("swarm_agents")
        .selectAll()
        .where("swarm_id", "=", swarmId)
        .execute();

      const targets =
        agentNames && agentNames.length > 0
          ? agents.filter((agent) => agentNames.includes(agent.name))
          : agents;

      const pendingTargets = targets.filter((agent) => !isAgentTerminal(agent.status));

      if (pendingTargets.length === 0) {
        // All targets are complete
        break;
      }

      // Check timeout
      if (Date.now() - startTime >= timeoutMs) {
        timedOut = true;
        break;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    if (timedOut) {
      return c.json({ error: "Timeout waiting for agents" }, 408);
    }

    const updatedAgents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    const selected =
      agentNames && agentNames.length > 0
        ? updatedAgents.filter((agent) => agentNames.includes(agent.name))
        : updatedAgents;

    return c.json(
      selected.map((agent) => ({
        agent_id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        output_text: agent.output_text,
        output_summary: agent.output_summary,
        error_message: agent.error_message,
        tool_count: agent.tool_count,
        started_at: agent.started_at,
        completed_at: agent.completed_at,
      })),
    );
  });

  // Cancel a running swarm
  app.post("/swarm/:swarm_id/cancel", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    try {
      const db = await getDb();

      // Use transaction to update DB state first
      // This ensures we don't have in-memory state cancelled while DB shows running
      await db.transaction().execute(async (trx) => {
        const now = nowDate();
        await trx
          .updateTable("swarms")
          .set({ status: STATUS.CANCELLED, completed_at: now })
          .where("id", "=", swarmId)
          .execute();

        await trx
          .updateTable("swarm_agents")
          .set({ status: STATUS.CANCELLED, completed_at: now })
          .where("swarm_id", "=", swarmId)
          .where("status", "in", [STATUS.PENDING, STATUS.RUNNING])
          .execute();
      });

      // Cancel in-memory state (for non-Temporal swarms)
      swarmState.cancelSwarm(swarmId);

      // Cancel Temporal workflow if running
      try {
        await cancelSwarmWorkflow(`swarm-${swarmId}`);
      } catch {
        // Workflow may not exist or already completed - ignore
      }

      return c.json({ status: "cancelled", swarm_id: swarmId });
    } catch (error) {
      // Even if DB fails, try to cancel both in-memory and Temporal state
      swarmState.cancelSwarm(swarmId);
      try {
        await cancelSwarmWorkflow(`swarm-${swarmId}`);
      } catch {
        // ignore
      }
      return handleRouteError("cancelSwarm", error, c);
    }
  });

  // Merge agent branches back to target branch
  app.post("/swarm/:swarm_id/merge", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    const targetBranch =
      typeof payload?.target_branch === "string" ? payload.target_branch : "main";
    const strategy = typeof payload?.strategy === "string" ? payload.strategy : "sequential";

    try {
      const db = await getDb();
      const swarm = await db
        .selectFrom("swarms")
        .selectAll()
        .where("id", "=", swarmId)
        .executeTakeFirst();
      if (!swarm) {
        return c.json({ error: "Swarm not found" }, 404);
      }

      const agents = await db
        .selectFrom("swarm_agents")
        .select(["git_branch", "name", "status"])
        .where("swarm_id", "=", swarmId)
        .execute();

      const completedAgents = agents.filter(
        (agent) => agent.git_branch && agent.status === STATUS.COMPLETED,
      );

      if (completedAgents.length === 0) {
        return c.json({
          success: true,
          merged_branches: [],
          failed_branches: [],
          conflicts: [],
          error: null,
          message: "No completed agents with git branches to merge",
        });
      }

      const merged: string[] = [];
      const failed: string[] = [];
      const conflicts: string[] = [];
      const errors: Record<string, string> = {};

      for (const agent of completedAgents) {
        try {
          const result = await mergeBranch(
            swarm.working_dir,
            agent.git_branch as string,
            targetBranch,
            strategy === "sequential",
            `Merge swarm agent '${agent.name}' (${swarm.name})`,
          );
          if (result.success) {
            merged.push(agent.git_branch as string);
          } else {
            failed.push(agent.git_branch as string);
            if (result.conflictFiles && result.conflictFiles.length > 0) {
              conflicts.push(agent.git_branch as string);
            }
            if (result.error) {
              errors[agent.git_branch as string] = result.error;
            }
          }
        } catch (error) {
          const branch = agent.git_branch as string;
          failed.push(branch);
          errors[branch] = error instanceof Error ? error.message : String(error);
          log.swarm.error("Merge failed for branch", {
            swarmId,
            agentName: agent.name,
            branch,
            error: errors[branch],
          });
        }
      }

      return c.json({
        success: failed.length === 0,
        merged_branches: merged,
        failed_branches: failed,
        conflicts,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        error: failed.length > 0 ? "Some branches failed to merge" : null,
      });
    } catch (error) {
      return handleRouteError("mergeSwarm", error, c);
    }
  });
}
