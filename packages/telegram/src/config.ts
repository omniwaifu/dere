import { loadConfig, getDaemonUrlFromConfig } from "@dere/shared-config";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface TelegramBotConfig {
  token: string;
  personality: string;
  allowedChats: ReadonlySet<number>;
  idleTimeoutSeconds: number;
  sessionExpiryHours: number;
  contextEnabled: boolean;
  daemonUrl: string;
}

export interface TelegramConfig {
  bots: TelegramBotConfig[];
  daemonUrl: string;
}

function parseNumberArray(value: unknown): number[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter((n) => Number.isFinite(n));
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

interface BotConfigRaw {
  token?: unknown;
  personality?: unknown;
  allowed_chats?: unknown;
  idle_timeout_seconds?: unknown;
  session_expiry_hours?: unknown;
  context_enabled?: unknown;
}

function parseBotConfig(raw: BotConfigRaw, daemonUrl: string, index: number): TelegramBotConfig {
  const token = String(raw.token ?? "");
  if (!token) {
    throw new ConfigError(`Missing telegram.bots[${index}].token`);
  }

  const personality = String(raw.personality ?? "tsun");
  const allowedChats = new Set(parseNumberArray(raw.allowed_chats));
  const idleTimeoutSeconds = Number(raw.idle_timeout_seconds ?? 1200);
  const sessionExpiryHours = Number(raw.session_expiry_hours ?? 24);
  const contextEnabled = raw.context_enabled !== false;

  return {
    token,
    personality,
    allowedChats,
    idleTimeoutSeconds,
    sessionExpiryHours,
    contextEnabled,
    daemonUrl,
  };
}

export async function loadTelegramConfig(): Promise<TelegramConfig> {
  const config = await loadConfig();
  const telegram = config.telegram as Record<string, unknown> | undefined;

  if (!telegram) {
    throw new ConfigError("Missing [telegram] section in config.toml");
  }

  const daemonUrl = getDaemonUrlFromConfig(config);
  const botsRaw = telegram.bots as BotConfigRaw[] | undefined;

  if (!botsRaw || !Array.isArray(botsRaw) || botsRaw.length === 0) {
    throw new ConfigError("Missing or empty [[telegram.bots]] in config.toml");
  }

  const bots = botsRaw.map((raw, index) => parseBotConfig(raw, daemonUrl, index));

  return {
    bots,
    daemonUrl,
  };
}
