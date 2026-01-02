import type { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";

import { loadConfig } from "@dere/shared-config";
import { buildSessionContextXml } from "./prompt-context.js";
import {
  graphAvailable,
  queryGraph,
  toDate,
  toNumber,
  toStringArray,
  searchGraph,
  trackEntityRetrievals,
  type SearchFilters,
} from "@dere/graph";

import { getDb } from "./db.js";
import { buildContextMetadata } from "./context-tracking.js";

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

function nowDate(): Date {
  return new Date();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function ensureSession(
  sessionId: number,
  workingDir: string,
  userId: string | null,
  medium: string | null,
): Promise<{ id: number; working_dir: string; medium: string | null; user_id: string | null }> {
  const db = await getDb();
  const existing = await db
    .selectFrom("sessions")
    .select(["id", "working_dir", "medium", "user_id"])
    .where("id", "=", sessionId)
    .executeTakeFirst();

  if (existing) {
    return existing;
  }

  const now = nowDate();
  await db
    .insertInto("sessions")
    .values({
      id: sessionId,
      working_dir: workingDir,
      start_time: nowSeconds(),
      personality: null,
      medium: medium ?? "cli",
      last_activity: now,
      sandbox_mode: false,
      sandbox_mount_type: "none",
      is_locked: false,
      sandbox_settings: null,
      continued_from: null,
      project_type: null,
      claude_session_id: null,
      user_id: userId,
      thinking_budget: null,
      mission_id: null,
      created_at: now,
      summary: null,
      summary_updated_at: null,
      name: null,
      end_time: null,
    })
    .execute();

  return {
    id: sessionId,
    working_dir: workingDir,
    medium: medium ?? "cli",
    user_id: userId,
  };
}

async function isCodeProjectDir(workingDir: string): Promise<boolean> {
  if (!workingDir.trim()) {
    return false;
  }

  const resolved = resolve(workingDir);
  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    await stat(join(resolved, ".git"));
    return true;
  } catch {
    // ignore
  }

  const markers = [
    "pyproject.toml",
    "setup.py",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "CMakeLists.txt",
    "Makefile",
  ];

  for (const marker of markers) {
    try {
      await stat(join(resolved, marker));
      return true;
    } catch {
      // continue
    }
  }

  try {
    const config = await loadConfig();
    const plugins = (config.plugins ?? {}) as Record<string, unknown>;
    const codePlugin = (plugins.dere_code ?? {}) as Record<string, unknown>;
    const directories = Array.isArray(codePlugin.directories) ? codePlugin.directories : [];

    for (const dir of directories) {
      if (typeof dir !== "string") {
        continue;
      }
      const codeDir = resolve(dir);
      if (resolved.startsWith(codeDir)) {
        return true;
      }
    }
  } catch {
    // ignore
  }

  return false;
}

function detectSessionType(session: {
  medium: string | null;
  working_dir: string;
}): Promise<"code" | "conversational"> {
  if (session.medium === "discord" || session.medium === "telegram") {
    return Promise.resolve("conversational");
  }
  if (!session.working_dir || !session.working_dir.trim()) {
    return Promise.resolve("conversational");
  }
  return isCodeProjectDir(session.working_dir).then((isCode) =>
    isCode ? "code" : "conversational",
  );
}

function extractProjectName(workingDir: string): string | null {
  if (!workingDir.trim()) {
    return null;
  }
  const name = resolve(workingDir).split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (!name) {
    return null;
  }
  if (name.length > 50) {
    return `${name.slice(0, 47)}...`;
  }
  return name;
}

async function getRecentGitCommits(workingDir: string, limit = 5): Promise<string[]> {
  if (!workingDir.trim()) {
    return [];
  }
  try {
    await stat(join(workingDir, ".git"));
  } catch {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", `-${limit}`, "--oneline", "--no-decorate"],
      {
        cwd: workingDir,
        timeout: 5000,
      },
    );
    if (!stdout) {
      return [];
    }
    return stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildCodeSessionContext(
  projectName: string | null,
  kgResults: Array<{ summary?: string; fact?: string }>,
  gitCommits: string[],
  limit = 5,
): string {
  const parts: string[] = [];
  parts.push(`<session_start_context type="code" project="${projectName ?? "unknown"}">`);

  if (kgResults.length > 0) {
    parts.push("  <recent_work>");
    kgResults.slice(0, limit).forEach((item) => {
      if (item.summary) {
        parts.push(`    - ${item.summary}`);
      } else if (item.fact) {
        parts.push(`    - ${item.fact}`);
      }
    });
    parts.push("  </recent_work>");
  }

  if (gitCommits.length > 0) {
    parts.push("  <recent_commits>");
    gitCommits.forEach((commit) => {
      parts.push(`    ${commit}`);
    });
    parts.push("  </recent_commits>");
  }

  parts.push("</session_start_context>");
  return parts.join("\n");
}

function buildConversationalContext(
  kgResults: Array<{ name?: string; summary?: string; fact?: string }>,
  limit = 5,
): string {
  const parts: string[] = [];
  parts.push('<session_start_context type="conversational">');
  if (kgResults.length > 0) {
    parts.push("  <recent_topics>");
    kgResults.slice(0, limit).forEach((item) => {
      if (item.summary && item.name) {
        parts.push(`    - ${item.name}: ${item.summary}`);
      } else if (item.fact) {
        parts.push(`    - ${item.fact}`);
      }
    });
    parts.push("  </recent_topics>");
  }
  parts.push("</session_start_context>");
  return parts.join("\n");
}

async function fetchEpisodes(episodeUuids: string[]) {
  if (episodeUuids.length === 0) {
    return new Map<string, JsonRecord>();
  }
  const records = await queryGraph(
    `
      MATCH (e:Episodic)
      WHERE e.uuid IN $uuids
      RETURN e.uuid AS uuid,
             e.name AS name,
             e.source_description AS source_description,
             e.content AS content,
             e.valid_at AS valid_at,
             e.created_at AS created_at
    `,
    { uuids: episodeUuids },
  );

  const map = new Map<string, JsonRecord>();
  for (const record of records) {
    const uuid = String(record.uuid ?? "");
    if (!uuid) {
      continue;
    }
    map.set(uuid, record);
  }
  return map;
}

function formatCitation(episode: JsonRecord, maxChars: number): string {
  const headerParts = [];
  const name = typeof episode.name === "string" ? episode.name : "";
  const source = typeof episode.source_description === "string" ? episode.source_description : "";
  const validAt = toDate(episode.valid_at);

  if (name) {
    headerParts.push(name);
  }
  if (source) {
    headerParts.push(source);
  }
  if (validAt) {
    headerParts.push(validAt.toISOString().slice(0, 10));
  }

  let snippet = typeof episode.content === "string" ? episode.content : "";
  snippet = snippet.replace(/\s+/g, " ").trim();
  if (maxChars > 0 && snippet.length > maxChars) {
    snippet = `${snippet.slice(0, maxChars).trim()}...`;
  }

  const header = headerParts.filter(Boolean).join(" - ");
  if (snippet) {
    return `${header}: ${snippet}`;
  }
  return header;
}

async function fetchFactRoles(factUuids: string[], groupId: string): Promise<Map<string, string>> {
  if (factUuids.length === 0) {
    return new Map();
  }

  const records = await queryGraph(
    `
      MATCH (f:Fact {group_id: $group_id})-[r:HAS_ROLE]->(e:Entity {group_id: $group_id})
      WHERE f.uuid IN $uuids
      RETURN f.uuid AS fact_uuid, e.name AS entity_name, r.role AS role, r.role_description AS role_description
    `,
    { group_id: groupId, uuids: factUuids },
  );

  const map = new Map<string, string>();
  for (const record of records) {
    const factUuid = String(record.fact_uuid ?? "");
    const entityName = String(record.entity_name ?? "");
    const role = String(record.role ?? "");
    if (!factUuid || !entityName || !role) {
      continue;
    }
    const roleDesc = record.role_description ? ` (${record.role_description})` : "";
    const entry = `${role}=${entityName}${roleDesc}`;
    const existing = map.get(factUuid);
    map.set(factUuid, existing ? `${existing}; ${entry}` : entry);
  }
  return map;
}

export function registerContextRoutes(app: Hono): void {
  app.post("/context/build", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    const projectPath = typeof payload.project_path === "string" ? payload.project_path : "";
    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const contextDepth = toNumber(payload.context_depth, 5);
    const includeCitations = payload.include_citations !== false;
    const citationLimitPerEdge = toNumber(payload.citation_limit_per_edge, 2);
    const citationMaxChars = toNumber(payload.citation_max_chars, 160);
    const currentPrompt = typeof payload.current_prompt === "string" ? payload.current_prompt : "";

    if (!sessionId || !currentPrompt.trim()) {
      return c.json({ error: "session_id and current_prompt are required" }, 400);
    }

    await ensureSession(sessionId, projectPath, userId, null);
    const groupId = userId ?? "default";

    if (!(await graphAvailable())) {
      return c.json({ status: "unavailable", context: "" });
    }

    try {
      const searchResults = await searchGraph({
        query: currentPrompt,
        groupId,
        limit: contextDepth * 2,
        rerankMethod: "episode_mentions",
        rerankAlpha: 0.5,
        recencyWeight: 0.3,
      });
      if (searchResults.nodes.length > contextDepth) {
        searchResults.nodes = searchResults.nodes.slice(0, contextDepth);
      }

      if (searchResults.nodes.length > 0) {
        await trackEntityRetrievals(searchResults.nodes.map((node) => node.uuid));
      }

      let citationsLookup = new Map<string, string[]>();
      let factCitationsLookup = new Map<string, string[]>();
      let factRolesLookup = new Map<string, string>();

      if (includeCitations) {
        const edgeEpisodes = new Map<string, string[]>();
        for (const edge of searchResults.edges) {
          const edgeUuid = String(edge.uuid ?? "");
          const episodes = toStringArray(edge.episodes);
          if (edgeUuid && episodes.length > 0) {
            edgeEpisodes.set(edgeUuid, episodes);
          }
        }

        const factEpisodes = new Map<string, string[]>();
        for (const fact of searchResults.facts) {
          const factUuid = String(fact.uuid ?? "");
          const episodes = toStringArray(fact.episodes);
          if (factUuid && episodes.length > 0) {
            factEpisodes.set(factUuid, episodes);
          }
        }

        const allEpisodeUuids = Array.from(
          new Set([
            ...Array.from(edgeEpisodes.values()).flat(),
            ...Array.from(factEpisodes.values()).flat(),
          ]),
        );
        const episodeMap = await fetchEpisodes(allEpisodeUuids);

        for (const [edgeUuid, episodes] of edgeEpisodes.entries()) {
          const citations: string[] = [];
          for (const episodeId of episodes.slice(0, citationLimitPerEdge)) {
            const episode = episodeMap.get(episodeId);
            if (episode) {
              citations.push(formatCitation(episode, citationMaxChars));
            }
          }
          citationsLookup.set(edgeUuid, citations);
        }

        for (const [factUuid, episodes] of factEpisodes.entries()) {
          const citations: string[] = [];
          for (const episodeId of episodes.slice(0, citationLimitPerEdge)) {
            const episode = episodeMap.get(episodeId);
            if (episode) {
              citations.push(formatCitation(episode, citationMaxChars));
            }
          }
          factCitationsLookup.set(factUuid, citations);
        }
      }

      const factUuids = searchResults.facts.map((fact) => String(fact.uuid ?? "")).filter(Boolean);
      factRolesLookup = await fetchFactRoles(factUuids, groupId);

      const contextParts: string[] = [];
      if (searchResults.nodes.length > 0) {
        contextParts.push("# Relevant Entities");
        for (const node of searchResults.nodes) {
          const name = String(node.name ?? "");
          const summary = String(node.summary ?? "");
          if (!name) {
            continue;
          }
          contextParts.push(`- ${name}: ${summary}`.trim());
        }
      }

      if (searchResults.edges.length > 0) {
        contextParts.push("\n# Relevant Facts");
        for (const edge of searchResults.edges) {
          const fact = String(edge.fact ?? "");
          if (!fact) {
            continue;
          }
          let line = `- ${fact}`;
          if (includeCitations) {
            const citations = citationsLookup.get(String(edge.uuid ?? "")) ?? [];
            if (citations.length > 0) {
              line = `${line} (sources: ${citations.join("; ")})`;
            }
          }
          contextParts.push(line);
        }
      }

      if (searchResults.facts.length > 0) {
        contextParts.push("\n# Relevant Events");
        for (const fact of searchResults.facts) {
          const factText = String(fact.fact ?? "");
          if (!factText) {
            continue;
          }
          const suffixes: string[] = [];
          const roles = factRolesLookup.get(String(fact.uuid ?? ""));
          if (roles) {
            suffixes.push(`roles: ${roles}`);
          }
          if (includeCitations) {
            const citations = factCitationsLookup.get(String(fact.uuid ?? "")) ?? [];
            if (citations.length > 0) {
              suffixes.push(`sources: ${citations.join("; ")}`);
            }
          }
          const suffix = suffixes.length > 0 ? ` (${suffixes.join("; ")})` : "";
          contextParts.push(`- ${factText}${suffix}`);
        }
      }

      const contextText = contextParts.join("\n");
      const metadata = buildContextMetadata(searchResults.nodes, searchResults.edges);

      const db = await getDb();
      const existingCache = await db
        .selectFrom("context_cache")
        .select(["session_id", "context_metadata"])
        .where("session_id", "=", sessionId)
        .executeTakeFirst();

      if (existingCache) {
        const mergedMetadata = {
          ...(existingCache.context_metadata && typeof existingCache.context_metadata === "object"
            ? (existingCache.context_metadata as Record<string, unknown>)
            : {}),
          ...metadata,
        };
        await db
          .updateTable("context_cache")
          .set({
            context_text: contextText,
            context_metadata: mergedMetadata,
            updated_at: nowDate(),
          })
          .where("session_id", "=", sessionId)
          .execute();
      } else {
        await db
          .insertInto("context_cache")
          .values({
            session_id: sessionId,
            context_text: contextText,
            context_metadata: metadata,
            created_at: nowDate(),
            updated_at: nowDate(),
          })
          .execute();
      }

      return c.json({ status: "ready", context: contextText });
    } catch (error) {
      console.log(`[context] build failed: ${String(error)}`);
      return c.json({ status: "error", context: "", error: String(error) });
    }
  });

  app.post("/context/get", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    const maxAgeMinutes = toNumber(payload.max_age_minutes, 30);
    if (!sessionId) {
      return c.json({ error: "session_id is required" }, 400);
    }

    const maxAgeSeconds = maxAgeMinutes * 60;
    const minTimestamp = new Date(Date.now() - maxAgeSeconds * 1000);

    const db = await getDb();
    const row = await db
      .selectFrom("context_cache")
      .select(["context_text"])
      .where("session_id", "=", sessionId)
      .where("created_at", ">=", minTimestamp)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    const context = row?.context_text ?? "";
    return c.json({ found: Boolean(row), context });
  });

  app.post("/context/build_session_start", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    if (!sessionId) {
      return c.json({ error: "session_id is required" }, 400);
    }

    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    const workingDir = typeof payload.working_dir === "string" ? payload.working_dir : "";
    const medium = typeof payload.medium === "string" ? payload.medium : null;

    const session = await ensureSession(sessionId, workingDir, userId, medium);

    const db = await getDb();
    const existingCache = await db
      .selectFrom("context_cache")
      .select(["context_metadata"])
      .where("session_id", "=", sessionId)
      .executeTakeFirst();

    if (existingCache?.context_metadata && typeof existingCache.context_metadata === "object") {
      const meta = existingCache.context_metadata as Record<string, unknown>;
      if (meta.session_start_queried) {
        return c.json({
          status: "cached",
          context: typeof meta.session_start_results === "string" ? meta.session_start_results : "",
        });
      }
    }

    let sessionStartEnabled = true;
    let sessionStartLimit = 5;
    let sessionStartGitCommits = 5;
    let sessionStartConversationalDays = 30;
    let sessionStartCodeDays = 7;

    try {
      const config = await loadConfig();
      const contextConfig = (config.context ?? {}) as Record<string, unknown>;
      if (typeof contextConfig.session_start_enabled === "boolean") {
        sessionStartEnabled = contextConfig.session_start_enabled;
      }
      if (typeof contextConfig.session_start_limit === "number") {
        sessionStartLimit = contextConfig.session_start_limit;
      }
      if (typeof contextConfig.session_start_git_commits === "number") {
        sessionStartGitCommits = contextConfig.session_start_git_commits;
      }
      if (typeof contextConfig.session_start_conversational_days === "number") {
        sessionStartConversationalDays = contextConfig.session_start_conversational_days;
      }
      if (typeof contextConfig.session_start_code_days === "number") {
        sessionStartCodeDays = contextConfig.session_start_code_days;
      }
    } catch {
      // defaults already set
    }

    if (!sessionStartEnabled) {
      return c.json({ status: "disabled", context: "" });
    }

    const sessionType = await detectSessionType({
      medium: session.medium,
      working_dir: session.working_dir,
    });
    let contextText = "";
    let projectName: string | null = null;

    try {
      if (await graphAvailable()) {
        if (sessionType === "code") {
          projectName = extractProjectName(session.working_dir);
          const query = projectName ? `recent work in ${projectName}` : "recent code work";
          const cutoff = new Date(Date.now() - sessionStartCodeDays * 24 * 60 * 60 * 1000);
          const filters: SearchFilters = {
            created_at: { operator: "greater_than_equal", value: cutoff },
          };

          const results = await searchGraph({
            query,
            groupId: userId ?? session.user_id ?? "default",
            limit: sessionStartLimit,
            rerankMethod: "episode_mentions",
            filters,
          });

          const combined = [...results.nodes, ...results.facts];
          const commits = await getRecentGitCommits(session.working_dir, sessionStartGitCommits);
          contextText = buildCodeSessionContext(projectName, combined, commits, sessionStartLimit);
        } else {
          const query = "recent conversations and entities discussed";
          const cutoff = new Date(
            Date.now() - sessionStartConversationalDays * 24 * 60 * 60 * 1000,
          );
          const filters: SearchFilters = {
            created_at: { operator: "greater_than_equal", value: cutoff },
          };

          const results = await searchGraph({
            query,
            groupId: userId ?? session.user_id ?? "default",
            limit: sessionStartLimit,
            rerankMethod: "recency",
            filters,
          });

          const combined = [...results.nodes, ...results.facts];
          contextText = buildConversationalContext(combined, sessionStartLimit);
        }
      }
    } catch (error) {
      console.log(`[context] session-start build failed: ${String(error)}`);
      contextText = `<session_start_context type="${sessionType}"><error>Context unavailable</error></session_start_context>`;
    }

    const cacheMetadata = {
      session_start_queried: true,
      session_start_results: contextText,
      session_type: sessionType,
      query_timestamp: nowSeconds(),
    };

    if (existingCache) {
      const merged = {
        ...(existingCache.context_metadata && typeof existingCache.context_metadata === "object"
          ? (existingCache.context_metadata as Record<string, unknown>)
          : {}),
        ...cacheMetadata,
      };
      await db
        .updateTable("context_cache")
        .set({ context_metadata: merged, updated_at: nowDate() })
        .where("session_id", "=", sessionId)
        .execute();
    } else {
      await db
        .insertInto("context_cache")
        .values({
          session_id: sessionId,
          context_text: "",
          context_metadata: cacheMetadata,
          created_at: nowDate(),
          updated_at: nowDate(),
        })
        .execute();
    }

    return c.json({
      status: "ready",
      context: contextText,
      session_type: sessionType,
      project_name: projectName,
    });
  });

  app.get("/context", async (c) => {
    const sessionId = c.req.query("session_id");
    const parsedSessionId = sessionId ? Number(sessionId) : null;

    const context = await buildSessionContextXml({
      sessionId: Number.isFinite(parsedSessionId) ? parsedSessionId : null,
      includeContext: true,
    });
    return c.json({ context: context ?? "" });
  });
}
