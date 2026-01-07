// Swarm HTTP routes

import type { Hono, Context } from "hono";
import { sql } from "kysely";

import { getDb } from "../db.js";
import type { JsonValue } from "../db-types.js";
import { upsertScratchpadEntry } from "../db-utils.js";
import { listPersonalityInfos } from "../personalities/index.js";
import { log } from "../logger.js";
import { swarmState } from "./state.js";
import {
  STATUS,
  MEMORY_STEWARD_NAME,
  INCLUDE_MODES,
  isAgentTerminal,
  SwarmDatabaseError,
  type AgentSpec,
  type DependencySpec,
  type SwarmAgentRow,
} from "./types.js";
import { nowDate, parseJson, toJsonValue } from "./utils.js";
import {
  buildMemoryPromptPrefix,
  buildDefaultSynthesisPrompt,
  buildSupervisorPrompt,
  buildMemoryStewardPrompt,
} from "./prompts.js";
import { detectDependencyCycle, computeCriticalPath } from "./dependencies.js";
import { getSwarmWithAgents, getCompletionSignal } from "./execution.js";
import { startSwarmExecution } from "./orchestration.js";
import { getCurrentBranch, createBranch, mergeBranch, listPlugins, GitError } from "./git.js";

/**
 * Check if an error is a database connection/availability error.
 */
function isDbConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("timeout") ||
    message.includes("too many connections") ||
    message.includes("database")
  );
}

/**
 * Log and format error response for route handlers.
 */
function handleRouteError(operation: string, error: unknown, c: Context): Response {
  const message = error instanceof Error ? error.message : String(error);

  log.swarm.error(`Route error in ${operation}`, {
    operation,
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  if (isDbConnectionError(error)) {
    return c.json(
      { error: "Database temporarily unavailable", details: message },
      503,
    );
  }

  if (error instanceof GitError) {
    return c.json(
      { error: "Git operation failed", details: message, code: error.code },
      500,
    );
  }

  if (error instanceof SwarmDatabaseError) {
    return c.json(
      { error: "Database operation failed", details: message, operation: error.operation },
      500,
    );
  }

  return c.json({ error: "Internal server error", details: message }, 500);
}

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

export function registerSwarmRoutes(app: Hono): void {
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

      // Mark in-memory state as starting after DB update
      // For create, this should always succeed since the swarm is new
      swarmState.markStarting(swarm.id);
      void startSwarmExecution(swarm.id, true);
    }

    return c.json({
      swarm_id: swarm.id,
      name: swarm.name,
      status: payload.auto_start === false ? STATUS.PENDING : STATUS.RUNNING,
      agents: createdAgents,
    });
  });

  app.get("/swarm", async (c) => {
    const status = c.req.query("status");
    const limit = Math.max(1, Number(c.req.query("limit") ?? 50));

    const db = await getDb();
    let query = db
      .selectFrom("swarms as s")
      .leftJoin("swarm_agents as a", "a.swarm_id", "s.id")
      .select([
        "s.id",
        "s.name",
        "s.description",
        "s.status",
        "s.created_at",
        "s.started_at",
        "s.completed_at",
        sql<number>`count(a.id)`.as("agent_count"),
      ])
      .groupBy("s.id")
      .orderBy("s.created_at", "desc")
      .limit(limit);

    if (status) {
      query = query.where("s.status", "=", status);
    }

    const rows = await query.execute();
    return c.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        agent_count: Number(row.agent_count ?? 0),
        created_at: row.created_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
      })),
    );
  });

  app.get("/swarm/personalities", async (c) => {
    const personalities = await listPersonalityInfos();
    return c.json({ personalities: personalities.map((p) => p.name) });
  });

  app.get("/swarm/plugins", async (c) => {
    const plugins = await listPlugins();
    return c.json({ plugins });
  });

  app.get("/swarm/:swarm_id", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const result = await getSwarmWithAgents(swarmId);
    if (!result) {
      return c.json({ error: "Swarm not found" }, 404);
    }

    const criticalPath = computeCriticalPath(result.agents);
    return c.json({
      swarm_id: result.swarm.id,
      name: result.swarm.name,
      description: result.swarm.description,
      status: result.swarm.status,
      working_dir: result.swarm.working_dir,
      git_branch_prefix: result.swarm.git_branch_prefix,
      base_branch: result.swarm.base_branch,
      agents: result.agents.map((agent) => ({
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
      created_at: result.swarm.created_at,
      started_at: result.swarm.started_at,
      completed_at: result.swarm.completed_at,
      auto_synthesize: result.swarm.auto_synthesize,
      synthesis_output: result.swarm.synthesis_output,
      synthesis_summary: result.swarm.synthesis_summary,
      critical_path: criticalPath,
    });
  });

  app.get("/swarm/:swarm_id/dag", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    const format = c.req.query("format") ?? "json";
    const result = await getSwarmWithAgents(swarmId);
    if (!result) {
      return c.json({ error: "Swarm not found" }, 404);
    }

    const agents = result.agents;
    const idToAgent = new Map<number, SwarmAgentRow>();
    agents.forEach((agent) => idToAgent.set(agent.id, agent));

    const levels = new Map<number, number>();
    const computeLevel = (agent: SwarmAgentRow): number => {
      if (levels.has(agent.id)) {
        return levels.get(agent.id) as number;
      }
      if (!agent.depends_on || agent.depends_on.length === 0) {
        levels.set(agent.id, 0);
        return 0;
      }
      let maxDep = 0;
      for (const dep of agent.depends_on) {
        const depAgent = idToAgent.get(dep.agent_id);
        if (depAgent) {
          maxDep = Math.max(maxDep, computeLevel(depAgent) + 1);
        }
      }
      levels.set(agent.id, maxDep);
      return maxDep;
    };

    agents.forEach((agent) => computeLevel(agent));

    const nodes = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      level: levels.get(agent.id) ?? 0,
      started_at: agent.started_at,
      completed_at: agent.completed_at,
      error_message: agent.error_message,
    }));

    const edges: Array<{ source: string; target: string; include_mode: string }> = [];
    for (const agent of agents) {
      if (!agent.depends_on) {
        continue;
      }
      for (const dep of agent.depends_on) {
        const depAgent = idToAgent.get(dep.agent_id);
        if (!depAgent) {
          continue;
        }
        edges.push({
          source: depAgent.name,
          target: agent.name,
          include_mode: dep.include ?? "summary",
        });
      }
    }

    if (format === "dot") {
      const lines = [
        `digraph "${result.swarm.name}" {`,
        "  rankdir=LR;",
        "  node [shape=box, style=rounded];",
        "",
      ];
      const colors: Record<string, string> = {
        pending: "gray",
        running: "dodgerblue",
        completed: "green",
        failed: "red",
        cancelled: "orange",
        skipped: "lightgray",
      };
      for (const node of nodes) {
        const color = colors[node.status] ?? "gray";
        const label = `${node.name}\\n[${node.status}]`;
        lines.push(`  "${node.name}" [label="${label}", color=${color}, style=rounded];`);
      }
      lines.push("");
      for (const edge of edges) {
        const style = edge.include_mode === "none" ? "dashed" : "solid";
        const label = edge.include_mode === "summary" ? "" : ` [${edge.include_mode}]`;
        lines.push(`  "${edge.source}" -> "${edge.target}" [style=${style}, label="${label}"];`);
      }
      lines.push("}");
      return new Response(lines.join("\n"), { headers: { "content-type": "text/vnd.graphviz" } });
    }

    return c.json({
      swarm_id: result.swarm.id,
      name: result.swarm.name,
      status: result.swarm.status,
      nodes,
      edges,
    });
  });

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

    if (swarm.git_branch_prefix) {
      const agents = await db
        .selectFrom("swarm_agents")
        .select(["git_branch"])
        .where("swarm_id", "=", swarmId)
        .execute();
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

    // Pass true since we already marked as starting above
    void startSwarmExecution(swarmId, true);
    return c.json({ status: "started", swarm_id: swarmId });
  });

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

    // Mark in-memory state as starting AFTER DB transaction succeeds
    if (!swarmState.markStarting(swarmId)) {
      // Another request beat us - return success since swarm is already starting
      return c.json({ status: "resumed", swarm_id: swarmId, agents_reset: resumedAgentIds.length, note: "Already starting" });
    }

    // Pass true since we already marked as starting above
    void startSwarmExecution(swarmId, true);
    return c.json({ status: "resumed", swarm_id: swarmId, agents_reset: resumedAgentIds.length });
  });

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
    const agents = await db
      .selectFrom("swarm_agents")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .execute();

    const targets =
      agentNames && agentNames.length > 0
        ? agents.filter((agent) => agentNames.includes(agent.name))
        : agents;

    // Only wait for agents that aren't already in a terminal state
    const pendingTargets = targets.filter((agent) => !isAgentTerminal(agent.status));
    const promises = pendingTargets.map((agent) => getCompletionSignal(swarmId, agent.id).promise);
    let timedOut = false;
    if (timeoutSeconds && timeoutSeconds > 0) {
      await Promise.race([
        Promise.all(promises),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutSeconds * 1000),
        ),
      ]);
    } else {
      await Promise.all(promises);
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

  app.get("/swarm/:swarm_id/agent/:agent_name", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const agentName = c.req.param("agent_name");
    if (!Number.isFinite(swarmId) || !agentName) {
      return c.json({ error: "Invalid swarm_id or agent_name" }, 400);
    }

    try {
      const db = await getDb();
      const agent = await db
        .selectFrom("swarm_agents")
        .selectAll()
        .where("swarm_id", "=", swarmId)
        .where("name", "=", agentName)
        .executeTakeFirst();
      if (!agent) {
        return c.json({ error: "Agent not found" }, 404);
      }

      return c.json({
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
      });
    } catch (error) {
      return handleRouteError("getAgent", error, c);
    }
  });

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

      // Cancel in-memory state AFTER DB transaction succeeds
      // This resolves completion signals and sets the cancelled flag
      swarmState.cancelSwarm(swarmId);

      return c.json({ status: "cancelled", swarm_id: swarmId });
    } catch (error) {
      // Even if DB fails, try to cancel in-memory state to prevent orphaned agents
      swarmState.cancelSwarm(swarmId);
      return handleRouteError("cancelSwarm", error, c);
    }
  });

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

  app.get("/swarm/:swarm_id/scratchpad", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const prefix = c.req.query("prefix");
    if (!Number.isFinite(swarmId)) {
      return c.json({ error: "Invalid swarm_id" }, 400);
    }

    try {
      const db = await getDb();
      let query = db.selectFrom("swarm_scratchpad").selectAll().where("swarm_id", "=", swarmId);
      if (prefix) {
        query = query.where("key", "like", `${prefix}%`);
      }

      const entries = await query.orderBy("key", "asc").execute();
      return c.json(
        entries.map((entry) => ({
          key: entry.key,
          value: entry.value,
          set_by_agent_id: entry.set_by_agent_id,
          set_by_agent_name: entry.set_by_agent_name,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
        })),
      );
    } catch (error) {
      return handleRouteError("getScratchpad", error, c);
    }
  });

  app.get("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const db = await getDb();
    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();
    if (!entry) {
      return c.json({ error: `Key '${key}' not found in swarm ${swarmId}` }, 404);
    }

    return c.json({
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.set_by_agent_id,
      set_by_agent_name: entry.set_by_agent_name,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  });

  app.put("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const db = await getDb();
    const scratchValue = toJsonValue(payload.value);
    const agentId = typeof payload.agent_id === "number" ? payload.agent_id : null;
    const agentName = typeof payload.agent_name === "string" ? payload.agent_name : null;

    await upsertScratchpadEntry(db, {
      swarmId,
      key,
      value: scratchValue,
      agentId,
      agentName,
    });

    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirstOrThrow();

    return c.json({
      key: entry.key,
      value: entry.value,
      set_by_agent_id: entry.set_by_agent_id,
      set_by_agent_name: entry.set_by_agent_name,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  });

  app.delete("/swarm/:swarm_id/scratchpad/:key", async (c) => {
    const swarmId = Number(c.req.param("swarm_id"));
    const key = c.req.param("key");
    if (!Number.isFinite(swarmId) || !key) {
      return c.json({ error: "Invalid swarm_id or key" }, 400);
    }

    const db = await getDb();
    const entry = await db
      .selectFrom("swarm_scratchpad")
      .selectAll()
      .where("swarm_id", "=", swarmId)
      .where("key", "=", key)
      .executeTakeFirst();

    if (!entry) {
      return c.json({ error: `Key '${key}' not found in swarm ${swarmId}` }, 404);
    }

    await db.deleteFrom("swarm_scratchpad").where("id", "=", entry.id).execute();
    return c.json({ deleted: true, key });
  });
}
