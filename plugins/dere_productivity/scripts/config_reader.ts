import { parse } from "@iarna/toml";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEFAULT_DAEMON_URL } from "@dere/shared-runtime";

function getConfigPath(): string {
  const locations = [
    join(homedir(), ".config", "dere", "config.toml"),
    join(homedir(), ".dere", "config.toml"),
  ];
  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }
  return locations[0];
}

async function loadConfig(): Promise<Record<string, unknown>> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const raw = await readFile(configPath, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export async function getDaemonUrl(): Promise<string> {
  const config = await loadConfig();
  const daemonConfig = (config.daemon ?? {}) as Record<string, unknown>;
  return (daemonConfig.url as string) ?? DEFAULT_DAEMON_URL;
}

async function main(): Promise<void> {
  const url = await getDaemonUrl();
  console.log(url);
}

if (import.meta.main) {
  void main();
}
