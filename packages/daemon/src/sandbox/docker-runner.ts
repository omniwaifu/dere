import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";

import { getDaemonUrlFromConfig, loadConfig } from "@dere/shared-config";

type JsonRecord = Record<string, unknown>;

export type SandboxMountType = "direct" | "copy" | "none";
export type SandboxNetworkMode = "bridge" | "host";

export type SandboxEvent = {
  type: string;
  data?: JsonRecord;
};

export type DockerSandboxConfig = {
  workingDir: string;
  outputStyle?: string;
  systemPrompt?: string | null;
  model?: string | null;
  thinkingBudget?: number | null;
  allowedTools?: string[] | null;
  resumeSessionId?: string | null;
  autoApprove?: boolean;
  outputFormat?: JsonRecord | null;
  sandboxSettings?: JsonRecord | null;
  plugins?: string[] | null;
  env?: Record<string, string> | null;
  sandboxNetworkMode?: SandboxNetworkMode | null;
  mountType?: SandboxMountType | null;
  image?: string;
  memoryLimit?: string;
  cpuLimit?: number;
};

class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private queue: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  close(): void {
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      if (resolver) {
        resolver({ value: undefined as T, done: true });
      }
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      const value = this.queue.shift() as T;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as T, done: true });
    }
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

function getDaemonSocketPath(): string {
  const xdgRuntime = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntime) {
    return `${xdgRuntime}/dere/daemon.sock`;
  }
  return "/run/dere/daemon.sock";
}

function rewriteDaemonHostForDocker(url: string): string {
  try {
    const parsed = new URL(url);
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      parsed.hostname = "host.docker.internal";
      return parsed.toString();
    }
  } catch {
    // ignore malformed URLs
  }
  return url;
}

async function resolveDaemonUrlForSandbox(
  networkMode: SandboxNetworkMode,
  daemonSocketPath: string,
): Promise<string> {
  if (existsSync(daemonSocketPath)) {
    return "http+unix:///run/dere/daemon.sock";
  }

  const config = await loadConfig();
  const daemonUrl = getDaemonUrlFromConfig(config);
  if (networkMode === "bridge") {
    return rewriteDaemonHostForDocker(daemonUrl);
  }
  return daemonUrl;
}

function normalizeMountType(value: string | null | undefined): SandboxMountType {
  if (value === "direct" || value === "copy" || value === "none") {
    return value;
  }
  return "copy";
}

function normalizeNetworkMode(value: string | null | undefined): SandboxNetworkMode {
  return value === "host" ? "host" : "bridge";
}

function serializeEnv(value: JsonRecord | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "../../../..");
}

export class DockerSandboxRunner {
  private config: DockerSandboxConfig;
  private process: ChildProcessWithoutNullStreams | null = null;
  private queue = new AsyncQueue<SandboxEvent>();
  private tempDir: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  claudeSessionId: string | null = null;

  constructor(config: DockerSandboxConfig) {
    this.config = {
      memoryLimit: config.memoryLimit ?? "2g",
      cpuLimit: config.cpuLimit ?? 2.0,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const mountType = normalizeMountType(this.config.mountType ?? null);
    const networkMode = normalizeNetworkMode(this.config.sandboxNetworkMode ?? null);
    const workingDir = "/workspace";
    const binds: string[] = [];

    if (mountType !== "none" && this.config.workingDir) {
      const sourceDir = resolve(this.config.workingDir);
      if (existsSync(sourceDir)) {
        if (mountType === "direct") {
          binds.push(`${sourceDir}:${workingDir}:rw`);
        } else if (mountType === "copy") {
          this.tempDir = await mkdtemp(join(tmpdir(), "dere-sandbox-"));
          const target = join(this.tempDir, "workspace");
          await cp(sourceDir, target, { recursive: true });
          binds.push(`${target}:${workingDir}:rw`);
        }
      }
    }

    const bindPlugins = ["1", "true", "yes", "on"].includes(
      (process.env.DERE_SANDBOX_BIND_PLUGINS ?? "").toLowerCase(),
    );
    if (bindPlugins) {
      const repoRoot = resolveRepoRoot();
      const pluginsDir = resolve(repoRoot, "plugins");
      if (existsSync(pluginsDir)) {
        binds.push(`${pluginsDir}:/app/dere/plugins:ro`);
      }
    }

    const claudeDir = join(homedir(), ".claude");
    if (existsSync(claudeDir)) {
      binds.push(`${claudeDir}:/home/user/.claude:rw`);
    }

    const daemonSocketPath = getDaemonSocketPath();
    const daemonSocketDir = resolve(daemonSocketPath, "..");
    if (existsSync(daemonSocketPath)) {
      binds.push(`${daemonSocketDir}:/run/dere:ro`);
    }

    const env: string[] = [
      "HOME=/home/user",
      `SANDBOX_WORKING_DIR=${workingDir}`,
      `SANDBOX_OUTPUT_STYLE=${this.config.outputStyle ?? "default"}`,
    ];

    if (this.config.systemPrompt) {
      env.push(`SANDBOX_SYSTEM_PROMPT=${this.config.systemPrompt}`);
    }
    if (this.config.model) {
      env.push(`SANDBOX_MODEL=${this.config.model}`);
    }
    if (typeof this.config.thinkingBudget === "number") {
      env.push(`SANDBOX_THINKING_BUDGET=${this.config.thinkingBudget}`);
    }
    if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      env.push(`SANDBOX_ALLOWED_TOOLS=${this.config.allowedTools.join(",")}`);
    }
    if (this.config.resumeSessionId) {
      env.push(`SANDBOX_RESUME_SESSION_ID=${this.config.resumeSessionId}`);
    }
    if (this.config.autoApprove) {
      env.push("SANDBOX_AUTO_APPROVE=1");
    }
    const outputFormat = serializeEnv(this.config.outputFormat);
    if (outputFormat) {
      env.push(`SANDBOX_OUTPUT_FORMAT_JSON=${outputFormat}`);
    }
    const sandboxSettings = serializeEnv(this.config.sandboxSettings);
    if (sandboxSettings) {
      env.push(`SANDBOX_SETTINGS_JSON=${sandboxSettings}`);
    }
    if (this.config.plugins !== null && this.config.plugins !== undefined) {
      env.push(`SANDBOX_PLUGINS=${this.config.plugins.join(",")}`);
    }
    if (this.config.env) {
      for (const [key, value] of Object.entries(this.config.env)) {
        env.push(`${key}=${value}`);
      }
    }

    if (!env.some((value) => value.startsWith("DERE_DAEMON_URL="))) {
      const daemonUrl = await resolveDaemonUrlForSandbox(networkMode, daemonSocketPath);
      env.push(`DERE_DAEMON_URL=${daemonUrl}`);
    }

    const args: string[] = ["run", "--rm", "-i", "--workdir", workingDir];
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const gid = typeof process.getgid === "function" ? process.getgid() : null;
    if (uid !== null && gid !== null) {
      args.push("--user", `${uid}:${gid}`);
    }
    if (networkMode) {
      args.push("--network", networkMode);
    }
    if (networkMode === "bridge") {
      args.push("--add-host", "host.docker.internal:host-gateway");
    }
    if (this.config.memoryLimit) {
      args.push("--memory", this.config.memoryLimit);
    }
    if (this.config.cpuLimit) {
      args.push("--cpus", String(this.config.cpuLimit));
    }
    for (const bind of binds) {
      args.push("-v", bind);
    }
    for (const entry of env) {
      args.push("-e", entry);
    }
    args.push(this.config.image ?? "dere-sandbox:latest");

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;

    child.once("error", (error) => {
      if (this.readyReject) {
        this.readyReject(error);
      }
      this.queue.push({ type: "error", data: { message: error.message, recoverable: false } });
      this.queue.close();
    });

    child.once("close", (code) => {
      if (this.readyReject && this.readyPromise) {
        this.readyReject(new Error(`sandbox container exited (${code ?? "unknown"})`));
      }
      this.queue.push({
        type: "error",
        data: {
          message: `sandbox container exited (${code ?? "unknown"})`,
          recoverable: false,
        },
      });
      this.queue.close();
    });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        const event = JSON.parse(trimmed) as SandboxEvent;
        if (event.type === "ready") {
          if (this.readyResolve) {
            this.readyResolve();
          }
          return;
        }
        if (event.type === "session_id") {
          const sessionId = event.data?.session_id;
          if (typeof sessionId === "string" && sessionId) {
            this.claudeSessionId = sessionId;
          }
        }
        this.queue.push(event);
      } catch {
        // ignore malformed lines
      }
    });

    await this.waitForReady(30_000);
  }

  async query(prompt: string): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error("Sandbox process not running");
    }
    const payload = JSON.stringify({ type: "query", prompt }) + "\n";
    this.process.stdin.write(payload);
  }

  async *receiveResponse(): AsyncIterable<SandboxEvent> {
    for await (const event of this.queue) {
      yield event;
      if (event.type === "done" || event.type === "error") {
        break;
      }
    }
  }

  async close(): Promise<void> {
    if (this.process && this.process.stdin) {
      try {
        this.process.stdin.write(JSON.stringify({ type: "close" }) + "\n");
      } catch {
        // ignore
      }
      try {
        this.process.stdin.end();
      } catch {
        // ignore
      }
    }

    if (this.process && !this.process.killed) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // ignore
      }
    }

    this.queue.close();
    this.process = null;

    if (this.tempDir) {
      try {
        await rm(this.tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this.tempDir = null;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    if (!this.readyPromise) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const timer = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("sandbox ready timeout")), timeoutMs);
      });
      await Promise.race([this.readyPromise, timer]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

export async function runDockerSandboxQuery(args: {
  prompt: string;
  config: DockerSandboxConfig;
}): Promise<{
  outputText: string;
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }>;
  toolNames: string[];
  toolCount: number;
  structuredOutput?: unknown;
}> {
  const runner = new DockerSandboxRunner(args.config);
  const blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }> = [];
  const toolNames = new Set<string>();
  let toolCount = 0;
  let structuredOutput: unknown;
  let responseText = "";

  const appendText = (text: string) => {
    if (!text) {
      return;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.type === "text") {
      last.text = `${last.text ?? ""}${text}`;
    } else {
      blocks.push({ type: "text", text });
    }
  };

  try {
    await runner.start();
    await runner.query(args.prompt);
    for await (const event of runner.receiveResponse()) {
      if (event.type === "text") {
        const text = typeof event.data?.text === "string" ? event.data.text : "";
        appendText(text);
        responseText += text;
        continue;
      }
      if (event.type === "tool_use") {
        const name = typeof event.data?.name === "string" ? event.data.name : undefined;
        const id = typeof event.data?.id === "string" ? event.data.id : undefined;
        const input =
          event.data?.input &&
          typeof event.data.input === "object" &&
          !Array.isArray(event.data.input)
            ? (event.data.input as Record<string, unknown>)
            : undefined;
        const toolUseBlock: {
          type: "tool_use";
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        } = { type: "tool_use" };
        if (id) {
          toolUseBlock.id = id;
        }
        if (name) {
          toolUseBlock.name = name;
        }
        if (input) {
          toolUseBlock.input = input;
        }
        blocks.push(toolUseBlock);
        if (name) {
          toolNames.add(name);
        }
        toolCount += 1;
        continue;
      }
      if (event.type === "tool_result") {
        const name = typeof event.data?.name === "string" ? event.data.name : undefined;
        const toolUseId =
          typeof event.data?.tool_use_id === "string" ? event.data.tool_use_id : undefined;
        const output = typeof event.data?.output === "string" ? event.data.output : "";
        const toolResultBlock: {
          type: "tool_result";
          tool_use_id?: string;
          name?: string;
          output?: string;
          is_error?: boolean;
        } = { type: "tool_result" };
        if (toolUseId) {
          toolResultBlock.tool_use_id = toolUseId;
        }
        if (name) {
          toolResultBlock.name = name;
        }
        toolResultBlock.output = output;
        toolResultBlock.is_error = Boolean(event.data?.is_error);
        blocks.push(toolResultBlock);
        if (name) {
          toolNames.add(name);
        }
        continue;
      }
      if (event.type === "done") {
        if (typeof event.data?.response_text === "string" && event.data.response_text) {
          responseText = event.data.response_text;
        }
        if (event.data?.structured_output !== undefined) {
          structuredOutput = event.data.structured_output;
        }
        break;
      }
      if (event.type === "error") {
        const message =
          typeof event.data?.message === "string" ? event.data.message : "Sandbox error";
        throw new Error(message);
      }
    }
  } finally {
    await runner.close();
  }

  return {
    outputText: responseText,
    blocks,
    toolNames: Array.from(toolNames),
    toolCount,
    structuredOutput,
  };
}
