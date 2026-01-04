import { loadConfig, type DereConfig } from "@dere/shared-config";

export class ConfigError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConfigError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function splitCsv(value: string | Iterable<string> | undefined | null): ReadonlySet<string> {
  if (value === undefined || value === null) {
    return new Set();
  }
  const parts =
    typeof value === "string"
      ? value.split(",").map((segment) => segment.trim())
      : Array.from(value, (segment) => String(segment).trim());
  return new Set(parts.filter(Boolean));
}

function coerceInt(field: string, value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  throw new ConfigError(`Invalid integer for ${field}: ${String(value)}`);
}

function coerceBool(field: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(lowered)) {
      return false;
    }
  }
  throw new ConfigError(`Invalid boolean for ${field}: ${String(value)}`);
}

function normalizePersonas(
  value: string | Iterable<string> | undefined | null,
  fallback: string,
): string[] {
  if (value === undefined || value === null) {
    return [fallback];
  }

  const raw =
    typeof value === "string"
      ? value.split(",").map((segment) => segment.trim())
      : Array.from(value, (segment) => String(segment).trim());

  const personas = raw.filter(Boolean);
  return personas.length > 0 ? personas : [fallback];
}

export type DiscordBotConfig = {
  token: string;
  defaultPersonas: string[];
  allowedGuilds: ReadonlySet<string>;
  allowedChannels: ReadonlySet<string>;
  idleTimeoutSeconds: number;
  summaryGraceSeconds: number;
  contextEnabled: boolean;
  sessionExpiryHours: number;
  userId: string | null;
};

export type DiscordConfigOverrides = {
  tokenOverride?: string | null;
  personaOverride?: string | null;
  allowGuilds?: Iterable<string> | null;
  allowChannels?: Iterable<string> | null;
  idleTimeoutOverride?: number | null;
  summaryGraceOverride?: number | null;
  contextOverride?: boolean | null;
  sessionExpiryOverride?: number | null;
};

export async function loadDiscordConfig(
  overrides: DiscordConfigOverrides = {},
): Promise<DiscordBotConfig> {
  const raw = (await loadConfig()) as DereConfig;
  const discordSection = (raw.discord ?? {}) as Record<string, unknown>;

  let token = overrides.tokenOverride ?? process.env.DERE_DISCORD_TOKEN ?? null;
  if (!token) {
    const configured =
      discordSection.token ?? discordSection.bot_token ?? discordSection.api_token ?? null;
    if (typeof configured === "string") {
      token = configured;
    }
  }

  if (!token) {
    throw new ConfigError(
      "Discord bot token missing. Provide --token, set DERE_DISCORD_TOKEN, or add [discord].token to config.toml.",
    );
  }

  const defaultPersonas = normalizePersonas(
    overrides.personaOverride ??
      process.env.DERE_DISCORD_PERSONA ??
      (discordSection.default_persona as string | undefined) ??
      (discordSection.personas as string | undefined) ??
      (discordSection.persona as string | undefined),
    "tsun",
  );

  const allowedGuilds = splitCsv(
    overrides.allowGuilds ??
      process.env.DERE_DISCORD_ALLOWED_GUILDS ??
      (discordSection.allowed_guilds as string | string[] | undefined),
  );

  const allowedChannels = splitCsv(
    overrides.allowChannels ??
      process.env.DERE_DISCORD_ALLOWED_CHANNELS ??
      (discordSection.allowed_channels as string | string[] | undefined),
  );

  const idleTimeoutSeconds = coerceInt(
    "idle_timeout_seconds",
    overrides.idleTimeoutOverride ??
      process.env.DERE_DISCORD_IDLE_TIMEOUT ??
      (discordSection.idle_timeout_seconds as unknown),
    1200,
  );

  const summaryGraceSeconds = coerceInt(
    "summary_grace_seconds",
    overrides.summaryGraceOverride ??
      process.env.DERE_DISCORD_SUMMARY_GRACE ??
      (discordSection.summary_grace_seconds as unknown),
    30,
  );

  const contextRaw =
    overrides.contextOverride ??
    process.env.DERE_DISCORD_CONTEXT ??
    (discordSection.context_enabled as unknown) ??
    (discordSection.context as unknown) ??
    true;
  const contextEnabled = coerceBool("context_enabled", contextRaw);

  const sessionExpiryHours = coerceInt(
    "session_expiry_hours",
    overrides.sessionExpiryOverride ??
      process.env.DERE_DISCORD_SESSION_EXPIRY ??
      (discordSection.session_expiry_hours as unknown),
    24,
  );

  const userId =
    process.env.DERE_DISCORD_USER_ID ??
    (discordSection.user_id as string | undefined) ??
    (discordSection.owner_id as string | undefined) ??
    (raw.user_id as string | undefined) ??
    null;

  return {
    token,
    defaultPersonas,
    allowedGuilds,
    allowedChannels,
    idleTimeoutSeconds,
    summaryGraceSeconds,
    contextEnabled,
    sessionExpiryHours,
    userId: userId ? String(userId) : null,
  };
}
