import { Bot, Context } from "grammy";

import type { TelegramBotConfig } from "./config.js";

export type { Context };

export interface BotOptions {
  config: TelegramBotConfig;
  onMessage: (ctx: Context) => void | Promise<void>;
}

export function createBot(options: BotOptions): Bot {
  const { config, onMessage } = options;
  const bot = new Bot(config.token);

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    // Ignore messages from the bot itself
    if (ctx.from?.is_bot) {
      return;
    }

    const chatId = ctx.chat.id;

    // Check if chat is allowed (empty set = all chats allowed)
    if (config.allowedChats.size > 0 && !config.allowedChats.has(chatId)) {
      return;
    }

    await onMessage(ctx);
  });

  return bot;
}

export async function sendTyping(ctx: Context): Promise<void> {
  try {
    await ctx.replyWithChatAction("typing");
  } catch (error) {
    // Typing indicator failures are non-fatal
    console.warn("Failed to send typing action:", error);
  }
}

export async function sendMessage(ctx: Context, text: string): Promise<void> {
  // Telegram has a 4096 character limit per message
  const MAX_LENGTH = 4096;

  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text);
    return;
  }

  // Split into chunks
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at newline
    let splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1 || splitIndex < MAX_LENGTH / 2) {
      // No good newline, split at space
      splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
    }
    if (splitIndex === -1 || splitIndex < MAX_LENGTH / 2) {
      // No good space, hard split
      splitIndex = MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}
