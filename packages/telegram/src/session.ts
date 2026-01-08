import { performance } from "node:perf_hooks";

import { createHookClient, type HookClient } from "@dere/daemon-client";

import type { TelegramBotConfig } from "./config.js";

export type MessageRole = "user" | "assistant" | "system";

function nowSeconds(): number {
  return performance.now() / 1000;
}

function formatProjectPath(botUsername: string, chatId: number): string {
  return `telegram://${botUsername}/${chatId}`;
}

export type ChatSession = {
  key: string;
  chatId: number;
  sessionId: number;
  daemonSessionId: number | null;
  personality: string;
  projectPath: string;
  createdAt: number;
  lastActivity: number;
  summaryTimer: ReturnType<typeof setTimeout> | null;
};

export class SessionManager {
  private readonly config: TelegramBotConfig;
  private readonly daemon: HookClient;
  private readonly username: string;
  private readonly sessions = new Map<number, ChatSession>();
  private readonly locks = new Map<number, Promise<void>>();

  constructor(config: TelegramBotConfig, username: string) {
    this.config = config;
    this.username = username;
    this.daemon = createHookClient({ baseUrl: config.daemonUrl });
  }

  private async withLock<T>(chatId: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(chatId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      chatId,
      previous.then(() => next),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(chatId) === next) {
        this.locks.delete(chatId);
      }
    }
  }

  async ensureSession(chatId: number): Promise<ChatSession> {
    return this.withLock(chatId, async () => {
      const existing = this.sessions.get(chatId);
      if (existing) {
        return existing;
      }

      const projectPath = formatProjectPath(this.username, chatId);

      const { session_id: sessionId, resumed } = await this.daemon.findOrCreateSession({
        working_dir: projectPath,
        personality: this.config.personality,
        medium: "telegram",
        max_age_hours: this.config.sessionExpiryHours,
      });

      if (resumed) {
        console.info(`[@${this.username}] Resumed session ${sessionId} for chat ${chatId}`);
      } else {
        console.info(`[@${this.username}] Created session ${sessionId} for chat ${chatId}`);
      }

      const now = nowSeconds();
      const session: ChatSession = {
        key: `${this.username}:${chatId}`,
        chatId,
        sessionId,
        daemonSessionId: null,
        personality: this.config.personality,
        projectPath,
        createdAt: now,
        lastActivity: now,
        summaryTimer: null,
      };
      this.sessions.set(chatId, session);
      return session;
    });
  }

  getSession(chatId: number): ChatSession | null {
    return this.sessions.get(chatId) ?? null;
  }

  async captureMessage(
    session: ChatSession,
    args: { content: string; role: MessageRole },
  ): Promise<void> {
    await this.daemon.captureConversation({
      session_id: session.sessionId,
      personality: session.personality,
      project_path: session.projectPath,
      prompt: args.content,
      message_type: args.role,
      is_command: false,
    });
    await this.cancelSummary(session);
    session.lastActivity = nowSeconds();
  }

  async scheduleSummary(session: ChatSession): Promise<void> {
    if (session.summaryTimer) {
      return;
    }

    const delay = this.config.idleTimeoutSeconds;

    session.summaryTimer = setTimeout(async () => {
      session.summaryTimer = null;
      await this.daemon.endSession({
        session_id: session.sessionId,
        exit_reason: "idle_timeout",
      });
      await this.closeSession({ chatId: session.chatId, reason: "idle_timeout", queueSummary: false });
    }, delay * 1000);
  }

  async cancelSummary(session: ChatSession): Promise<void> {
    if (session.summaryTimer) {
      clearTimeout(session.summaryTimer);
      session.summaryTimer = null;
    }
  }

  async closeSession(args: {
    chatId: number;
    reason?: string;
    queueSummary?: boolean;
  }): Promise<void> {
    const { chatId, reason = "manual", queueSummary = true } = args;
    await this.withLock(chatId, async () => {
      const session = this.sessions.get(chatId);
      if (!session) {
        return;
      }
      this.sessions.delete(chatId);

      if (session.summaryTimer) {
        clearTimeout(session.summaryTimer);
        session.summaryTimer = null;
      }

      if (queueSummary) {
        try {
          await this.daemon.endSession({
            session_id: session.sessionId,
            exit_reason: reason,
          });
        } catch (error) {
          console.warn(`Failed to queue summary for chat ${chatId}: ${String(error)}`);
        }
      }
    });
  }

  async closeAll(): Promise<void> {
    const chatIds = Array.from(this.sessions.keys());
    for (const chatId of chatIds) {
      try {
        await this.closeSession({ chatId, reason: "shutdown", queueSummary: true });
      } catch (error) {
        console.warn(`Failed to close session for chat ${chatId}: ${String(error)}`);
      }
    }
  }
}
