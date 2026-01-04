import { parse } from "@iarna/toml";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigPath(): string {
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

export async function loadConfig(): Promise<Record<string, unknown>> {
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

export async function getPersonality(vaultPath?: string | null): Promise<string | null> {
  const config = await loadConfig();
  const vaults = (config.vaults ?? {}) as Record<string, any>;

  if (vaultPath && vaults[vaultPath]?.personality) {
    return String(vaults[vaultPath].personality);
  }

  if (config.default_personality) {
    return String(config.default_personality);
  }

  return null;
}

export async function getDaemonUrl(): Promise<string | null> {
  const config = await loadConfig();
  const url = config.daemon_url;
  return url ? String(url) : null;
}

export async function isDaemonEnabled(vaultPath?: string | null): Promise<boolean> {
  const config = await loadConfig();
  const vaults = (config.vaults ?? {}) as Record<string, any>;

  if (vaultPath && typeof vaults[vaultPath]?.enable_daemon === "boolean") {
    return vaults[vaultPath].enable_daemon;
  }

  return Boolean(config.enable_daemon);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command) {
    console.error("Usage: config_reader.ts [personality|daemon-url|daemon-enabled] [vault_path]");
    process.exit(1);
  }

  if (command === "personality") {
    const vaultPath = process.argv[3] ?? null;
    const personality = await getPersonality(vaultPath);
    if (personality) {
      console.log(personality);
      process.exit(0);
    }
    process.exit(1);
  }

  if (command === "daemon-url") {
    const url = await getDaemonUrl();
    if (url) {
      console.log(url);
      process.exit(0);
    }
    process.exit(1);
  }

  if (command === "daemon-enabled") {
    const vaultPath = process.argv[3] ?? null;
    const enabled = await isDaemonEnabled(vaultPath);
    console.log(enabled ? "true" : "false");
    process.exit(enabled ? 0 : 1);
  }

  console.error(`Unknown config key: ${command}`);
  process.exit(1);
}

if (import.meta.main) {
  void main();
}
