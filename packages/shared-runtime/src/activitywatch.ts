import { createHash } from "node:crypto";
import { hostname as getHostname } from "node:os";

import { loadConfig, type DereConfig } from "@dere/shared-config";

import { DEFAULT_ACTIVITYWATCH_URL } from "./constants.js";

type ActivityEvent = {
  timestamp?: string;
  duration?: number;
  data?: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;

export class ActivityWatchClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = DEFAULT_ACTIVITYWATCH_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getEvents(
    bucketName: string,
    startTime: Date,
    endTime: Date,
    limit = 200,
  ): Promise<ActivityEvent[]> {
    const url = new URL(`${this.baseUrl}/api/0/buckets/${bucketName}/events`);
    url.searchParams.set("start", startTime.toISOString());
    url.searchParams.set("end", endTime.toISOString());
    url.searchParams.set("limit", String(limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as ActivityEvent[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async getWindowEvents(host: string, lookbackMinutes: number): Promise<ActivityEvent[]> {
    const now = new Date();
    const start = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    return this.getEvents(`aw-watcher-window_${host}`, start, now);
  }

  async getMediaEvents(host: string, lookbackMinutes: number): Promise<ActivityEvent[]> {
    const now = new Date();
    const start = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    return this.getEvents(`aw-watcher-media-player_${host}`, start, now);
  }

  async getAfkEvents(host: string, lookbackMinutes: number): Promise<ActivityEvent[]> {
    const now = new Date();
    const start = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    return this.getEvents(`aw-watcher-afk_${host}`, start, now, 10);
  }
}

function getActivitywatchSettings(config: DereConfig): { enabled: boolean; baseUrl: string } {
  const awConfig = (config.activitywatch ?? {}) as Record<string, unknown>;
  const enabled = awConfig.enabled !== false;
  const baseUrl =
    typeof awConfig.url === "string" && awConfig.url.length > 0
      ? awConfig.url
      : DEFAULT_ACTIVITYWATCH_URL;
  return { enabled, baseUrl };
}

export function classifyActivity(app?: string | null, title?: string | null): string {
  const appLower = app?.toLowerCase() ?? "";
  const titleLower = title?.toLowerCase() ?? "";

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
    ["firefox", "chrome", "chromium", "brave", "zen", "vivaldi"].some((b) => appLower.includes(b))
  ) {
    if (
      ["github", "stackoverflow", "docs", "documentation", "api", "reference"].some((s) =>
        titleLower.includes(s),
      )
    ) {
      return "productive";
    }
    if (
      ["youtube", "reddit", "twitter", "facebook", "twitch"].some((s) => titleLower.includes(s))
    ) {
      return "distracted";
    }
    return "neutral";
  }

  return "neutral";
}

function parseEventTime(event: ActivityEvent): Date | null {
  if (!event.timestamp) {
    return null;
  }
  const parsed = new Date(event.timestamp.replace("Z", "+00:00"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventEndTime(event: ActivityEvent): Date | null {
  const start = parseEventTime(event);
  if (!start) {
    return null;
  }
  const duration = Number(event.duration ?? 0);
  return new Date(start.getTime() + duration * 1000);
}

function windowKey(event: ActivityEvent): [string, string] {
  const data = event.data ?? {};
  return [String(data.app ?? "unknown"), String(data.title ?? "")];
}

function mediaKey(event: ActivityEvent): [string, string, string] {
  const data = event.data ?? {};
  return [String(data.player ?? "media"), String(data.title ?? ""), String(data.artist ?? "")];
}

function summarizeWindowEvents(
  events: ActivityEvent[],
  topN: number,
): {
  topApps: JsonRecord[];
  topTitles: JsonRecord[];
} {
  const appTotals = new Map<string, number>();
  const titleTotals = new Map<string, number>();

  for (const event of events) {
    const [app, title] = windowKey(event);
    const duration = Number(event.duration ?? 0);
    if (duration <= 0) {
      continue;
    }
    appTotals.set(app, (appTotals.get(app) ?? 0) + duration);
    titleTotals.set(`${app}::${title}`, (titleTotals.get(`${app}::${title}`) ?? 0) + duration);
  }

  const topApps = Array.from(appTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([app, duration]) => ({ app, duration_seconds: duration }));

  const topTitles = Array.from(titleTotals.entries())
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
  top: JsonRecord[];
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
  const sorted = events
    .map((event) => ({ event, time: parseEventTime(event) }))
    .filter((entry) => entry.time)
    .sort((a, b) => a.time!.getTime() - b.time!.getTime());

  let switches = 0;
  let lastKey: string | null = null;
  for (const { event } of sorted) {
    const key = windowKey(event).join("::");
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
): JsonRecord[] {
  const sorted = events
    .map((event) => ({ event, time: parseEventTime(event) }))
    .filter((entry) => entry.time)
    .sort((a, b) => a.time!.getTime() - b.time!.getTime());

  const recent = sorted.slice(-limit);
  return recent.reverse().map(({ event }) => {
    const start = parseEventTime(event);
    const end = eventEndTime(event);
    const duration = Number(event.duration ?? 0);
    const data = event.data ?? {};
    if (isMedia) {
      return {
        player: data.player,
        artist: data.artist,
        title: data.title,
        start: start?.toISOString() ?? null,
        end: end?.toISOString() ?? null,
        duration_seconds: duration,
      };
    }
    return {
      app: data.app,
      title: data.title,
      start: start?.toISOString() ?? null,
      end: end?.toISOString() ?? null,
      duration_seconds: duration,
    };
  });
}

function selectCurrentWindow(
  events: ActivityEvent[],
  now: Date,
  recencySeconds: number,
): JsonRecord | null {
  let latestEvent: ActivityEvent | null = null;
  let latestEnd: Date | null = null;

  for (const event of events) {
    const end = eventEndTime(event);
    if (!end) {
      continue;
    }
    if (!latestEnd || end > latestEnd) {
      latestEnd = end;
      latestEvent = event;
    }
  }

  if (!latestEvent || !latestEnd) {
    return null;
  }
  if ((now.getTime() - latestEnd.getTime()) / 1000 > recencySeconds) {
    return null;
  }

  const [app, title] = windowKey(latestEvent);
  const durationSeconds = events
    .filter((event) => windowKey(event)[0] === app && windowKey(event)[1] === title)
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
): JsonRecord | null {
  let latestEvent: ActivityEvent | null = null;
  let latestEnd: Date | null = null;

  for (const event of events) {
    const end = eventEndTime(event);
    if (!end) {
      continue;
    }
    if (!latestEnd || end > latestEnd) {
      latestEnd = end;
      latestEvent = event;
    }
  }

  if (!latestEvent || !latestEnd) {
    return null;
  }
  if ((now.getTime() - latestEnd.getTime()) / 1000 > recencySeconds) {
    return null;
  }

  const [player, title, artist] = mediaKey(latestEvent);
  const durationSeconds = events
    .filter(
      (event) =>
        mediaKey(event)[0] === player &&
        mediaKey(event)[1] === title &&
        mediaKey(event)[2] === artist,
    )
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
): { isAfk: boolean; idleSeconds: number } {
  let latestTime: Date | null = null;
  let latestStatus: string | null = null;
  for (const event of events) {
    const time = parseEventTime(event);
    if (!time) {
      continue;
    }
    if (!latestTime || time > latestTime) {
      latestTime = time;
      latestStatus = String(event.data?.status ?? "");
    }
  }
  if (latestTime && latestStatus === "afk") {
    return {
      isAfk: true,
      idleSeconds: Math.floor((now.getTime() - latestTime.getTime()) / 1000),
    };
  }
  return { isAfk: false, idleSeconds: 0 };
}

function detectContinuousActivities(
  client: ActivityWatchClient,
  host: string,
  now: Date,
  initialEvents: ActivityEvent[],
  maxDurationHours: number,
): Promise<Record<string, JsonRecord>> {
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
  const recentActivities: Record<string, JsonRecord> = {};

  for (const event of initialEvents) {
    if (!event.data) {
      continue;
    }
    const eventTime = parseEventTime(event);
    if (!eventTime) {
      continue;
    }
    const durationSeconds = Number(event.duration ?? 0);
    const eventEnd = new Date(eventTime.getTime() + durationSeconds * 1000);
    if (eventEnd >= twoMinutesAgo) {
      const app = String(event.data.app ?? "unknown");
      const title = String(event.data.title ?? "");
      const key = `${app}::${title}`;
      if (!recentActivities[key]) {
        recentActivities[key] = { app, title, last_seen: eventEnd };
      }
    }
  }

  const lookbacks = [30, 60, 120, 240, 360, 480, 720].filter(
    (minutes) => minutes <= maxDurationHours * 60,
  );

  const results: Record<string, JsonRecord> = {};

  return (async () => {
    for (const [key, info] of Object.entries(recentActivities)) {
      const app = String(info.app);
      const title = String(info.title);
      let totalDuration = 0;

      for (const minutesBack of lookbacks) {
        const start = new Date(now.getTime() - minutesBack * 60 * 1000);
        const windowEvents = await client.getEvents(`aw-watcher-window_${host}`, start, now);
        const mediaEvents = await client.getEvents(`aw-watcher-media-player_${host}`, start, now);

        for (const event of mediaEvents) {
          if (event.data) {
            const artist = String(event.data.artist ?? "Unknown Artist");
            const titleText = String(event.data.title ?? "Unknown Track");
            const player = String(event.data.player ?? "Media Player");
            event.data.app = `${player} (Playing)`;
            event.data.title = `${artist} - ${titleText}`;
          }
        }

        const allEvents = [...windowEvents, ...mediaEvents];
        let periodDuration = 0;
        for (const event of allEvents) {
          if (!event.data) {
            continue;
          }
          const eventApp = String(event.data.app ?? "unknown");
          const eventTitle = String(event.data.title ?? "");
          if (eventApp === app && eventTitle === title) {
            periodDuration += Number(event.duration ?? 0);
          }
        }

        if (periodDuration > 60) {
          totalDuration = periodDuration;
        } else {
          break;
        }
      }

      results[key] = {
        app,
        title,
        duration: totalDuration,
        last_seen: info.last_seen,
      };
    }

    return results;
  })();
}

export async function getActivityContext(
  config: DereConfig,
  lastMessageTime?: number | null,
): Promise<JsonRecord | null> {
  try {
    const contextConfig = (config.context ?? {}) as Record<string, unknown>;
    const activityEnabled = Boolean(contextConfig.activity);
    const mediaEnabled = Boolean(contextConfig.media_player);
    const { enabled: awEnabled, baseUrl } = getActivitywatchSettings(config);

    if (!awEnabled || (!activityEnabled && !mediaEnabled)) {
      return null;
    }

    const differentialEnabled =
      typeof contextConfig.activity_differential_enabled === "boolean"
        ? contextConfig.activity_differential_enabled
        : true;
    const fullLookback = Number(contextConfig.activity_lookback_minutes ?? 10);
    const threshold = Number(contextConfig.activity_full_lookback_threshold_minutes ?? 15);
    const minLookback = Number(contextConfig.activity_min_lookback_minutes ?? 2);
    const maxDurationHours = Number(contextConfig.activity_max_duration_hours ?? 6);

    const now = new Date();
    let lookbackMinutes = fullLookback;
    if (differentialEnabled && lastMessageTime) {
      const elapsedMinutes = (now.getTime() / 1000 - lastMessageTime) / 60;
      if (elapsedMinutes < threshold) {
        lookbackMinutes = Math.max(minLookback, elapsedMinutes + 0.5);
      }
    }

    const client = new ActivityWatchClient(baseUrl);
    const host = getHostname();

    const startRecent = new Date(now.getTime() - lookbackMinutes * 60 * 1000);

    const windowEvents = activityEnabled
      ? await client.getEvents(`aw-watcher-window_${host}`, startRecent, now)
      : [];
    const mediaEvents = mediaEnabled
      ? await client.getEvents(`aw-watcher-media-player_${host}`, startRecent, now)
      : [];

    for (const event of mediaEvents) {
      if (event.data) {
        const artist = String(event.data.artist ?? "Unknown Artist");
        const title = String(event.data.title ?? "Unknown Track");
        const player = String(event.data.player ?? "Media Player");
        event.data.app = `${player} (Playing)`;
        event.data.title = `${artist} - ${title}`;
      }
    }

    const allEvents = [...windowEvents, ...mediaEvents];

    if (allEvents.length > 0) {
      const continuous = await detectContinuousActivities(
        client,
        host,
        now,
        allEvents,
        maxDurationHours,
      );
      const sorted = Object.entries(continuous)
        .sort((a, b) => Number(b[1].duration ?? 0) - Number(a[1].duration ?? 0))
        .slice(0, 2);

      if (sorted.length > 0) {
        const activities: string[] = [];
        for (const [, data] of sorted) {
          const app = String(data.app ?? "");
          let title = String(data.title ?? "");
          const totalSeconds = Number(data.duration ?? 0);
          const lastSeen =
            data.last_seen instanceof Date ? data.last_seen : new Date(String(data.last_seen));
          const isRecent = now.getTime() - lastSeen.getTime() < 120_000;

          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;
          let durationStr = `${seconds}s`;
          if (hours > 0) {
            durationStr = `${hours}h ${minutes}m`;
          } else if (minutes > 0) {
            durationStr = `${minutes}m ${seconds}s`;
          }

          let statusSuffix = "";
          if (!isRecent) {
            statusSuffix = app.includes("(Playing)") ? " (ended)" : " (inactive)";
          }

          if (title.length > 50) {
            title = `${title.slice(0, 47)}...`;
          }
          if (title) {
            activities.push(`${app}: ${title} (${durationStr})${statusSuffix}`);
          } else {
            activities.push(`${app} (${durationStr})${statusSuffix}`);
          }
        }
        return { recent_apps: activities };
      }
    }

    const afkEvents = await client.getEvents(`aw-watcher-afk_${host}`, startRecent, now, 10);
    if (afkEvents.length > 0) {
      const status = String(afkEvents[0]?.data?.status ?? "unknown");
      return { status: status === "not-afk" ? "Active" : "Away" };
    }
  } catch {
    return null;
  }

  return null;
}

export async function buildActivitySnapshot(options: {
  lookbackMinutes: number;
  top: number;
  recencySeconds: number;
  includeRecent: boolean;
  recentLimit: number;
}): Promise<JsonRecord> {
  const config = await loadConfig();
  const { enabled: awEnabled, baseUrl } = getActivitywatchSettings(config);
  if (!awEnabled) {
    return { enabled: false, status: "disabled" };
  }

  const host = getHostname();
  const now = new Date();
  const start = new Date(now.getTime() - options.lookbackMinutes * 60 * 1000);

  const client = new ActivityWatchClient(baseUrl);
  const windowEvents = await client.getEvents(`aw-watcher-window_${host}`, start, now);
  const mediaEvents = await client.getEvents(`aw-watcher-media-player_${host}`, start, now);
  const afkEvents = await client.getEvents(
    `aw-watcher-afk_${host}`,
    new Date(now.getTime() - Math.max(options.lookbackMinutes, 10) * 60 * 1000),
    now,
    10,
  );

  const { isAfk, idleSeconds } = computeAfkStatus(afkEvents, now);
  const currentWindow = selectCurrentWindow(windowEvents, now, options.recencySeconds);
  const currentMedia = selectCurrentMedia(mediaEvents, now, options.recencySeconds);
  const { topApps, topTitles } = summarizeWindowEvents(windowEvents, options.top);
  const { totals, top: topCategories } = summarizeCategories(windowEvents);
  const windowSwitches = countWindowSwitches(windowEvents);
  const uniqueApps = new Set(windowEvents.map((event) => windowKey(event)[0])).size;
  const uniqueTitles = new Set(windowEvents.map((event) => windowKey(event)[1])).size;

  const focusStreakSeconds = currentWindow ? Number(currentWindow.duration_seconds ?? 0) : 0;
  const mediaStreakSeconds = currentMedia ? Number(currentMedia.duration_seconds ?? 0) : 0;

  let currentCategory: string | null = null;
  if (currentWindow) {
    currentCategory = classifyActivity(
      String(currentWindow.app ?? ""),
      String(currentWindow.title ?? ""),
    );
  } else if (currentMedia) {
    currentCategory = "neutral";
  }

  let presence = "unknown";
  let status = "empty";
  if (windowEvents.length || mediaEvents.length || afkEvents.length) {
    status = "ok";
    presence = isAfk ? (currentWindow || currentMedia ? "passive" : "away") : "active";
  }

  const tokens: string[] = [];
  tokens.push(`presence:${presence}`);
  if (currentWindow) {
    tokens.push(`app:${String(currentWindow.app ?? "")}`);
    tokens.push(`title:${String(currentWindow.title ?? "").slice(0, 120)}`);
  }
  if (currentMedia) {
    tokens.push(`media:${String(currentMedia.player ?? "")}`);
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

  const normalized = Array.from(new Set(tokens.map((token) => token.toLowerCase()))).sort();
  const fingerprint = createHash("sha256").update(normalized.join("|")).digest("hex");

  const snapshot: JsonRecord = {
    enabled: true,
    timestamp: now.toISOString(),
    hostname: host,
    lookback_minutes: options.lookbackMinutes,
    recency_seconds: options.recencySeconds,
    presence,
    is_afk: isAfk,
    idle_seconds: idleSeconds,
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
