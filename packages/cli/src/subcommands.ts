import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { getConfigPath, loadConfig, getDaemonUrlFromConfig } from "@dere/shared-config";

async function resolveDaemonUrl(): Promise<string> {
  const config = await loadConfig();
  return getDaemonUrlFromConfig(config);
}

const MAIN_HELP = `Dere - Personality-layered wrapper for Claude Code

Usage:
  dere [subcommand] [options] [--] [claude args...]

Subcommands:
  daemon    Daemon management
  config    Configuration management
  version   Show version
  -h, --help  Show help
`;

const DAEMON_HELP = `Daemon management

Usage:
  dere daemon status
  dere daemon start
  dere daemon stop
  dere daemon restart
`;

const CONFIG_HELP = `Configuration management

Usage:
  dere config show
  dere config path
  dere config edit
`;

function getDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "dere");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? homedir();
    return join(local, "dere");
  }
  return join(homedir(), ".local", "share", "dere");
}

function pidPath(): string {
  return join(getDataDir(), "daemon.pid");
}

async function daemonStatus(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const daemonUrl = await resolveDaemonUrl();
    const response = await fetch(`${daemonUrl}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("Daemon is not responding correctly");
      process.exit(1);
    }
    const data = (await response.json()) as Record<string, unknown>;
    console.log("Daemon is running");
    console.log(`  DereGraph: ${String(data.dere_graph ?? "unknown")}`);
    console.log(`  Claude auth: ${String(data.claude_auth ?? "unknown")}`);
  } catch {
    console.error("Daemon is not running");
    process.exit(1);
  } finally {
    clearTimeout(timeout);
  }
}

async function daemonStart(): Promise<void> {
  const path = pidPath();
  if (existsSync(path)) {
    console.error("Daemon appears to be running (PID file exists)");
    console.error("Use 'dere daemon status' to verify");
    process.exit(1);
  }

  const child = spawn("bun", ["packages/daemon/src/index.ts"], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  console.log("Daemon started");
}

async function daemonStop(): Promise<void> {
  const path = pidPath();
  if (!existsSync(path)) {
    console.error("Daemon is not running (no PID file)");
    process.exit(1);
  }
  try {
    const pid = Number((await readFile(path, "utf-8")).trim());
    if (!Number.isFinite(pid)) {
      throw new Error("Invalid PID");
    }
    process.kill(pid, "SIGTERM");
    console.log(`Sent stop signal to daemon (PID ${pid})`);
  } catch (error) {
    console.error(`Failed to stop daemon: ${String(error)}`);
    process.exit(1);
  }
}

async function daemonRestart(): Promise<void> {
  const path = pidPath();
  if (existsSync(path)) {
    try {
      const pid = Number((await readFile(path, "utf-8")).trim());
      if (Number.isFinite(pid)) {
        process.kill(pid, "SIGTERM");
        console.log(`Stopping daemon (PID ${pid})...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch {
      // ignore
    }
  }
  await daemonStart();
  console.log("Daemon restarted");
}

async function configShow(): Promise<void> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }
  const text = await readFile(configPath, "utf-8");
  console.log(text);
}

function configPath(): void {
  console.log(getConfigPath());
}

function configEdit(): void {
  const configFile = getConfigPath();
  const editor = process.env.EDITOR ?? "nano";
  const result = spawnSync(editor, [configFile], { stdio: "inherit" });
  if (result.status && result.status !== 0) {
    console.error(`Failed to open editor: ${result.stderr?.toString() ?? ""}`);
    process.exit(result.status);
  }
}

export async function runSubcommand(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(MAIN_HELP.trim());
    return;
  }

  const [command, ...rest] = args;
  if (command === "version") {
    console.log("dere 0.1.0");
    return;
  }
  if (command === "daemon") {
    const sub = rest[0];
    if (!sub || sub === "--help" || sub === "-h") {
      console.log(DAEMON_HELP.trim());
      return;
    }
    if (sub === "status") {
      await daemonStatus();
      return;
    }
    if (sub === "start") {
      await daemonStart();
      return;
    }
    if (sub === "stop") {
      await daemonStop();
      return;
    }
    if (sub === "restart") {
      await daemonRestart();
      return;
    }
    console.log(DAEMON_HELP.trim());
    process.exit(1);
  }
  if (command === "config") {
    const sub = rest[0];
    if (!sub || sub === "--help" || sub === "-h") {
      console.log(CONFIG_HELP.trim());
      return;
    }
    if (sub === "show") {
      await configShow();
      return;
    }
    if (sub === "path") {
      configPath();
      return;
    }
    if (sub === "edit") {
      configEdit();
      return;
    }
    console.log(CONFIG_HELP.trim());
    process.exit(1);
  }

  console.log(MAIN_HELP.trim());
  process.exit(1);
}
