import type { AgentClient } from "@dere/daemon-client";

import type { Context } from "./bot.js";
import { sendMessage, sendTyping } from "./bot.js";
import type { TelegramBotConfig } from "./config.js";
import type { SessionManager } from "./session.js";

export class TelegramAgent {
  private readonly config: TelegramBotConfig;
  private readonly sessions: SessionManager;
  private readonly daemon: AgentClient;
  private readonly locks = new Map<number, Promise<void>>();
  private typingIntervals = new Map<number, ReturnType<typeof setInterval>>();

  constructor(
    config: TelegramBotConfig,
    sessions: SessionManager,
    daemon: AgentClient,
  ) {
    this.config = config;
    this.sessions = sessions;
    this.daemon = daemon;
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

  private async streamResponse(prompt: string): Promise<string> {
    const parts: string[] = [];

    try {
      for await (const event of this.daemon.query(prompt)) {
        if (event.type === "text" || event.type === "thinking") {
          const text = typeof event.data.text === "string" ? event.data.text : "";
          if (text) {
            parts.push(text);
          }
        } else if (event.type === "error") {
          const message = typeof event.data.message === "string" ? event.data.message : "Unknown error";
          console.error(`Agent error: ${message}`);
          if (event.data.recoverable === false) {
            break;
          }
        } else if (event.type === "done") {
          break;
        }
      }
    } catch (error) {
      console.error(`Failed while streaming response: ${String(error)}`);
      throw error;
    }

    return parts.join("").trim();
  }

  private startTyping(ctx: Context): void {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Send initial typing
    void sendTyping(ctx);

    // Telegram typing indicator expires after ~5 seconds, so resend periodically
    const interval = setInterval(() => {
      void sendTyping(ctx);
    }, 4000);

    this.typingIntervals.set(chatId, interval);
  }

  private stopTyping(chatId: number): void {
    const interval = this.typingIntervals.get(chatId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  async handleMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const content = ctx.message?.text;
    const sender = ctx.from?.username ?? ctx.from?.first_name ?? String(ctx.from?.id ?? "unknown");

    if (!chatId || !content) {
      return;
    }

    await this.withLock(chatId, async () => {
      const session = await this.sessions.ensureSession(chatId);

      // Capture user message
      await this.sessions.captureMessage(session, { content, role: "user" });

      // Ensure daemon session
      const config = {
        working_dir: session.projectPath,
        output_style: "telegram",
        personality: session.personality,
        user_id: sender,
        include_context: this.config.contextEnabled,
        auto_approve: true, // No interactive tool approval in Telegram
      };

      try {
        await this.daemon.ensureSession(config, session.daemonSessionId);
        session.daemonSessionId = this.daemon.sessionId;
      } catch (error) {
        console.error("Failed to ensure daemon session", error);
        throw error;
      }

      // Start typing indicator
      this.startTyping(ctx);

      try {
        // Stream response
        const response = await this.streamResponse(content);

        // Stop typing
        this.stopTyping(chatId);

        // Send response
        if (response) {
          await sendMessage(ctx, response);
          await this.sessions.captureMessage(session, { content: response, role: "assistant" });
        }

        // Schedule summary after idle timeout
        await this.sessions.scheduleSummary(session);
      } catch (error) {
        this.stopTyping(chatId);
        throw error;
      }
    });
  }
}
