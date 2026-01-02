import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type McpConfig = {
  mcpServers?: Record<
    string,
    { command?: string; args?: string[]; env?: Record<string, string>; tags?: string[] }
  >;
  profiles?: Record<string, { servers?: string[] }>;
};

function ensureConfigShape(config: McpConfig): Required<McpConfig> {
  return {
    mcpServers: config.mcpServers ?? {},
    profiles: config.profiles ?? {},
  };
}

export async function loadDereMcpConfig(configDir: string): Promise<Required<McpConfig>> {
  const configPath = join(configDir, "mcp_config.json");
  try {
    const text = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(text) as McpConfig;
    return ensureConfigShape(parsed);
  } catch {
    return ensureConfigShape({});
  }
}

export function resolveMcpServers(
  serverSpecs: string[],
  dereConfig: Required<McpConfig>,
): string[] {
  if (serverSpecs.length === 0) {
    return [];
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  const servers = dereConfig.mcpServers ?? {};
  const profiles = dereConfig.profiles ?? {};

  for (const spec of serverSpecs) {
    if (spec in profiles) {
      for (const name of profiles[spec]?.servers ?? []) {
        if (!seen.has(name)) {
          resolved.push(name);
          seen.add(name);
        }
      }
      continue;
    }

    if (spec in servers) {
      if (!seen.has(spec)) {
        resolved.push(spec);
        seen.add(spec);
      }
      continue;
    }

    if (spec.includes("*")) {
      const pattern = spec.replaceAll("*", "");
      for (const name of Object.keys(servers)) {
        if (name.includes(pattern) && !seen.has(name)) {
          resolved.push(name);
          seen.add(name);
        }
      }
      continue;
    }

    if (spec.startsWith("tag:")) {
      const tag = spec.slice(4);
      for (const [name, serverConfig] of Object.entries(servers)) {
        const tags = serverConfig?.tags ?? [];
        if (tags.includes(tag) && !seen.has(name)) {
          resolved.push(name);
          seen.add(name);
        }
      }
      continue;
    }

    throw new Error(`MCP server, profile, or pattern '${spec}' not found`);
  }

  return resolved;
}

export async function buildMcpConfig(
  serverSpecs: string[],
  configDir: string,
): Promise<string | null> {
  if (serverSpecs.length === 0) {
    return null;
  }

  const dereConfig = await loadDereMcpConfig(configDir);
  const serverNames = resolveMcpServers(serverSpecs, dereConfig);
  if (serverNames.length === 0) {
    return null;
  }

  const filtered: Required<McpConfig> = { mcpServers: {}, profiles: {} };
  for (const name of serverNames) {
    const serverConfig = dereConfig.mcpServers[name];
    if (!serverConfig) {
      throw new Error(`MCP server '${name}' not found in dere config`);
    }
    filtered.mcpServers[name] = {
      command: serverConfig.command,
      args: serverConfig.args ?? [],
    };
    if (serverConfig.env) {
      filtered.mcpServers[name].env = serverConfig.env;
    }
  }

  const filePath = join(
    tmpdir(),
    `dere-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  await writeFile(filePath, JSON.stringify(filtered, null, 2), "utf-8");
  return filePath;
}
