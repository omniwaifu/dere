/**
 * Status and query routes for swarms.
 */

import type { Hono } from "hono";
import { sql } from "kysely";

import { getDb } from "../../db.js";
import { listPersonalityInfos } from "../../personalities/index.js";
import type { SwarmAgentRow } from "../types.js";
import { computeCriticalPath } from "../dependencies.js";
import { getSwarmWithAgents } from "../execution.js";
import { listPlugins } from "../git.js";
import { handleRouteError } from "./helpers.js";

export function registerStatusRoutes(app: Hono): void {
  // List all swarms
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

  // List available personalities
  app.get("/swarm/personalities", async (c) => {
    const personalities = await listPersonalityInfos();
    return c.json({ personalities: personalities.map((p) => p.name) });
  });

  // List available plugins
  app.get("/swarm/plugins", async (c) => {
    const plugins = await listPlugins();
    return c.json({ plugins });
  });

  // Get swarm details
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

  // Get swarm DAG visualization
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

  // Get single agent details
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
}
