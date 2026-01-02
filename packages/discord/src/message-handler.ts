import type { EmbedBuilder, Message } from "discord.js";

import type { DiscordAgent } from "./agent.js";
import type { PersonaProfile } from "./persona.js";

type BuildEmbedFn = (toolEvents: string[], personaProfile: PersonaProfile) => EmbedBuilder;

class TypingIndicator {
  private interval: ReturnType<typeof setInterval> | null = null;
  private active = false;

  async start(channel: { sendTyping: () => Promise<void> }): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;

    const send = async () => {
      try {
        await channel.sendTyping();
      } catch {
        // Ignore typing errors to avoid noisy logs.
      }
    };

    await send();
    this.interval = setInterval(() => {
      void send();
    }, 8000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.active = false;
  }
}

class MessageHandlerCallbacks {
  private readonly message: Message;
  private readonly buildEmbedFn: BuildEmbedFn;

  constructor(message: Message, buildEmbedFn: BuildEmbedFn) {
    this.message = message;
    this.buildEmbedFn = buildEmbedFn;
  }

  async sendInitial(): Promise<void> {
    // Typing indicator already active; no placeholder message needed.
  }

  async sendTextMessage(text: string, _personaProfile: PersonaProfile): Promise<void> {
    const content = text?.trim();
    if (!content) {
      return;
    }
    await this.message.channel.send({
      content,
      allowedMentions: { parse: [] },
    });
  }

  async sendToolSummary(toolEvents: string[], personaProfile: PersonaProfile): Promise<void> {
    if (toolEvents.length === 0) {
      return;
    }
    const embed = this.buildEmbedFn(toolEvents, personaProfile);
    await this.message.channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }
}

export async function handleDiscordMessage(args: {
  message: Message;
  agent: DiscordAgent;
  guildId: string | null;
  channelId: string;
  userId: string;
  content: string;
  buildEmbedFn: BuildEmbedFn;
}): Promise<void> {
  const callbacks = new MessageHandlerCallbacks(args.message, args.buildEmbedFn);
  const typing = new TypingIndicator();
  await typing.start(args.message.channel);

  const finalize = async () => {
    typing.stop();
  };

  try {
    await args.agent.handleMessage({
      guildId: args.guildId,
      channelId: args.channelId,
      userId: args.userId,
      content: args.content,
      callbacks: {
        sendInitial: () => callbacks.sendInitial(),
        sendTextMessage: (text, profile) => callbacks.sendTextMessage(text, profile),
        sendToolSummary: (events, profile) => callbacks.sendToolSummary(events, profile),
        finalize,
      },
    });
  } catch (error) {
    console.error(`Failed handling message in channel ${args.channelId}: ${String(error)}`);
    await args.message.channel.send({
      content: "Sorry, something went wrong while contacting Claude.",
      allowedMentions: { parse: [] },
    });
    typing.stop();
  }
}
