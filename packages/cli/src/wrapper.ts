import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, getConfigPath, type DereConfig } from "@dere/shared-config";

import { buildMcpConfig } from "./mcp.js";
import { PersonalityLoader } from "./persona.js";

const DEFAULT_DAEMON_URL = process.env.DERE_DAEMON_URL ?? "http://localhost:3000";

function generateSessionId(): number {
  const base = BigInt(Date.now()) * 1_000_000n;
  const mask = (1n << 31n) - 1n;
  return Number(base & mask);
}

type ParsedArgs = {
  personalities: string[];
  outputStyle: string | null;
  continueConv: boolean;
  resume: string | null;
  bare: boolean;
  mode: string | null;
  model: string | null;
  fallbackModel: string | null;
  permissionMode: string | null;
  allowedTools: string | null;
  disallowedTools: string | null;
  addDirs: string[];
  ide: boolean;
  mcpServers: string[];
  dryRun: boolean;
  passthrough: string[];
};

function parseArgs(args: string[]): ParsedArgs {
  const state: ParsedArgs = {
    personalities: [],
    outputStyle: null,
    continueConv: false,
    resume: null,
    bare: false,
    mode: null,
    model: null,
    fallbackModel: null,
    permissionMode: null,
    allowedTools: null,
    disallowedTools: null,
    addDirs: [],
    ide: false,
    mcpServers: [],
    dryRun: false,
    passthrough: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-P" || arg === "--personality") {
      if (args[i + 1]) {
        state.personalities.push(args[i + 1] as string);
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (arg === "--output-style" && args[i + 1]) {
      state.outputStyle = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "-c" || arg === "--continue") {
      state.continueConv = true;
      i += 1;
      continue;
    }
    if ((arg === "-r" || arg === "--resume") && args[i + 1]) {
      state.resume = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--bare") {
      state.bare = true;
      i += 1;
      continue;
    }
    if (arg === "--mode" && args[i + 1]) {
      state.mode = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--model" && args[i + 1]) {
      state.model = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--fallback-model" && args[i + 1]) {
      state.fallbackModel = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--permission-mode" && args[i + 1]) {
      state.permissionMode = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--allowed-tools" && args[i + 1]) {
      state.allowedTools = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--disallowed-tools" && args[i + 1]) {
      state.disallowedTools = args[i + 1] as string;
      i += 2;
      continue;
    }
    if (arg === "--add-dir" && args[i + 1]) {
      state.addDirs.push(args[i + 1] as string);
      i += 2;
      continue;
    }
    if (arg === "--ide") {
      state.ide = true;
      i += 1;
      continue;
    }
    if (arg === "--mcp" && args[i + 1]) {
      state.mcpServers.push(args[i + 1] as string);
      i += 2;
      continue;
    }
    if (arg === "--dry-run") {
      state.dryRun = true;
      i += 1;
      continue;
    }
    if (arg === "--") {
      state.passthrough.push(...args.slice(i + 1));
      break;
    }

    state.passthrough.push(arg);
    i += 1;
  }

  return state;
}

async function isVault(): Promise<boolean> {
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, ".obsidian"))) {
      return true;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return false;
}

async function checkDaemonAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${DEFAULT_DAEMON_URL}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

class SettingsBuilder {
  private readonly personality: string | null;
  private readonly outputStyle: string | null;
  private readonly mode: string | null;
  private readonly sessionId: number | null;
  private readonly companyAnnouncements: string[] | null;
  readonly tempFiles: string[] = [];
  readonly enabledPlugins: string[] = [];

  constructor(args: {
    personality: string | null;
    outputStyle: string | null;
    mode: string | null;
    sessionId: number | null;
    companyAnnouncements: string[] | null;
  }) {
    this.personality = args.personality;
    this.outputStyle = args.outputStyle;
    this.mode = args.mode;
    this.sessionId = args.sessionId;
    this.companyAnnouncements = args.companyAnnouncements;
  }

  async build(): Promise<Record<string, unknown>> {
    const settings: Record<string, any> = { hooks: {}, statusLine: {}, env: {} };

    let outputStyleToUse = this.outputStyle;
    if (!outputStyleToUse) {
      if (await isVault()) {
        outputStyleToUse = "dere-vault:vault";
      }
    }
    if (outputStyleToUse) {
      settings.outputStyle = outputStyleToUse;
    }

    if (this.companyAnnouncements) {
      settings.companyAnnouncements = this.companyAnnouncements;
    }

    await this.addDerePlugins(settings);
    this.addStatusLine(settings);
    this.addHookEnvironment(settings);

    return settings;
  }

  private async shouldEnableVaultPlugin(): Promise<boolean> {
    if (this.mode === "vault") {
      return true;
    }
    return isVault();
  }

  private async shouldEnableProductivityPlugin(config: DereConfig): Promise<boolean> {
    if (this.mode === "productivity" || this.mode === "tasks") {
      return true;
    }
    const mode = config.plugins?.dere_productivity?.mode ?? "never";
    return mode === "always";
  }

  private async shouldEnableGraphFeaturesPlugin(): Promise<boolean> {
    if (this.mode === "code") {
      return false;
    }
    return checkDaemonAvailable();
  }

  private async shouldEnableCodePlugin(config: DereConfig): Promise<boolean> {
    if (this.mode === "code") {
      return true;
    }
    const codeConfig = config.plugins?.dere_code;
    const mode = codeConfig?.mode ?? "auto";
    const directories = (codeConfig?.directories ?? []) as string[];

    if (mode === "always") {
      return true;
    }
    if (mode === "auto") {
      const cwd = resolve(process.cwd());
      for (const directory of directories) {
        const dirPath = resolve(directory.replace(/^~(?=$|\/|\\)/, homedir()));
        if (cwd.startsWith(dirPath)) {
          return true;
        }
      }
    }
    return false;
  }

  private findPluginsPath(): string | null {
    const here = fileURLToPath(import.meta.url);
    const repoCandidate = resolve(dirname(here), "..", "..", "src", "dere_plugins");
    if (existsSync(join(repoCandidate, ".claude-plugin", "marketplace.json"))) {
      return repoCandidate;
    }

    let current = resolve(process.cwd());
    while (true) {
      const candidate = resolve(current, "src", "dere_plugins");
      if (existsSync(join(candidate, ".claude-plugin", "marketplace.json"))) {
        return candidate;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    return null;
  }

  private async addDerePlugins(settings: Record<string, any>): Promise<void> {
    const pluginsPath = this.findPluginsPath();
    if (!pluginsPath) {
      return;
    }

    settings.extraKnownMarketplaces ??= {};
    settings.extraKnownMarketplaces.dere_plugins = {
      source: { source: "directory", path: pluginsPath },
    };

    settings.enabledPlugins ??= {};
    settings.enabledPlugins["dere-core@dere_plugins"] = true;

    const config = await loadConfig();

    const pluginChecks: Array<[string, string | null, () => Promise<boolean>]> = [
      ["dere-vault@dere_plugins", "vault", () => this.shouldEnableVaultPlugin()],
      [
        "dere-productivity@dere_plugins",
        "productivity",
        () => this.shouldEnableProductivityPlugin(config),
      ],
      ["dere-graph-features@dere_plugins", null, () => this.shouldEnableGraphFeaturesPlugin()],
      ["dere-code@dere_plugins", "code", () => this.shouldEnableCodePlugin(config)],
    ];

    for (const [pluginName, modeName, checkFn] of pluginChecks) {
      try {
        if (await checkFn()) {
          settings.enabledPlugins[pluginName] = true;
          if (modeName) {
            this.enabledPlugins.push(modeName);
          }
        }
      } catch {
        // ignore plugin enable failures
      }
    }
  }

  private addStatusLine(settings: Record<string, any>): void {
    const pluginsPath = this.findPluginsPath();
    if (!pluginsPath) {
      return;
    }
    const statusline = resolve(pluginsPath, "dere_core", "scripts", "dere-statusline.ts");
    if (existsSync(statusline)) {
      settings.statusLine = {
        type: "command",
        command: `bun ${statusline}`,
        padding: 0,
      };
    }
  }

  private addHookEnvironment(settings: Record<string, any>): void {
    const env = settings.env ?? {};

    const pluginsPath = this.findPluginsPath();
    if (pluginsPath) {
      const siteRoot = dirname(pluginsPath);
      const existingPythonPath = process.env.PYTHONPATH ?? "";
      const pythonParts = [pluginsPath, siteRoot];
      if (existingPythonPath) {
        pythonParts.push(existingPythonPath);
      }
      const pythonpathValue = pythonParts.join(delimiter);
      env.PYTHONPATH = pythonpathValue;
      env.DERE_PYTHONPATH = pythonpathValue;
    }

    const pythonBin =
      process.env.DERE_PYTHON_BIN ?? process.env.UV_PYTHON ?? process.env.PYTHON ?? "";
    if (pythonBin) {
      const pythonDir = dirname(pythonBin);
      const existingPath = process.env.PATH ?? "";
      env.PATH = existingPath ? `${pythonDir}${delimiter}${existingPath}` : pythonDir;
    }

    if (this.personality) {
      env.DERE_PERSONALITY = this.personality;
    }
    env.DERE_DAEMON_URL = DEFAULT_DAEMON_URL;
    if (this.mode === "productivity" || this.mode === "tasks") {
      env.DERE_PRODUCTIVITY = "true";
    }
    if (this.enabledPlugins.length > 0) {
      env.DERE_ENABLED_PLUGINS = this.enabledPlugins.join("/");
    }
    if (this.sessionId) {
      env.DERE_SESSION_ID = String(this.sessionId);
    }

    if (
      this.mode === "productivity" ||
      this.mode === "tasks" ||
      this.enabledPlugins.includes("productivity")
    ) {
      if (!env.GOOGLE_OAUTH_CREDENTIALS) {
        const envCreds = process.env.GOOGLE_OAUTH_CREDENTIALS;
        if (envCreds) {
          env.GOOGLE_OAUTH_CREDENTIALS = envCreds;
        } else {
          const home = homedir();
          const candidates = [
            join(home, ".config", "google-calendar-mcp", "gcp-oauth.keys.json"),
            join(home, ".config", "google-calendar-mcp", "credentials.json"),
            join(home, ".config", "google-calendar-mcp", "google-calendar-credentials.json"),
            join(home, ".config", "dere", "gcp-oauth.keys.json"),
            join(home, ".config", "dere", "google-calendar-credentials.json"),
          ];
          for (const candidate of candidates) {
            if (existsSync(candidate)) {
              env.GOOGLE_OAUTH_CREDENTIALS = candidate;
              break;
            }
          }
        }
      }
    }

    settings.env = env;
  }
}

async function composeSystemPrompt(personalities: string[]): Promise<string> {
  if (personalities.length === 0) {
    return "";
  }
  const loader = new PersonalityLoader();
  const prompts: string[] = [];
  for (const personality of personalities) {
    try {
      const pers = await loader.load(personality);
      prompts.push(pers.prompt_content);
    } catch (error) {
      console.warn(`Warning: ${String(error)}`);
    }
  }
  return prompts.join("\n\n");
}

async function writeTempJson(data: Record<string, unknown>): Promise<string> {
  const filePath = join(
    tmpdir(),
    `dere-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export async function runClaude(rawArgs: string[]): Promise<void> {
  const parsed = parseArgs(rawArgs);

  const sessionId = generateSessionId();
  process.env.DERE_SESSION_ID = String(sessionId);
  if (parsed.mcpServers.length > 0) {
    process.env.DERE_MCP_SERVERS = parsed.mcpServers.join(",");
  }
  if (parsed.outputStyle) {
    process.env.DERE_OUTPUT_STYLE = parsed.outputStyle;
  }
  if (parsed.mode) {
    process.env.DERE_MODE = parsed.mode;
  }
  process.env.DERE_SESSION_TYPE = parsed.continueConv
    ? "continue"
    : parsed.resume
      ? "resume"
      : "new";

  if (!parsed.bare && parsed.personalities.length === 0) {
    parsed.personalities.push("tsun");
  }

  let announcement: string | null = null;
  if (parsed.personalities.length > 0) {
    const loader = new PersonalityLoader();
    const config = await loadConfig();
    try {
      const first = await loader.load(parsed.personalities[0]!);
      process.env.DERE_PERSONALITY_COLOR = first.color;
      process.env.DERE_PERSONALITY_ICON = first.icon;
      announcement = first.announcement ?? null;
    } catch {
      // ignore
    }
    if (!announcement) {
      const messages = config.announcements?.messages;
      if (Array.isArray(messages)) {
        announcement = messages[0] ?? null;
      } else if (typeof messages === "string") {
        announcement = messages;
      }
    }
  }

  const personalityStr = parsed.personalities.length > 0 ? parsed.personalities.join(",") : null;
  const effectiveOutputStyle = parsed.outputStyle ?? parsed.mode ?? null;
  const builder = new SettingsBuilder({
    personality: personalityStr,
    outputStyle: effectiveOutputStyle,
    mode: parsed.mode,
    sessionId,
    companyAnnouncements: announcement ? [announcement] : null,
  });

  const settings = await builder.build();
  let settingsPath: string | null = null;
  if (Object.keys(settings).length > 0) {
    settingsPath = await writeTempJson(settings);
    builder.tempFiles.push(settingsPath);
  }

  try {
    let systemPrompt = "";
    if (!parsed.bare && parsed.personalities.length > 0) {
      systemPrompt = await composeSystemPrompt(parsed.personalities);
    }

    const cmd = ["claude"];
    if (parsed.continueConv) {
      cmd.push("--continue");
    } else if (parsed.resume) {
      cmd.push("-r", parsed.resume);
    }
    if (parsed.model) {
      cmd.push("--model", parsed.model);
    }
    if (parsed.fallbackModel) {
      cmd.push("--fallback-model", parsed.fallbackModel);
    }
    if (parsed.permissionMode) {
      cmd.push("--permission-mode", parsed.permissionMode);
    }
    if (parsed.allowedTools) {
      cmd.push("--allowed-tools", parsed.allowedTools);
    }
    if (parsed.disallowedTools) {
      cmd.push("--disallowed-tools", parsed.disallowedTools);
    }
    for (const dir of parsed.addDirs) {
      cmd.push("--add-dir", dir);
    }
    if (parsed.ide) {
      cmd.push("--ide");
    }
    if (settingsPath) {
      cmd.push("--settings", settingsPath);
    }
    if (systemPrompt) {
      cmd.push("--append-system-prompt", systemPrompt);
    }

    if (parsed.mcpServers.length > 0) {
      try {
        const configDir = dirname(getConfigPath());
        const mcpConfigPath = await buildMcpConfig(parsed.mcpServers, configDir);
        if (mcpConfigPath) {
          cmd.push("--mcp-config", mcpConfigPath);
          builder.tempFiles.push(mcpConfigPath);
        }
      } catch (error) {
        console.error(`Error: ${String(error)}`);
        process.exit(1);
      }
    }

    if (parsed.passthrough.length > 0) {
      cmd.push(...parsed.passthrough);
    }

    if (parsed.dryRun) {
      console.log("Command:", cmd.join(" "));
      console.log("\nEnvironment:");
      for (const key of Object.keys(process.env).sort()) {
        if (key.startsWith("DERE_")) {
          console.log(`  ${key}=${process.env[key]}`);
        }
      }
      if (settingsPath) {
        console.log(`\nSettings: ${settingsPath}`);
        console.log(await readFile(settingsPath, "utf-8"));
      }
      return;
    }

    const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" });

    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);

    const exitCode: number = await new Promise((resolve) => {
      child.on("close", (code) => resolve(code ?? 0));
    });

    process.exit(exitCode);
  } catch (error) {
    if (String(error).includes("ENOENT")) {
      console.error("Error: 'claude' not found. Install Claude CLI.");
    } else {
      console.error(String(error));
    }
    process.exit(1);
  } finally {
    for (const file of builder.tempFiles) {
      try {
        await unlink(file);
      } catch {
        // ignore
      }
    }
  }
}
