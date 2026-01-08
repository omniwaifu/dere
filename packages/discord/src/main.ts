import process from "node:process";

import * as Sentry from "@sentry/bun";

import { createAgentClient } from "@dere/daemon-client";

import { DiscordAgent } from "./agent.js";
import { DereDiscordClient } from "./bot.js";
import { ConfigError, loadDiscordConfig } from "./config.js";
import { DaemonClient } from "./daemon.js";
import { PersonaService } from "./persona.js";
import { SessionManager } from "./session.js";
import { loadConfig, getDaemonUrlFromConfig } from "@dere/shared-config";

type CliOptions = {
  token?: string | null;
  personas: string[];
  guilds: string[];
  channels: string[];
  idleTimeout?: number | null;
  summaryGrace?: number | null;
  contextFlag?: boolean | null;
  help: boolean;
};

const USAGE = `dere-discord

Usage:
  bun src/main.ts [options]

Options:
  --token TOKEN           Discord bot token override
  --persona NAME          Default persona(s) for new channels (repeatable)
  --guild GUILD_ID        Limit bot usage to specified guild IDs (repeatable)
  --channel CHANNEL_ID    Limit bot usage to specified channel IDs (repeatable)
  --idle-timeout SECONDS  Seconds of inactivity before ending a session (default 1200)
  --summary-grace SECONDS Delay between idle trigger and summarization (default 30)
  --context               Enable contextual prompt enrichment (default)
  --no-context            Disable contextual prompt enrichment
  -h, --help              Show this help text
`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    personas: [],
    guilds: [],
    channels: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--token":
        if (!argv[i + 1]) {
          throw new Error("--token requires a value");
        }
        options.token = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--persona":
        if (!argv[i + 1]) {
          throw new Error("--persona requires a value");
        }
        options.personas.push(argv[i + 1] as string);
        i += 1;
        break;
      case "--guild":
        if (!argv[i + 1]) {
          throw new Error("--guild requires a value");
        }
        options.guilds.push(argv[i + 1] as string);
        i += 1;
        break;
      case "--channel":
        if (!argv[i + 1]) {
          throw new Error("--channel requires a value");
        }
        options.channels.push(argv[i + 1] as string);
        i += 1;
        break;
      case "--idle-timeout":
        if (!argv[i + 1]) {
          throw new Error("--idle-timeout requires a value");
        }
        options.idleTimeout = Number(argv[i + 1]);
        if (!Number.isFinite(options.idleTimeout)) {
          throw new Error("--idle-timeout must be a number");
        }
        i += 1;
        break;
      case "--summary-grace":
        if (!argv[i + 1]) {
          throw new Error("--summary-grace requires a value");
        }
        options.summaryGrace = Number(argv[i + 1]);
        if (!Number.isFinite(options.summaryGrace)) {
          throw new Error("--summary-grace must be a number");
        }
        i += 1;
        break;
      case "--context":
        options.contextFlag = true;
        break;
      case "--no-context":
        options.contextFlag = false;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function formatCollection(values: Iterable<string> | null | undefined): string {
  const list = values ? Array.from(values) : [];
  if (list.length === 0) {
    return "-";
  }
  return list.sort().join(", ");
}

function displayConfig(config: Awaited<ReturnType<typeof loadDiscordConfig>>): void {
  console.log("Dere Discord configuration:");
  console.log(`  Persona         : ${config.defaultPersonas.join(", ")}`);
  console.log(`  Idle timeout    : ${config.idleTimeoutSeconds}s`);
  console.log(`  Summary grace   : ${config.summaryGraceSeconds}s`);
  console.log(`  Context         : ${config.contextEnabled ? "on" : "off"}`);
  console.log(`  Session expiry  : ${config.sessionExpiryHours}h`);
  console.log(`  Guilds          : ${formatCollection(config.allowedGuilds)}`);
  console.log(`  Channels        : ${formatCollection(config.allowedChannels)}`);
}

async function run(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.log(USAGE.trim());
    process.exit(1);
    return;
  }
  if (options.help) {
    console.log(USAGE.trim());
    return;
  }

  if (process.env.DERE_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.DERE_SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.DERE_ENV ?? "development",
      attachStacktrace: true,
      maxBreadcrumbs: 50,
    });
    Sentry.setTag("component", "discord");
    console.info("Sentry initialized for discord");
  }

  let config;
  try {
    config = await loadDiscordConfig({
      tokenOverride: options.token ?? null,
      personaOverride: options.personas.length > 0 ? options.personas.join(",") : null,
      allowGuilds: options.guilds.length > 0 ? options.guilds : null,
      allowChannels: options.channels.length > 0 ? options.channels : null,
      idleTimeoutOverride: options.idleTimeout ?? null,
      summaryGraceOverride: options.summaryGrace ?? null,
      contextOverride: options.contextFlag ?? null,
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  displayConfig(config);

  const coreConfig = await loadConfig();
  const daemonUrl = getDaemonUrlFromConfig(coreConfig);
  const wsUrl = daemonUrl.replace(/^http/, "ws");

  const personaService = new PersonaService(config.defaultPersonas);
  const daemon = new DaemonClient(daemonUrl);
  const daemonAgent = createAgentClient({ baseUrl: wsUrl });
  const sessions = new SessionManager(config, daemon, personaService);
  const agent = new DiscordAgent(sessions, daemonAgent, config.contextEnabled);
  const client = new DereDiscordClient({
    config,
    sessions,
    agent,
    daemonClient: daemon,
  });

  const shutdown = async () => {
    await client.shutdown();
    await daemonAgent.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  try {
    await client.login(config.token);
  } catch (error) {
    await client.shutdown();
    await daemonAgent.close();
    throw error;
  }
}

if (import.meta.main) {
  run().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
}
