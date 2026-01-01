import type { Hono } from "hono";
import { createHash } from "node:crypto";
import { hostname as getHostname } from "node:os";

import { loadConfig } from "@dere/shared-config";

const DEFAULT_ACTIVITYWATCH_URL = "http://localhost:5600";

type ActivityEvent = {
  timestamp?: string;
  duration?: number;
  data?: Record<string, unknown>;
};

function parseNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  return fallback;
}

function parseEventTime(event: ActivityEvent): Date | null {
  if (!event.timestamp) {
    return null;
  }
  const parsed = new Date(event.timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventEndTime(event: ActivityEvent): Date | null {
  const start = parseEventTime(event);
  if (!start) {
    return null;
  }
  const durationSeconds = Number(event.duration ?? 0);
  return new Date(start.getTime() + durationSeconds * 1000);
}

function windowKey(event: ActivityEvent): [string, string] {
  const data = event.data ?? {};
  const app = String(data.app ?? "unknown");
  const title = String(data.title ?? "");
  return [app, title];
}

function mediaKey(event: ActivityEvent): [string, string, string] {
  const data = event.data ?? {};
  const player = String(data.player ?? "media");
  const title = String(data.title ?? "");
  const artist = String(data.artist ?? "");
  return [player, title, artist];
}

export function classifyActivity(app: string | null, title: string | null): string {
  const appLower = (app ?? "").toLowerCase();
  const titleLower = (title ?? "").toLowerCase();

  const productiveApps = new Set([
    "code",
    "cursor",
    "neovim",
    "vim",
    "nvim",
    "emacs",
    "jetbrains",
    "pycharm",
    "webstorm",
    "intellij",
    "goland",
    "rider",
    "datagrip",
    "terminal",
    "konsole",
    "alacritty",
    "kitty",
    "wezterm",
    "zellij",
    "tmux",
    "obsidian",
    "notion",
    "logseq",
    "zotero",
    "postman",
    "insomnia",
    "dbeaver",
    "pgadmin",
  ]);

  const distractedApps = new Set([
    "discord",
    "slack",
    "telegram",
    "whatsapp",
    "signal",
    "twitter",
    "x",
    "reddit",
    "facebook",
    "instagram",
    "tiktok",
    "steam",
    "lutris",
    "heroic",
    "game",
    "gaming",
    "youtube",
    "twitch",
    "netflix",
    "plex",
  ]);

  for (const appName of productiveApps) {
    if (appLower.includes(appName)) {
      return "productive";
    }
  }

  for (const appName of distractedApps) {
    if (appLower.includes(appName)) {
      return "distracted";
    }
  }

  if (
    ["firefox", "chrome", "chromium", "brave", "zen", "vivaldi"].some((browser) =>
      appLower.includes(browser),
    )
  ) {
    if (
      ["github", "stackoverflow", "docs", "documentation", "api", "reference"].some((site) =>
        titleLower.includes(site),
      )
    ) {
      return "productive";
    }
    if (
      ["youtube", "reddit", "twitter", "facebook", "twitch"].some((site) =>
        titleLower.includes(site),
      )
    ) {
      return "distracted";
    }
    return "neutral";
  }

  return "neutral";
}

async function fetchEvents(
  baseUrl: string,
  bucket: string,
  start: Date,
  end: Date,
  limit = 200,
): Promise<ActivityEvent[]> {
  try {
    const url = new URL(`/api/0/buckets/${bucket}/events`, baseUrl);
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());
    url.searchParams.set("limit", String(limit));
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as ActivityEvent[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function summarizeWindowEvents(
  events: ActivityEvent[],
  topN: number,
): { topApps: Record<string, unknown>[]; topTitles: Record<string, unknown>[] } {
  const appTotals = new Map<string, number>();
  const titleTotals = new Map<string, number>();

  for (const event of events) {
    const [app, title] = windowKey(event);
    const duration = Number(event.duration ?? 0);
    if (duration <= 0) {
      continue;
    }
    appTotals.set(app, (appTotals.get(app) ?? 0) + duration);
    const key = `${app}::${title}`;
    titleTotals.set(key, (titleTotals.get(key) ?? 0) + duration);
  }

  const topApps = [...appTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([app, duration]) => ({ app, duration_seconds: duration }));

  const topTitles = [...titleTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, duration]) => {
      const [app, title] = key.split("::");
      return { app, title, duration_seconds: duration };
    });

  return { topApps, topTitles };
}

function summarizeCategories(events: ActivityEvent[]): {
  totals: Record<string, number>;
  top: Record<string, unknown>[];
} {
  const totals: Record<string, number> = {};
  for (const event of events) {
    const [app, title] = windowKey(event);
    const category = classifyActivity(app, title);
    const duration = Number(event.duration ?? 0);
    if (duration <= 0) {
      continue;
    }
    totals[category] = (totals[category] ?? 0) + duration;
  }

  const top = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, duration]) => ({ category, duration_seconds: duration }));

  return { totals, top };
}

function countWindowSwitches(events: ActivityEvent[]): number {
  const sorted = [...events]
    .filter((event) => parseEventTime(event))
    .sort((a, b) => {
      const aTime = parseEventTime(a)?.getTime() ?? 0;
      const bTime = parseEventTime(b)?.getTime() ?? 0;
      return aTime - bTime;
    });

  let switches = 0;
  let lastKey: string | null = null;
  for (const event of sorted) {
    const [app, title] = windowKey(event);
    const key = `${app}::${title}`;
    if (lastKey && key !== lastKey) {
      switches += 1;
    }
    lastKey = key;
  }
  return switches;
}

function summarizeRecentEvents(
  events: ActivityEvent[],
  limit: number,
  isMedia: boolean,
): Record<string, unknown>[] {
  const sorted = [...events]
    .filter((event) => parseEventTime(event))
    .sort((a, b) => {
      const aTime = parseEventTime(a)?.getTime() ?? 0;
      const bTime = parseEventTime(b)?.getTime() ?? 0;
      return aTime - bTime;
    });

  const slice = sorted.slice(-limit);
  const summaries: Record<string, unknown>[] = [];
  for (const event of slice.reverse()) {
    const start = parseEventTime(event);
    const end = eventEndTime(event);
    const duration = Number(event.duration ?? 0);
    const data = event.data ?? {};

    if (isMedia) {
      summaries.push({
        player: data.player,
        artist: data.artist,
        title: data.title,
        start: start ? start.toISOString() : null,
        end: end ? end.toISOString() : null,
        duration_seconds: duration,
      });
    } else {
      summaries.push({
        app: data.app,
        title: data.title,
        start: start ? start.toISOString() : null,
        end: end ? end.toISOString() : null,
        duration_seconds: duration,
      });
    }
  }
  return summaries;
}

function selectCurrentWindow(
  events: ActivityEvent[],
  now: Date,
  recencySeconds: number,
): Record<string, unknown> | null {
  let latest: ActivityEvent | null = null;
  let latestEnd: Date | null = null;

  for (const event of events) {
    const end = eventEndTime(event);
    if (!end) {
      continue;
    }
    if (!latestEnd || end > latestEnd) {
      latest = event;
      latestEnd = end;
    }
  }

  if (!latest || !latestEnd) {
    return null;
  }
  if (now.getTime() - latestEnd.getTime() > recencySeconds * 1000) {
    return null;
  }

  const [app, title] = windowKey(latest);
  const durationSeconds = events
    .filter((event) => {
      const [a, t] = windowKey(event);
      return a === app && t === title;
    })
    .reduce((acc, event) => acc + Number(event.duration ?? 0), 0);

  return {
    app,
    title,
    duration_seconds: durationSeconds,
    last_seen: latestEnd.toISOString(),
  };
}

function selectCurrentMedia(
  events: ActivityEvent[],
  now: Date,
  recencySeconds: number,
): Record<string, unknown> | null {
  let latest: ActivityEvent | null = null;
  let latestEnd: Date | null = null;

  for (const event of events) {
    const end = eventEndTime(event);
    if (!end) {
      continue;
    }
    if (!latestEnd || end > latestEnd) {
      latest = event;
      latestEnd = end;
    }
  }

  if (!latest || !latestEnd) {
    return null;
  }
  if (now.getTime() - latestEnd.getTime() > recencySeconds * 1000) {
    return null;
  }

  const [player, title, artist] = mediaKey(latest);
  const durationSeconds = events
    .filter((event) => {
      const [p, t, a] = mediaKey(event);
      return p === player && t === title && a === artist;
    })
    .reduce((acc, event) => acc + Number(event.duration ?? 0), 0);

  return {
    player,
    title,
    artist,
    duration_seconds: durationSeconds,
    last_seen: latestEnd.toISOString(),
  };
}

function computeAfkStatus(
  events: ActivityEvent[],
  now: Date,
): { is_afk: boolean; idle_seconds: number } {
  let latestTime: Date | null = null;
  let latestStatus: string | null = null;

  for (const event of events) {
    const eventTime = parseEventTime(event);
    if (!eventTime) {
      continue;
    }
    if (!latestTime || eventTime > latestTime) {
      latestTime = eventTime;
      latestStatus = String(event.data?.status ?? "");
    }
  }

  if (latestTime && latestStatus === "afk") {
    return {
      is_afk: true,
      idle_seconds: Math.floor((now.getTime() - latestTime.getTime()) / 1000),
    };
  }

  return { is_afk: false, idle_seconds: 0 };
}

export async function buildActivitySnapshot(options: {
  lookbackMinutes: number;
  top: number;
  recencySeconds: number;
  includeRecent: boolean;
  recentLimit: number;
}): Promise<Record<string, unknown>> {
  const config = await loadConfig();
  const awConfig = config.activitywatch ?? {};
  if (awConfig.enabled === false) {
    return { enabled: false, status: "disabled" };
  }

  const baseUrl =
    typeof awConfig.url === "string" && awConfig.url.length > 0
      ? awConfig.url
      : DEFAULT_ACTIVITYWATCH_URL;
  const hostname = getHostname();
  const now = new Date();
  const start = new Date(now.getTime() - options.lookbackMinutes * 60 * 1000);

  const windowEvents = await fetchEvents(baseUrl, `aw-watcher-window_${hostname}`, start, now);
  const mediaEvents = await fetchEvents(baseUrl, `aw-watcher-media-player_${hostname}`, start, now);
  const afkEvents = await fetchEvents(
    baseUrl,
    `aw-watcher-afk_${hostname}`,
    new Date(now.getTime() - Math.max(options.lookbackMinutes, 10) * 60 * 1000),
    now,
    10,
  );

  const { is_afk, idle_seconds } = computeAfkStatus(afkEvents, now);
  const currentWindow = selectCurrentWindow(windowEvents, now, options.recencySeconds);
  const currentMedia = selectCurrentMedia(mediaEvents, now, options.recencySeconds);
  const { topApps, topTitles } = summarizeWindowEvents(windowEvents, options.top);
  const { totals, top: topCategories } = summarizeCategories(windowEvents);
  const windowSwitches = countWindowSwitches(windowEvents);
  const uniqueApps = new Set(windowEvents.map((event) => windowKey(event)[0])).size;
  const uniqueTitles = new Set(windowEvents.map((event) => windowKey(event)[1])).size;

  const focusStreakSeconds = currentWindow ? currentWindow.duration_seconds : 0;
  const mediaStreakSeconds = currentMedia ? currentMedia.duration_seconds : 0;

  let currentCategory: string | null = null;
  if (currentWindow) {
    currentCategory = classifyActivity(currentWindow.app as string, currentWindow.title as string);
  } else if (currentMedia) {
    currentCategory = "neutral";
  }

  let presence = "unknown";
  let status = "empty";
  if (windowEvents.length || mediaEvents.length || afkEvents.length) {
    status = "ok";
    if (is_afk) {
      presence = currentWindow || currentMedia ? "passive" : "away";
    } else {
      presence = "active";
    }
  }

  const tokens: string[] = [];
  tokens.push(`presence:${presence}`);
  if (currentWindow) {
    tokens.push(`app:${currentWindow.app ?? ""}`);
    tokens.push(`title:${String(currentWindow.title ?? "").slice(0, 120)}`);
  }
  if (currentMedia) {
    tokens.push(`media:${currentMedia.player ?? ""}`);
    tokens.push(`media_title:${String(currentMedia.title ?? "").slice(0, 120)}`);
  }
  for (const appItem of topApps) {
    if (typeof appItem.app === "string") {
      tokens.push(`app:${appItem.app}`);
    }
  }
  for (const titleItem of topTitles) {
    const title = String(titleItem.title ?? "").slice(0, 120);
    if (title) {
      tokens.push(`title:${title}`);
    }
  }

  const normalized = Array.from(new Set(tokens.map((token) => token.toLowerCase())));
  const fingerprint = createHash("sha256").update(normalized.sort().join("|")).digest("hex");

  const snapshot: Record<string, unknown> = {
    enabled: true,
    timestamp: now.toISOString(),
    hostname,
    lookback_minutes: options.lookbackMinutes,
    recency_seconds: options.recencySeconds,
    presence,
    is_afk,
    idle_seconds,
    current_window: currentWindow,
    current_media: currentMedia,
    top_apps: topApps,
    top_titles: topTitles,
    window_events_count: windowEvents.length,
    media_events_count: mediaEvents.length,
    afk_events_count: afkEvents.length,
    window_switches: windowSwitches,
    unique_apps: uniqueApps,
    unique_titles: uniqueTitles,
    focus_streak_seconds: focusStreakSeconds,
    media_streak_seconds: mediaStreakSeconds,
    current_category: currentCategory,
    category_totals: totals,
    top_categories: topCategories,
    status,
    context_fingerprint: fingerprint,
  };

  if (options.includeRecent) {
    snapshot.recent_windows = summarizeRecentEvents(windowEvents, options.recentLimit, false);
    snapshot.recent_media = summarizeRecentEvents(mediaEvents, options.recentLimit, true);
  }

  return snapshot;
}

export function registerActivityRoutes(app: Hono): void {
  app.get("/activity/state", async (c) => {
    const lookbackMinutes = parseNumber(c.req.query("t") ?? c.req.query("minutes"), 10);
    const top = parseNumber(c.req.query("top"), 5);
    const recencySeconds = parseNumber(c.req.query("recency_seconds"), 120);
    const includeRecent = parseBoolean(c.req.query("include_recent"), false);
    const recentLimit = parseNumber(c.req.query("recent_limit"), 5);

    const snapshot = await buildActivitySnapshot({
      lookbackMinutes,
      top,
      recencySeconds,
      includeRecent,
      recentLimit,
    });

    return c.json(snapshot);
  });
}
