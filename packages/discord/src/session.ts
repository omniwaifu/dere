import { performance } from "node:perf_hooks";

import type { DiscordBotConfig } from "./config.js";
import type { ConversationCapturePayload } from "./daemon.js";
import type { DaemonClient } from "./daemon.js";
import { formatProjectPath } from "./paths.js";
import type { PersonaProfile, PersonaService } from "./persona.js";

export type MessageRole = "user" | "assistant" | "system";

function nowSeconds(): number {
  return performance.now() / 1000;
}

export type ChannelSession = {
  key: string;
  sessionId: number;
  daemonSessionId: number | null;
  personas: string[];
  personaProfile: PersonaProfile;
  projectPath: string;
  createdAt: number;
  lastActivity: number;
  summaryTimer: ReturnType<typeof setTimeout> | null;
  userId: string | null;
  pendingPrompt: string;
};

export class SessionManager {
  private readonly config: DiscordBotConfig;
  private readonly daemon: DaemonClient;
  private readonly personaService: PersonaService;
  private readonly sessions = new Map<string, ChannelSession>();
  private readonly locks = new Map<string, Promise<void>>();
  private botIdentity: string | null = null;

  constructor(config: DiscordBotConfig, daemon: DaemonClient, personaService: PersonaService) {
    this.config = config;
    this.daemon = daemon;
    this.personaService = personaService;
  }

  private makeKey(guildId: string | null, channelId: string): string {
    return `${guildId ?? "dm"}:${channelId}`;
  }

  setBotIdentity(identity: string | null): void {
    this.botIdentity = identity;
    this.personaService.setIdentity(identity);
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      key,
      previous.then(() => next),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  async ensureSession(args: {
    guildId: string | null;
    channelId: string;
    userId?: string | null;
  }): Promise<ChannelSession> {
    const key = this.makeKey(args.guildId, args.channelId);
    return this.withLock(key, async () => {
      const existing = this.sessions.get(key);
      if (existing) {
        return existing;
      }

      const profile = await this.personaService.resolve(this.personaService.defaults);
      const projectPath = formatProjectPath({
        guildId: args.guildId,
        channelId: args.channelId,
        userId: args.userId ?? null,
      });
      const personaLabel = profile.names.join(",");
      const userIdStr = args.userId ?? null;

      const { sessionId, resumed } = await this.daemon.findOrCreateSession({
        workingDir: projectPath,
        personality: personaLabel,
        maxAgeHours: this.config.sessionExpiryHours,
        userId: userIdStr,
      });

      if (resumed) {
        console.info(`Resumed session ${sessionId} for channel ${key}`);
      } else {
        console.info(`Created new session ${sessionId} for channel ${key}`);
      }

      const now = nowSeconds();
      const session: ChannelSession = {
        key,
        sessionId,
        daemonSessionId: null,
        personas: profile.names,
        personaProfile: profile,
        projectPath,
        createdAt: now,
        lastActivity: now,
        summaryTimer: null,
        userId: userIdStr,
        pendingPrompt: "",
      };
      this.sessions.set(key, session);
      return session;
    });
  }

  getSession(args: { guildId: string | null; channelId: string }): ChannelSession | null {
    const key = this.makeKey(args.guildId, args.channelId);
    return this.sessions.get(key) ?? null;
  }

  async captureMessage(
    session: ChannelSession,
    args: { content: string; role: MessageRole },
  ): Promise<void> {
    const payload: ConversationCapturePayload = {
      session_id: session.sessionId,
      personality: session.personas.join(","),
      project_path: session.projectPath,
      prompt: args.content,
      message_type: args.role,
      is_command: false,
      exit_code: 0,
      medium: "discord",
      user_id: session.userId,
    };
    await this.daemon.captureMessage(payload);
    await this.cancelSummary(session);
    session.lastActivity = nowSeconds();
  }

  async scheduleSummary(
    session: ChannelSession,
    options: { delaySeconds?: number | null } = {},
  ): Promise<void> {
    if (session.summaryTimer) {
      return;
    }

    const delay =
      options.delaySeconds ?? this.config.idleTimeoutSeconds + this.config.summaryGraceSeconds;

    session.summaryTimer = setTimeout(async () => {
      session.summaryTimer = null;
      const duration = Math.max(0, nowSeconds() - session.createdAt);
      await this.daemon.endSession({
        session_id: session.sessionId,
        exit_reason: "idle_timeout",
        duration_seconds: Math.floor(duration),
      });
      await this.closeSession({ key: session.key, reason: "idle_timeout", queueSummary: false });
    }, delay * 1000);
  }

  async cancelSummary(session: ChannelSession): Promise<void> {
    if (session.summaryTimer) {
      clearTimeout(session.summaryTimer);
      session.summaryTimer = null;
    }
  }

  async closeSession(args: {
    guildId?: string | null;
    channelId?: string;
    key?: string;
    reason?: string;
  }): Promise<void> {
    const key = args.key ?? this.makeKey(args.guildId ?? null, args.channelId ?? "");
    await this.withLock(key, async () => {
      await this.closeSessionInternal(key, { reason: args.reason ?? "manual", queueSummary: true });
    });
  }

  private async closeSessionInternal(
    key: string,
    args: { reason: string; queueSummary: boolean },
  ): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }
    this.sessions.delete(key);

    if (session.summaryTimer) {
      clearTimeout(session.summaryTimer);
      session.summaryTimer = null;
    }

    if (args.queueSummary) {
      const duration = Math.max(0, nowSeconds() - session.createdAt);
      try {
        await this.daemon.endSession({
          session_id: session.sessionId,
          exit_reason: args.reason,
          duration_seconds: Math.floor(duration),
        });
      } catch (error) {
        console.warn(`Failed to queue summary for session ${key}: ${String(error)}`);
      }
    }
  }

  async closeAll(): Promise<void> {
    const keys = Array.from(this.sessions.keys());
    for (const key of keys) {
      try {
        await this.closeSessionInternal(key, { reason: "shutdown", queueSummary: true });
      } catch (error) {
        console.warn(`Failed to close session ${key} cleanly: ${String(error)}`);
      }
    }
  }
}
