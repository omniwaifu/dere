import type { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";

import { loadConfig, type DereConfig } from "@dere/shared-config";
import { addLineNumbers, renderTag, renderTextTag } from "@dere/shared-llm";
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
import {
  ensureSession,
  upsertContextCache,
  mergeContextCacheMetadata,
} from "./db-utils.js";
import { buildContextMetadata } from "./context-tracking.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;
type WeatherContext = {
  temperature?: string;
  feels_like?: string;
  conditions?: string;
  humidity?: string;
  location?: string;
  pressure?: string;
  wind_speed?: string;
};

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

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getTimeContext(): { time: string; date: string; timezone: string } {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour12: false });
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
  const tzPart = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName");
  const timezone = tzPart?.value ?? "UTC";
  return { time: `${time} ${timezone}`, date, timezone };
}

async function getWeatherContext(config: DereConfig): Promise<WeatherContext | null> {
  const context = config.context as Record<string, unknown> | undefined;
  if (!context || readBoolean(context.weather) !== true) {
    return null;
  }

  const weatherConfig = (config.weather ?? {}) as Record<string, unknown>;
  const city = readString(weatherConfig.city);
  if (!city) {
    return null;
  }
  const units = readString(weatherConfig.units) ?? "metric";

  try {
    const { stdout } = await execFileAsync(
      "rustormy",
      ["--format", "json", "--city", city, "--units", units],
      { timeout: 5000, encoding: "utf-8" },
    );

    const payload = JSON.parse(String(stdout)) as Record<string, unknown>;
    const tempUnit = units === "imperial" ? "°F" : "°C";
    return {
      temperature: `${payload.temperature ?? "N/A"}${tempUnit}`,
      feels_like: `${payload.feels_like ?? "N/A"}${tempUnit}`,
      conditions: String(payload.description ?? "N/A"),
      humidity: `${payload.humidity ?? "N/A"}%`,
      location: String(payload.location_name ?? city),
      pressure: `${payload.pressure ?? "N/A"} hPa`,
      wind_speed:
        units === "imperial"
          ? `${payload.wind_speed ?? "N/A"} mph`
          : `${payload.wind_speed ?? "N/A"} m/s`,
    };
  } catch {
    return null;
  }
}

async function getRecentFilesContext(config: DereConfig): Promise<string[] | null> {
  const context = config.context as Record<string, unknown> | undefined;
  if (!context || readBoolean(context.recent_files) !== true) {
    return null;
  }

  const timeframe = readString(context.recent_files_timeframe);
  const basePath = readString(context.recent_files_base_path);
  const maxDepth = readNumber(context.recent_files_max_depth);
  if (!timeframe || !basePath || maxDepth === null) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      "fd",
      [
        "--changed-within",
        timeframe,
        "--type",
        "f",
        "--max-depth",
        String(maxDepth),
        ".",
        basePath,
      ],
      { timeout: 1000, encoding: "utf-8" },
    );
    const files = String(stdout)
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

async function getEmotionSummary(sessionId: number | null): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .selectFrom("emotion_states")
    .select(["primary_emotion", "primary_intensity"])
    .where("session_id", "=", sessionId ?? null)
    .orderBy("last_update", "desc")
    .limit(1)
    .executeTakeFirst();

  const emotion = row?.primary_emotion ?? null;
  if (!emotion || emotion === "neutral") {
    return null;
  }

  const name = emotion.replace(/_/g, " ").toLowerCase();
  const intensityValue = row?.primary_intensity ?? 0;
  let guidance = "Minor signal, don't overreact.";
  if (intensityValue > 70) {
    guidance = "Respond with care and attention to this.";
  } else if (intensityValue > 40) {
    guidance = "Keep this in mind when responding.";
  }

  return `Context: User showing signs of ${name}. ${guidance}`;
}

async function getConversationContext(sessionId: number): Promise<string | null> {
  const maxAgeMinutes = 30;
  const minTimestamp = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

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
  return context.trim() ? context : null;
}

async function buildFullContextXml(args: { sessionId: number | null }): Promise<string> {
  const config = await loadConfig();
  const context = config.context as Record<string, unknown> | undefined;

  const sections: string[] = [];
  const environmentalParts: string[] = [];

  try {
    if (context && readBoolean(context.time) === true) {
      const timeCtx = getTimeContext();
      const timeParts: string[] = [];
      if (timeCtx.time) {
        timeParts.push(renderTextTag("time_of_day", timeCtx.time, { indent: 6 }));
      }
      if (timeCtx.date) {
        timeParts.push(renderTextTag("date", timeCtx.date, { indent: 6 }));
      }
      if (timeCtx.timezone) {
        timeParts.push(renderTextTag("timezone", timeCtx.timezone, { indent: 6 }));
      }
      if (timeParts.length > 0) {
        environmentalParts.push(renderTag("time", timeParts.join("\n"), { indent: 4 }));
      }
    }
  } catch {
    // ignore time context errors
  }

  try {
    const weather = await getWeatherContext(config);
    if (weather) {
      const weatherParts: string[] = [];
      for (const key of [
        "location",
        "conditions",
        "temperature",
        "feels_like",
        "humidity",
        "pressure",
        "wind_speed",
      ]) {
        const value = weather[key as keyof WeatherContext];
        if (value) {
          weatherParts.push(renderTextTag(key, value, { indent: 6 }));
        }
      }
      if (weatherParts.length > 0) {
        environmentalParts.push(renderTag("weather", weatherParts.join("\n"), { indent: 4 }));
      }
    }
  } catch {
    // ignore weather context errors
  }

  try {
    const files = await getRecentFilesContext(config);
    if (files && files.length > 0) {
      const fileParts = files.map((path) => renderTextTag("file", path, { indent: 6 }));
      environmentalParts.push(renderTag("recent_files", fileParts.join("\n"), { indent: 4 }));
    }
  } catch {
    // ignore recent files errors
  }

  if (environmentalParts.length > 0) {
    sections.push(renderTag("environment", environmentalParts.join("\n"), { indent: 2 }));
  }

  if (args.sessionId) {
    const emotionSummary = await getEmotionSummary(args.sessionId);
    if (emotionSummary) {
      sections.push(renderTextTag("emotion", emotionSummary, { indent: 2 }));
    }
  }

  if (args.sessionId) {
    const conversation = await getConversationContext(args.sessionId);
    if (conversation) {
      sections.push(renderTextTag("conversation", conversation, { indent: 2 }));
    }
  }

  if (sections.length === 0) {
    return "";
  }

  let contextXml = renderTag("context", sections.join("\n"), { indent: 0 });
  if (context && readBoolean(context.line_numbered_xml) === true) {
    contextXml = addLineNumbers(contextXml);
  }
  return contextXml;
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

    const db = await getDb();
    await ensureSession(db, { id: sessionId, workingDir: projectPath, userId, medium: null });
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

      await upsertContextCache(db, sessionId, {
        contextText,
        contextMetadata: metadata,
      });

      return c.json({ status: "ready", context: contextText });
    } catch (error) {
      log.daemon.warn("Context build failed", { error: String(error) });
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

    const db = await getDb();
    const session = await ensureSession(db, { id: sessionId, workingDir, userId, medium });
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
      log.daemon.warn("Session-start context build failed", { error: String(error) });
      contextText = `<session_start_context type="${sessionType}"><error>Context unavailable</error></session_start_context>`;
    }

    const cacheMetadata = {
      session_start_queried: true,
      session_start_results: contextText,
      session_type: sessionType,
      query_timestamp: nowSeconds(),
    };

    await mergeContextCacheMetadata(db, sessionId, cacheMetadata);

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

    const context = await buildFullContextXml({
      sessionId: Number.isFinite(parsedSessionId) ? parsedSessionId : null,
    });
    return c.json({ context });
  });
}
