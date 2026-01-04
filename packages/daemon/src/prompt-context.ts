import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadConfig } from "@dere/shared-config";
import { addLineNumbers, renderTag, renderTextTag } from "@dere/shared-llm";

import { getDb } from "./db.js";
import { loadPersonality } from "./personalities.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

type WeatherContext = {
  temperature?: string;
  feels_like?: string;
  conditions?: string;
  humidity?: string;
  location?: string;
  pressure?: string;
  wind_speed?: string;
};

type SessionContextOptions = {
  sessionId: number | null;
  personalityOverride?: string | null;
  includeContext?: boolean;
  lineNumberedXml?: boolean;
};

export async function buildMissionPrompt(args: {
  sessionId: number | null;
  missionPrompt: string;
  personality: string | null;
}): Promise<string> {
  const contextXml = await buildSessionContextXml({
    sessionId: args.sessionId,
    personalityOverride: args.personality,
    includeContext: false,
  });
  if (!contextXml) {
    return args.missionPrompt;
  }
  return `${contextXml}\n\n${args.missionPrompt}`;
}

export async function buildSessionContextXml(options: SessionContextOptions): Promise<string> {
  const config = await loadConfig();
  const includeContext = options.includeContext ?? true;
  let lineNumberedXml = options.lineNumberedXml;
  if (lineNumberedXml === undefined) {
    lineNumberedXml = Boolean(config.context?.line_numbered_xml);
  }

  let personalityValue = options.personalityOverride ?? null;
  let sessionUserId: string | null = null;

  if (options.sessionId) {
    const db = await getDb();
    const sessionRow = await db
      .selectFrom("sessions")
      .select(["personality", "user_id"])
      .where("id", "=", options.sessionId)
      .executeTakeFirst();
    if (sessionRow) {
      personalityValue = sessionRow.personality ?? personalityValue;
      sessionUserId = sessionRow.user_id ?? null;
    }
  }

  const sections: string[] = [];

  const personalitySections = await buildPersonalitySections(personalityValue);
  if (personalitySections.length > 0) {
    sections.push(...personalitySections);
  }

  if (options.sessionId) {
    const coreMemory = await buildCoreMemorySection(options.sessionId, sessionUserId);
    if (coreMemory) {
      sections.push(coreMemory);
    }
  }

  if (includeContext) {
    const environment = await buildEnvironmentContext(config);
    if (environment) {
      sections.push(environment);
    }
    const emotionSummary = await buildEmotionSummary();
    if (emotionSummary) {
      sections.push(renderTextTag("emotion", emotionSummary, { indent: 2 }));
    }
  }

  if (sections.length === 0) {
    return "";
  }

  let contextXml = renderTag("context", sections.join("\n"), { indent: 0 });
  if (lineNumberedXml) {
    contextXml = addLineNumbers(contextXml);
  }
  return contextXml;
}

async function buildPersonalitySections(personalityValue: string | null): Promise<string[]> {
  if (!personalityValue) {
    return [];
  }

  const names = personalityValue
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  const sections: string[] = [];
  for (const name of names) {
    try {
      const personality = await loadPersonality(name);
      const content = personality.prompt_content?.trim();
      if (content) {
        sections.push(renderTextTag("personality", content, { indent: 2, attrs: { name } }));
      }
    } catch (error) {
      log.daemon.warn("Failed to load personality", { name, error: String(error) });
    }
  }

  return sections;
}

async function buildCoreMemorySection(sessionId: number, userId: string | null): Promise<string> {
  const db = await getDb();
  const blocks = new Map<string, { content: string }>();

  const sessionBlocks = await db
    .selectFrom("core_memory_blocks")
    .select(["block_type", "content"])
    .where("session_id", "=", sessionId)
    .where("block_type", "in", ["persona", "human", "task"])
    .execute();

  for (const block of sessionBlocks) {
    if (block.content) {
      blocks.set(block.block_type, { content: block.content });
    }
  }

  if (userId) {
    const userBlocks = await db
      .selectFrom("core_memory_blocks")
      .select(["block_type", "content"])
      .where("user_id", "=", userId)
      .where("session_id", "is", null)
      .where("block_type", "in", ["persona", "human", "task"])
      .execute();

    for (const block of userBlocks) {
      if (!blocks.has(block.block_type) && block.content) {
        blocks.set(block.block_type, { content: block.content });
      }
    }
  }

  const sections: string[] = [];
  for (const blockType of ["persona", "human", "task"]) {
    const block = blocks.get(blockType);
    if (!block) {
      continue;
    }
    const content = block.content.trim();
    if (!content) {
      continue;
    }
    sections.push(renderTextTag(blockType, content, { indent: 4 }));
  }

  if (sections.length === 0) {
    return "";
  }

  return renderTag("core_memory", sections.join("\n"), { indent: 2 });
}

async function buildEnvironmentContext(
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<string> {
  const sections: string[] = [];

  try {
    if (config.context?.time ?? true) {
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
        sections.push(renderTag("time", timeParts.join("\n"), { indent: 4 }));
      }
    }
  } catch {
    // Ignore time context errors
  }

  try {
    if (config.context?.weather) {
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
          sections.push(renderTag("weather", weatherParts.join("\n"), { indent: 4 }));
        }
      }
    }
  } catch {
    // Ignore weather context errors
  }

  if (sections.length === 0) {
    return "";
  }

  return renderTag("environment", sections.join("\n"), { indent: 2 });
}

async function buildEmotionSummary(): Promise<string> {
  const db = await getDb();
  const row = await db
    .selectFrom("emotion_states")
    .select(["primary_emotion", "primary_intensity"])
    .where("session_id", "is", null)
    .orderBy("last_update", "desc")
    .limit(1)
    .executeTakeFirst();

  const emotion = row?.primary_emotion ?? null;
  const intensity = row?.primary_intensity ?? null;
  if (!emotion || emotion === "neutral") {
    return "";
  }

  const name = emotion.replace(/_/g, " ").toLowerCase();
  const intensityValue = intensity ?? 0;
  let guidance = "Minor signal, don't overreact.";
  if (intensityValue > 70) {
    guidance = "Respond with care and attention to this.";
  } else if (intensityValue > 40) {
    guidance = "Keep this in mind when responding.";
  }

  return `Context: User showing signs of ${name}. ${guidance}`;
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

async function getWeatherContext(
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<WeatherContext | null> {
  if (!config.context?.weather || !config.weather?.city) {
    return null;
  }

  const city = config.weather.city;
  const units = config.weather.units ?? "metric";
  try {
    const { stdout } = await execFileAsync(
      "rustormy",
      ["--format", "json", "--city", city, "--units", units],
      { timeout: 5000, encoding: "utf-8" },
    );

    const text = String(stdout);
    const payload = JSON.parse(text) as Record<string, unknown>;
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
