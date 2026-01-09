import { Bot } from "grammy";

import { createAgentClient, type AgentClient } from "@dere/daemon-client";

import { TelegramAgent } from "./agent.js";
import { loadTelegramConfig, type TelegramBotConfig } from "./config.js";
import { SessionManager } from "./session.js";

interface BotInstance {
  bot: Bot;
  agent: TelegramAgent;
  sessions: SessionManager;
  daemonAgent: AgentClient;
  config: TelegramBotConfig;
  username: string;
}

async function createBotInstance(config: TelegramBotConfig): Promise<BotInstance> {
  // Create bot first to get username from API
  const bot = new Bot(config.token);
  const botInfo = await bot.api.getMe();
  const username = botInfo.username;

  console.log(`[@${username}] Creating bot instance...`);

  const wsUrl = config.daemonUrl.replace(/^http/, "ws");
  const daemonAgent = createAgentClient({ baseUrl: wsUrl });
  const sessions = new SessionManager(config, username);
  const agent = new TelegramAgent(config, sessions, daemonAgent);

  // Set up message handler
  bot.on("message:text", async (ctx) => {
    // Ignore messages from bots
    if (ctx.from?.is_bot) {
      return;
    }

    const chatId = ctx.chat.id;

    // Check if chat is allowed (empty set = all chats allowed)
    if (config.allowedChats.size > 0 && !config.allowedChats.has(chatId)) {
      return;
    }

    const sender = ctx.from?.username ?? ctx.from?.first_name ?? "unknown";
    const text = ctx.message?.text ?? "";

    console.log(`[@${username}] [${chatId}] ${sender}: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);

    try {
      await agent.handleMessage(ctx);
    } catch (error) {
      console.error(`[@${username}] Failed to handle message:`, error);
    }
  });

  return { bot, agent, sessions, daemonAgent, config, username };
}

async function main(): Promise<void> {
  console.log("Loading Telegram config...");
  const config = await loadTelegramConfig();

  console.log(`Found ${config.bots.length} bot(s) in config`);

  const instances: BotInstance[] = [];

  for (const botConfig of config.bots) {
    const instance = await createBotInstance(botConfig);
    instances.push(instance);
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down...");

    for (const instance of instances) {
      const { bot, sessions, daemonAgent, username } = instance;

      console.log(`[@${username}] Stopping...`);

      try {
        await bot.stop();
      } catch (error) {
        console.error(`[@${username}] Error stopping bot:`, error);
      }

      try {
        await sessions.closeAll();
      } catch (error) {
        console.error(`[@${username}] Error closing sessions:`, error);
      }

      try {
        daemonAgent.close();
      } catch (error) {
        console.error(`[@${username}] Error closing daemon connection:`, error);
      }
    }

    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Start all bots
  console.log("Starting bots...");

  await Promise.all(
    instances.map(async (instance) => {
      const { bot, config: botConfig, username } = instance;

      console.log(`[@${username}] Starting (personality: ${botConfig.personality})...`);

      // Start long polling
      bot.start({
        onStart: () => {
          console.log(`[@${username}] Bot is running`);
        },
      });
    }),
  );

  console.log("All bots started. Press Ctrl+C to stop.");
}

// Catch unhandled promise rejections to prevent crashes from AbortError
process.on("unhandledRejection", (error) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    console.warn("Unhandled AbortError - ignoring");
    return;
  }
  console.error("Unhandled rejection:", error);
  process.exit(1);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
