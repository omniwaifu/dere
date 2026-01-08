import type { AgentClient } from "@dere/daemon-client";
import type { PersonaProfile } from "./persona.js";
import type { ChannelSession, SessionManager } from "./session.js";

type Awaitable<T> = T | Promise<T>;

type SendTextMessage = (text: string, profile: PersonaProfile) => Promise<void>;
type SendToolSummary = (events: string[], profile: PersonaProfile) => Promise<void>;

type MessageCallbacks = {
  sendInitial: () => Awaitable<void>;
  sendTextMessage: SendTextMessage;
  sendToolSummary: SendToolSummary;
  finalize: () => Awaitable<void>;
};

export class DiscordAgent {
  private readonly sessions: SessionManager;
  private readonly daemon: AgentClient;
  private readonly locks = new Map<string, Promise<void>>();
  private readonly contextEnabled: boolean;

  constructor(sessions: SessionManager, daemon: AgentClient, contextEnabled = true) {
    this.sessions = sessions;
    this.daemon = daemon;
    this.contextEnabled = contextEnabled;
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

  private async streamResponse(
    session: ChannelSession,
    callbacks: { sendTextMessage: SendTextMessage; sendToolSummary: SendToolSummary },
  ): Promise<{ toolSeen: boolean; preTool: string[]; postTool: string[]; toolEvents: string[] }> {
    const preTool: string[] = [];
    const postTool: string[] = [];
    const toolEvents: string[] = [];
    let toolSeen = false;

    try {
      for await (const event of this.daemon.query(session.pendingPrompt)) {
        if (event.type === "text" || event.type === "thinking") {
          const text = typeof event.data.text === "string" ? event.data.text : "";
          if (text) {
            if (toolSeen) {
              postTool.push(text);
            } else {
              preTool.push(text);
            }
          }
        } else if (event.type === "tool_use") {
          if (!toolSeen) {
            toolSeen = true;
            const initialText = preTool.join("").trim();
            if (initialText) {
              await callbacks.sendTextMessage(initialText, session.personaProfile);
              await this.sessions.captureMessage(session, {
                content: initialText,
                role: "assistant",
              });
            }
            preTool.length = 0;
          }

          const name = typeof event.data.name === "string" ? event.data.name : "unknown";
          const toolInput = event.data.input ?? {};
          const preview = this.preview(toolInput);
          toolEvents.push(`Running \`${name}\`: ${preview}`);
        } else if (event.type === "tool_result") {
          const output = event.data.output ?? "";
          const isError = Boolean(event.data.is_error);
          const formatted = this.preview(output, 400);
          toolEvents.push(`${isError ? "Tool failed" : "Tool completed"}\n${formatted}`.trim());
        } else if (event.type === "error") {
          const message =
            typeof event.data.message === "string" ? event.data.message : "Unknown error";
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

    return { toolSeen, preTool, postTool, toolEvents };
  }

  private async finalizeResponse(
    session: ChannelSession,
    result: { toolSeen: boolean; preTool: string[]; postTool: string[]; toolEvents: string[] },
    callbacks: { sendTextMessage: SendTextMessage; sendToolSummary: SendToolSummary },
  ): Promise<void> {
    const { toolSeen, preTool, postTool, toolEvents } = result;
    const personaProfile = session.personaProfile;

    if (!toolSeen) {
      const responseText = preTool.join("").trim();
      await callbacks.sendTextMessage(responseText, personaProfile);
      if (responseText) {
        await this.sessions.captureMessage(session, {
          content: responseText,
          role: "assistant",
        });
      }
    } else {
      const finalText = postTool.join("").trim();
      if (toolEvents.length > 0) {
        await callbacks.sendToolSummary(toolEvents, personaProfile);
      }
      if (finalText) {
        await callbacks.sendTextMessage(finalText, personaProfile);
        await this.sessions.captureMessage(session, {
          content: finalText,
          role: "assistant",
        });
      }
    }

    await this.sessions.scheduleSummary(session);
  }

  async handleMessage(args: {
    guildId: string | null;
    channelId: string;
    userId: string | null;
    content: string;
    callbacks: MessageCallbacks;
  }): Promise<void> {
    const key = `${args.guildId ?? "dm"}:${args.channelId}`;
    await this.withLock(key, async () => {
      const session = await this.sessions.ensureSession({
        guildId: args.guildId,
        channelId: args.channelId,
        userId: args.userId ?? null,
      });

      await this.sessions.captureMessage(session, { content: args.content, role: "user" });
      session.pendingPrompt = args.content;

      const config = {
        working_dir: session.projectPath,
        output_style: "discord",
        personality: session.personas.join(","),
        user_id: session.userId ?? null,
        include_context: this.contextEnabled,
      };

      try {
        await this.daemon.ensureSession(config, session.daemonSessionId);
        session.daemonSessionId = this.daemon.sessionId;
      } catch (error) {
        console.error("Failed to ensure daemon session", error);
        throw error;
      }

      await args.callbacks.sendInitial();

      try {
        const result = await this.streamResponse(session, {
          sendTextMessage: args.callbacks.sendTextMessage,
          sendToolSummary: args.callbacks.sendToolSummary,
        });
        await args.callbacks.finalize();
        await this.finalizeResponse(session, result, {
          sendTextMessage: args.callbacks.sendTextMessage,
          sendToolSummary: args.callbacks.sendToolSummary,
        });
      } catch (error) {
        await args.callbacks.finalize();
        throw error;
      }
    });
  }

  private preview(data: unknown, limit = 120): string {
    if (typeof data === "string") {
      const text = data.trim();
      if (!text) {
        return "(no output)";
      }
      return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
    }

    if (data && typeof data === "object" && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      for (const key of ["text", "content", "stdout", "output", "result", "command"]) {
        if (record[key]) {
          return this.preview(record[key], limit);
        }
      }
      return "(no output)";
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return "(no output)";
      }
      const parts = data.map((item) => this.preview(item, limit));
      const text = parts.filter((part) => part && part !== "(no output)").join("\n");
      if (!text) {
        return "(no output)";
      }
      return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
    }

    const text = String(data ?? "").trim();
    if (!text) {
      return "(no output)";
    }
    return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
  }
}
