import { readFileSync } from "node:fs";
import { join } from "node:path";

const RESET = "\u001b[0m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[93m";
const BLUE = "\u001b[34m";
const MAGENTA = "\u001b[35m";
const CYAN = "\u001b[36m";
const GRAY = "\u001b[90m";
const WHITE = "\u001b[97m";

type SessionPayload = {
  model?: { id?: string };
  cwd?: string;
};

function hexToAnsi(hexColor: string): string {
  const value = hexColor.replace("#", "");
  if (value.length !== 6) {
    return GRAY;
  }
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return GRAY;
  }
  return `\u001b[38;2;${r};${g};${b}m`;
}

function formatPersonality(personality: string): string {
  const colorValue = process.env.DERE_PERSONALITY_COLOR ?? "";
  const icon = process.env.DERE_PERSONALITY_ICON ?? "●";

  const colorCode = colorValue.startsWith("#")
    ? hexToAnsi(colorValue)
    : ({
        red: RED,
        blue: BLUE,
        magenta: MAGENTA,
        green: GREEN,
        yellow: YELLOW,
        cyan: CYAN,
        gray: GRAY,
        white: WHITE,
      }[colorValue.toLowerCase()] ?? GRAY);

  return `${colorCode}${icon}${RESET} ${personality}`;
}

function formatModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) {
    return `${YELLOW}◆${RESET} opus`;
  }
  if (lower.includes("sonnet")) {
    return `${BLUE}◇${RESET} sonnet`;
  }
  if (lower.includes("haiku")) {
    return `${GRAY}◦${RESET} haiku`;
  }
  const parts = model.split("-");
  if (parts.length > 0) {
    return `${GRAY}◈${RESET} ${parts[0]}`;
  }
  return `${GRAY}◈${RESET} model`;
}

function formatMcpServers(servers: string): string {
  if (!servers) {
    return "";
  }
  const serverList = servers
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (serverList.length === 0) {
    return "";
  }
  if (serverList.length === 1) {
    return `${CYAN}▪${RESET} ${serverList[0]}`;
  }
  return `${CYAN}▪${RESET} ${serverList.length}`;
}

function formatSessionType(sessionType: string): string {
  if (sessionType === "continue") {
    return `${GREEN}↻${RESET} cont`;
  }
  if (sessionType === "resume") {
    return `${YELLOW}↵${RESET} resume`;
  }
  return `${GRAY}●${RESET} ${sessionType}`;
}

function formatModes(modesStr: string): string {
  if (!modesStr) {
    return "";
  }
  const modeNames = modesStr
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);
  if (modeNames.length === 0) {
    return "";
  }
  const firstMode = modeNames[0];
  const icon =
    firstMode === "productivity"
      ? `${CYAN}◆${RESET}`
      : firstMode === "code"
        ? `${MAGENTA}◆${RESET}`
        : firstMode === "vault"
          ? `${GREEN}◆${RESET}`
          : `${GRAY}◆${RESET}`;
  return `${icon} ${modesStr}`;
}

function formatPermissionMode(mode: string): string {
  if (mode === "bypass") {
    return `${RED}⚡${RESET}`;
  }
  return "";
}

function checkDaemonStatus(): boolean {
  try {
    const home = process.env.HOME ?? "";
    const pidFile = join(home, ".local", "share", "dere", "daemon.pid");
    const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (!Number.isFinite(pid)) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function formatDaemonStatus(isRunning: boolean): string {
  return isRunning ? `${GREEN}●${RESET}` : `${RED}●${RESET}`;
}

function shortenPath(path: string): string {
  const home = process.env.HOME ?? "";
  let value = path;
  if (home && value.startsWith(home)) {
    value = `~${value.slice(home.length)}`;
  }
  if (value.length > 25) {
    const parts = value.split("/");
    if (parts.length > 3) {
      return `${parts[0]}/.../${parts[parts.length - 1]}`;
    }
  }
  return value;
}

function showDereStatusOnly(): void {
  const parts: string[] = [];
  const daemonRunning = checkDaemonStatus();
  parts.push(formatDaemonStatus(daemonRunning));

  const personality = process.env.DERE_PERSONALITY ?? "";
  if (personality && personality !== "bare") {
    parts.push(formatPersonality(personality));
  } else {
    parts.push(`${GRAY}dere${RESET}`);
  }

  process.stdout.write(parts.join(`${GRAY} │ ${RESET}`));
}

async function main(): Promise<void> {
  let session: SessionPayload | null = null;
  try {
    const stdin = await Bun.stdin.text();
    session = JSON.parse(stdin) as SessionPayload;
  } catch {
    showDereStatusOnly();
    return;
  }

  const personality = process.env.DERE_PERSONALITY ?? "";
  const mcpServers = process.env.DERE_MCP_SERVERS ?? "";
  const enabledPlugins = process.env.DERE_ENABLED_PLUGINS ?? "";
  const outputStyle = process.env.DERE_OUTPUT_STYLE ?? "";
  const customPrompts = process.env.DERE_CUSTOM_PROMPTS ?? "";
  const sessionType = process.env.DERE_SESSION_TYPE ?? "";
  const permissionMode = process.env.DERE_PERMISSION_MODE ?? "";

  const parts: string[] = [];

  const daemonRunning = checkDaemonStatus();
  parts.push(formatDaemonStatus(daemonRunning));

  if (personality && personality !== "bare") {
    parts.push(formatPersonality(personality));
  }

  const modelId = session?.model?.id ?? "";
  if (modelId) {
    parts.push(formatModel(modelId));
  }

  if (mcpServers) {
    const formatted = formatMcpServers(mcpServers);
    if (formatted) {
      parts.push(formatted);
    }
  }

  if (enabledPlugins) {
    const formatted = formatModes(enabledPlugins);
    if (formatted) {
      parts.push(formatted);
    }
  }

  if (sessionType && sessionType !== "new") {
    parts.push(formatSessionType(sessionType));
  }

  if (customPrompts) {
    parts.push(`${GRAY}□${RESET} ${customPrompts}`);
  }

  if (outputStyle && outputStyle !== "default") {
    parts.push(`${GRAY}◈${RESET} ${outputStyle}`);
  }

  if (session?.cwd) {
    parts.push(`${GRAY}▸${RESET} ${shortenPath(session.cwd)}`);
  }

  // Show bypass mode indicator at the end
  if (permissionMode) {
    const formatted = formatPermissionMode(permissionMode);
    if (formatted) {
      parts.push(formatted);
    }
  }

  if (parts.length > 0) {
    process.stdout.write(parts.join(`${GRAY} │ ${RESET}`));
  }
}

if (import.meta.main) {
  void main();
}
