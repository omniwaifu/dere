/**
 * Swarm creation (spawn) route.
 */

import type { Hono } from "hono";

import { getDb } from "../../db.js";
import type { JsonValue } from "../../db-types.js";
import { log } from "../../logger.js";
import {
  STATUS,
  MEMORY_STEWARD_NAME,
  INCLUDE_MODES,
  type AgentSpec,
  type DependencySpec,
  type SwarmRow,
  type SwarmAgentRow,
} from "../types.js";
import { nowDate, parseJson } from "../utils.js";
import {
  buildMemoryPromptPrefix,
  buildDefaultSynthesisPrompt,
  buildSupervisorPrompt,
  buildMemoryStewardPrompt,
} from "../prompts.js";
import { detectDependencyCycle } from "../dependencies.js";
import { startSwarmViaTemporal } from "../temporal-bridge.js";
import { getCurrentBranch } from "../git.js";

function normalizeAgentSpec(raw: Record<string, unknown>): AgentSpec {
  const dependsRaw = Array.isArray(raw.depends_on) ? raw.depends_on : null;
  const depends: DependencySpec[] | null = dependsRaw
    ? dependsRaw.map((item) => {
        if (typeof item === "string") {
          return { agent: item, include: "summary" };
        }
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const includeRaw =
            typeof record.include === "string" ? record.include.toLowerCase() : "summary";
          const include = INCLUDE_MODES.has(includeRaw)
            ? (includeRaw as DependencySpec["include"])
            : "summary";
          return {
            agent: String(record.agent ?? ""),
            include,
            condition: typeof record.condition === "string" ? record.condition : null,
          };
        }
        return { agent: "", include: "summary" };
      })
    : null;

  return {
    name: String(raw.name ?? ""),
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    role: typeof raw.role === "string" ? raw.role : "generic",
    mode: typeof raw.mode === "string" ? raw.mode : "assigned",
    personality: typeof raw.personality === "string" ? raw.personality : null,
    plugins: Array.isArray(raw.plugins) ? raw.plugins.map(String) : null,
    depends_on: depends,
    allowed_tools: Array.isArray(raw.allowed_tools) ? raw.allowed_tools.map(String) : null,
    thinking_budget: typeof raw.thinking_budget === "number" ? raw.thinking_budget : null,
    model: typeof raw.model === "string" ? raw.model : null,
    sandbox_mode: typeof raw.sandbox_mode === "boolean" ? raw.sandbox_mode : true,
    goal: typeof raw.goal === "string" ? raw.goal : null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : null,
    task_types: Array.isArray(raw.task_types) ? raw.task_types.map(String) : null,
    max_tasks: typeof raw.max_tasks === "number" ? raw.max_tasks : null,
    max_duration_seconds:
      typeof raw.max_duration_seconds === "number" ? raw.max_duration_seconds : null,
    idle_timeout_seconds:
      typeof raw.idle_timeout_seconds === "number" ? raw.idle_timeout_seconds : 60,
  };
}

export function registerSpawnRoutes(app: Hono): void {
  app.post("/swarm/create", async (c) => {
    const payload = await parseJson<Record<string, JsonValue>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const name = typeof payload.name === "string" ? payload.name : "";
    const rawAgents = Array.isArray(payload.agents) ? payload.agents : [];
    if (!name.trim() || rawAgents.length === 0) {
      return c.json({ error: "name and agents are required" }, 400);
    }

    const agents = rawAgents.map((item) => normalizeAgentSpec(item as Record<string, unknown>));
    const nameSet = new Set(agents.map((agent) => agent.name));
    if (nameSet.size !== agents.length) {
      return c.json({ error: "Agent names must be unique" }, 400);
    }
    for (const spec of agents) {
      if (spec.depends_on) {
        for (const dep of spec.depends_on) {
          if (!nameSet.has(dep.agent)) {
            return c.json(
              { error: `Agent '${spec.name}' depends on unknown agent '${dep.agent}'` },
              400,
            );
          }
        }
      }
    }
    const cycle = detectDependencyCycle(agents);
    if (cycle) {
      return c.json({ error: `Circular dependency detected: ${cycle.join(" -> ")}` }, 400);
    }

    const parentSessionId =
      typeof payload.parent_session_id === "number" ? payload.parent_session_id : null;
    const description = typeof payload.description === "string" ? payload.description : null;
    const gitBranchPrefix =
      typeof payload.git_branch_prefix === "string" ? payload.git_branch_prefix : null;
    const autoSynthesize = Boolean(payload.auto_synthesize);
    const synthesisPrompt =
      typeof payload.synthesis_prompt === "string" ? payload.synthesis_prompt : null;
    const skipSynthesisOnFailure = Boolean(payload.skip_synthesis_on_failure);
    const autoSupervise = Boolean(payload.auto_supervise);
    const supervisorWarnSeconds =
      typeof payload.supervisor_warn_seconds === "number" ? payload.supervisor_warn_seconds : 600;
    const supervisorCancelSeconds =
      typeof payload.supervisor_cancel_seconds === "number"
        ? payload.supervisor_cancel_seconds
        : 1800;

    const db = await getDb();
    let workingDir =
      typeof payload.working_dir === "string" && payload.working_dir.trim()
        ? payload.working_dir
        : null;
    if (!workingDir && parentSessionId) {
      const parent = await db
        .selectFrom("sessions")
        .select(["working_dir"])
        .where("id", "=", parentSessionId)
        .executeTakeFirst();
      workingDir = parent?.working_dir ?? null;
    }
    if (!workingDir) {
      workingDir = process.cwd();
    }

    let baseBranch: string | null =
      typeof payload.base_branch === "string" ? payload.base_branch : null;
    if (gitBranchPrefix && !baseBranch) {
      try {
        baseBranch = await getCurrentBranch(workingDir);
      } catch {
        baseBranch = null;
      }
    }

    const swarm = await db
      .insertInto("swarms")
      .values({
        name,
        description,
        parent_session_id: parentSessionId,
        working_dir: workingDir,
        git_branch_prefix: gitBranchPrefix,
        base_branch: baseBranch,
        status: STATUS.PENDING,
        auto_synthesize: autoSynthesize,
        synthesis_prompt: synthesisPrompt,
        skip_synthesis_on_failure: skipSynthesisOnFailure,
        synthesis_output: null,
        synthesis_summary: null,
        auto_supervise: autoSupervise,
        supervisor_warn_seconds: supervisorWarnSeconds,
        supervisor_cancel_seconds: supervisorCancelSeconds,
        created_at: nowDate(),
        started_at: null,
        completed_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const nameToAgentId = new Map<string, number>();
    const createdAgents: Array<{ id: number; name: string; status: string }> = [];

    for (const spec of agents) {
      const gitBranch = gitBranchPrefix ? `${gitBranchPrefix}${spec.name}` : null;
      const prompt =
        spec.mode === "assigned"
          ? `${buildMemoryPromptPrefix(name, description, spec.name)}\n\n${spec.prompt}`.trim()
          : spec.prompt;

      const agentRow = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: spec.name,
          role: spec.role,
          is_synthesis_agent: false,
          mode: spec.mode,
          prompt,
          goal: spec.goal,
          capabilities: spec.capabilities,
          task_types: spec.task_types,
          max_tasks: spec.max_tasks,
          max_duration_seconds: spec.max_duration_seconds,
          idle_timeout_seconds: spec.idle_timeout_seconds,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: spec.personality,
          plugins: spec.plugins,
          git_branch: gitBranch,
          allowed_tools: spec.allowed_tools,
          thinking_budget: spec.thinking_budget,
          model: spec.model,
          sandbox_mode: spec.sandbox_mode,
          depends_on: null,
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();

      nameToAgentId.set(spec.name, agentRow.id);
      createdAgents.push({ id: agentRow.id, name: agentRow.name, status: agentRow.status });
    }

    // Auto-created agents inherit sandbox_mode from worker agents (false if any worker uses false)
    const defaultSandboxMode = agents.every((a) => a.sandbox_mode !== false);

    for (const spec of agents) {
      if (!spec.depends_on || spec.depends_on.length === 0) {
        continue;
      }
      const agentId = nameToAgentId.get(spec.name);
      if (!agentId) {
        continue;
      }
      const deps = spec.depends_on
        .map((dep) => {
          const depId = nameToAgentId.get(dep.agent);
          if (!depId) {
            return null;
          }
          return {
            agent_id: depId,
            include: dep.include,
            condition: dep.condition ?? null,
          };
        })
        .filter(Boolean) as Array<{ agent_id: number; include: string; condition?: string | null }>;

      await db
        .updateTable("swarm_agents")
        .set({ depends_on: JSON.stringify(deps) })
        .where("id", "=", agentId)
        .execute();
    }

    if (autoSynthesize) {
      const deps = createdAgents.map((agent) => ({
        agent_id: agent.id,
        include: "full",
      }));
      const synthesisAgent = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: "synthesis",
          role: "synthesis",
          is_synthesis_agent: true,
          mode: "assigned",
          prompt: synthesisPrompt ?? buildDefaultSynthesisPrompt(name),
          goal: null,
          capabilities: null,
          task_types: null,
          max_tasks: null,
          max_duration_seconds: null,
          idle_timeout_seconds: 60,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: null,
          plugins: ["dere_core"],
          git_branch: null,
          allowed_tools: null,
          thinking_budget: null,
          model: null,
          sandbox_mode: defaultSandboxMode,
          depends_on: JSON.stringify(deps),
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();
      createdAgents.push({
        id: synthesisAgent.id,
        name: synthesisAgent.name,
        status: synthesisAgent.status,
      });
    }

    if (autoSupervise) {
      const supervisorPrompt = buildSupervisorPrompt(
        name,
        agents.map((agent) => agent.name),
        supervisorWarnSeconds,
        supervisorCancelSeconds,
      );
      const supervisorAgent = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: "supervisor",
          role: "supervisor",
          is_synthesis_agent: false,
          mode: "assigned",
          prompt: supervisorPrompt,
          goal: null,
          capabilities: null,
          task_types: null,
          max_tasks: null,
          max_duration_seconds: null,
          idle_timeout_seconds: 60,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: null,
          plugins: ["dere_core"],
          git_branch: null,
          allowed_tools: null,
          thinking_budget: null,
          model: null,
          sandbox_mode: defaultSandboxMode,
          depends_on: null,
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();
      createdAgents.push({
        id: supervisorAgent.id,
        name: supervisorAgent.name,
        status: supervisorAgent.status,
      });
    }

    if (!nameToAgentId.has(MEMORY_STEWARD_NAME)) {
      const deps = createdAgents.map((agent) => ({
        agent_id: agent.id,
        include: agent.name === "synthesis" ? "full" : "summary",
      }));
      const memoryAgent = await db
        .insertInto("swarm_agents")
        .values({
          swarm_id: swarm.id,
          name: MEMORY_STEWARD_NAME,
          role: "generic",
          is_synthesis_agent: false,
          mode: "assigned",
          prompt: buildMemoryStewardPrompt(name),
          goal: null,
          capabilities: null,
          task_types: null,
          max_tasks: null,
          max_duration_seconds: null,
          idle_timeout_seconds: 60,
          tasks_completed: 0,
          tasks_failed: 0,
          current_task_id: null,
          personality: null,
          plugins: ["dere_core"],
          git_branch: null,
          allowed_tools: null,
          thinking_budget: null,
          model: null,
          sandbox_mode: defaultSandboxMode,
          depends_on: JSON.stringify(deps),
          session_id: null,
          status: STATUS.PENDING,
          output_text: null,
          output_summary: null,
          error_message: null,
          tool_count: 0,
          created_at: nowDate(),
          started_at: null,
          completed_at: null,
        })
        .returning(["id", "name", "status"])
        .executeTakeFirstOrThrow();
      createdAgents.push({
        id: memoryAgent.id,
        name: memoryAgent.name,
        status: memoryAgent.status,
      });
    }

    if (payload.auto_start !== false) {
      // Update status to RUNNING in a transaction for consistency
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable("swarms")
          .set({ status: STATUS.RUNNING, started_at: nowDate() })
          .where("id", "=", swarm.id)
          .where("status", "=", STATUS.PENDING) // Verify state hasn't changed
          .execute();
      });

      // Start execution via Temporal workflow
      // Fetch fresh swarm and agents for workflow input
      const allAgents = await db
        .selectFrom("swarm_agents")
        .selectAll()
        .where("swarm_id", "=", swarm.id)
        .execute();

      try {
        await startSwarmViaTemporal(swarm as SwarmRow, allAgents as SwarmAgentRow[]);
      } catch (error) {
        log.swarm.error("Failed to start Temporal workflow", {
          swarmId: swarm.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Update status back to pending on failure
        await db
          .updateTable("swarms")
          .set({ status: STATUS.PENDING, started_at: null })
          .where("id", "=", swarm.id)
          .execute();
        throw error;
      }
    }

    return c.json({
      swarm_id: swarm.id,
      name: swarm.name,
      status: payload.auto_start === false ? STATUS.PENDING : STATUS.RUNNING,
      agents: createdAgents,
    });
  });
}
