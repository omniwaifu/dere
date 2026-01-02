import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function findMcpConfig(): string | null {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const locations = [
    join(homedir(), ".config", "mcp", "config.json"),
    join(homedir(), ".mcp", "config.json"),
    join(homedir(), "Library", "Application Support", "mcp", "config.json"),
    join(xdgConfig, "mcp", "config.json"),
  ];

  for (const location of locations) {
    if (existsSync(location)) {
      return location;
    }
  }

  return null;
}

async function checkTaskwarriorInConfig(configPath: string): Promise<boolean> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, any>;
    const servers = (config.mcpServers ?? {}) as Record<string, any>;
    for (const [name, serverConfig] of Object.entries(servers)) {
      const command = String(serverConfig?.command ?? "");
      const args = Array.isArray(serverConfig?.args) ? serverConfig.args : [];
      if (name.toLowerCase().includes("taskwarrior")) {
        return true;
      }
      if (command.toLowerCase().includes("taskwarrior")) {
        return true;
      }
      if (args.some((arg: unknown) => String(arg).toLowerCase().includes("taskwarrior"))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function checkTaskwarriorCommand(): boolean {
  return Boolean(Bun.which("task"));
}

export async function isTaskwarriorMcpAvailable(): Promise<boolean> {
  if (!checkTaskwarriorCommand()) {
    return false;
  }

  const configPath = findMcpConfig();
  if (!configPath) {
    return true;
  }

  return await checkTaskwarriorInConfig(configPath);
}

async function main(): Promise<void> {
  if (await isTaskwarriorMcpAvailable()) {
    console.log("Taskwarrior MCP available");
    process.exit(0);
  } else {
    console.log("Taskwarrior MCP not available");
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
