#!/usr/bin/env bun
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

type ResponseState = {
  responseChunks: string[];
  toolCount: number;
  toolIdToName: Map<string, string>;
  structuredOutput: unknown | null;
  usedStreaming: boolean;
  queryIterator: ReturnType<typeof query> | null;
};

function emit(eventType: string, data?: JsonRecord): void {
  const payload: JsonRecord = { type: eventType };
  if (data) {
    payload.data = data;
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitError(message: string, recoverable = true): void {
  emit("error", { message, recoverable });
}

function debug(_message: string): void {
  // Uncomment for debugging:
  // process.stderr.write(`[DEBUG] ${new Date().toISOString()} ${_message}\n`);
}

type QueryOptions = Parameters<typeof query>[0]["options"];

class SandboxRunner {
  private settingsPath: string | null = null;
  private queryOptions: QueryOptions | null = null;
  private pendingState: ResponseState | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const workingDir = process.env.SANDBOX_WORKING_DIR ?? "/workspace";
    const outputStyle = process.env.SANDBOX_OUTPUT_STYLE ?? "default";
    const systemPrompt = process.env.SANDBOX_SYSTEM_PROMPT ?? "";
    const model = process.env.SANDBOX_MODEL || undefined;
    const thinkingBudget = process.env.SANDBOX_THINKING_BUDGET
      ? Number.parseInt(process.env.SANDBOX_THINKING_BUDGET, 10)
      : undefined;

    const allowedTools = parseListEnv(process.env.SANDBOX_ALLOWED_TOOLS, [
      "Read",
      "Write",
      "Bash",
      "Edit",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
    ]);

    const resumeSessionId = process.env.SANDBOX_RESUME_SESSION_ID || undefined;
    const autoApprove = process.env.SANDBOX_AUTO_APPROVE === "1";

    const outputFormat = parseJsonEnv(process.env.SANDBOX_OUTPUT_FORMAT_JSON);
    let sandboxSettings = parseJsonEnv(process.env.SANDBOX_SETTINGS_JSON);
    if (!sandboxSettings || typeof sandboxSettings !== "object") {
      // We're already running inside a sandbox container, so disable nested sandbox
      sandboxSettings = {
        enabled: false,
      };
    }

    this.settingsPath = await writeSettingsFile({ outputStyle });

    const plugins = resolvePlugins(process.env.SANDBOX_PLUGINS);

    // Store options for later query calls (each query creates a new SDK instance)
    this.queryOptions = {
      cwd: workingDir,
      settingSources: ["user", "project", "local"] as const,
      allowedTools,
      permissionMode: autoApprove ? "bypassPermissions" : "acceptEdits",
      allowDangerouslySkipPermissions: autoApprove,
      plugins: plugins.length > 0 ? plugins : undefined,
      model,
      includePartialMessages: true,
      maxThinkingTokens: Number.isFinite(thinkingBudget ?? NaN) ? thinkingBudget : undefined,
      resume: resumeSessionId,
      forkSession: Boolean(resumeSessionId),
      sandbox: sandboxSettings,
      outputFormat: outputFormat ?? undefined,
      extraArgs: this.settingsPath ? { settings: this.settingsPath } : undefined,
      systemPrompt: systemPrompt
        ? ({
            type: "preset",
            preset: outputStyle,
            append: systemPrompt,
          } as unknown)
        : undefined,
    };

    debug("Initialized sandbox runner options");
    this.initialized = true;
    emit("ready");
  }

  async processQuery(prompt: string): Promise<void> {
    if (!this.queryOptions) {
      emitError("Client not initialized", false);
      return;
    }
    if (!prompt.trim()) {
      return;
    }

    debug(`Processing query: ${prompt.substring(0, 50)}...`);

    const state: ResponseState = {
      responseChunks: [],
      toolCount: 0,
      toolIdToName: new Map(),
      structuredOutput: null,
      usedStreaming: false,
      queryIterator: null,
    };
    this.pendingState = state;

    // Create a new query instance for this prompt
    const queryIterator = query({ prompt, options: this.queryOptions });
    state.queryIterator = queryIterator;

    try {
      for await (const message of queryIterator) {
        this.handleMessage(message);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      debug(`Query error: ${errorMsg}`);
      emitError(errorMsg, false);
    }
  }

  async close(): Promise<void> {
    if (this.pendingState?.queryIterator?.return) {
      await this.pendingState.queryIterator.return();
    }
    if (this.settingsPath) {
      try {
        await unlink(this.settingsPath);
      } catch {
        // ignore
      }
      this.settingsPath = null;
    }
  }

  private finishState(state: ResponseState): void {
    const responseText = state.responseChunks.join("");
    const payload: JsonRecord = { response_text: responseText, tool_count: state.toolCount };
    if (state.structuredOutput !== null) {
      try {
        JSON.stringify(state.structuredOutput);
        payload.structured_output = state.structuredOutput as JsonRecord;
      } catch {
        // ignore non-serializable output
      }
    }
    emit("done", payload);
    this.pendingState = null;
  }

  private handleMessage(message: SDKMessage): void {
    debug(`handleMessage: type=${message.type}, subtype=${"subtype" in message ? message.subtype : "none"}`);
    if (message.type === "system" && message.subtype === "init") {
      if (message.session_id) {
        emit("session_id", { session_id: message.session_id });
      }
      return;
    }

    const state = this.pendingState;

    if (message.type === "stream_event") {
      if (!state) {
        return;
      }
      state.usedStreaming = true;
      const event = message.event as { type?: string; [key: string]: unknown };
      if (event.type === "content_block_start") {
        const contentBlock = (event as { content_block?: Record<string, unknown> }).content_block;
        if (contentBlock && contentBlock.type === "tool_use") {
          const toolId = String(contentBlock.id ?? "");
          const toolName = String(contentBlock.name ?? "unknown");
          if (!state.toolIdToName.has(toolId)) {
            state.toolIdToName.set(toolId, toolName);
            state.toolCount += 1;
            emit("tool_use", { id: toolId, name: toolName, input: {} });
          }
        }
      } else if (event.type === "content_block_delta") {
        const delta = (event as { delta?: Record<string, unknown> }).delta ?? {};
        const deltaType = delta.type;
        if (deltaType === "text_delta") {
          const text = typeof delta.text === "string" ? delta.text : "";
          if (text) {
            state.responseChunks.push(text);
            emit("text", { text });
          }
        } else if (deltaType === "thinking_delta") {
          const thinkingText = typeof delta.thinking === "string" ? delta.thinking : "";
          if (thinkingText) {
            emit("thinking", { text: thinkingText });
          }
        }
      }
      return;
    }

    if (message.type === "assistant") {
      if (!state) {
        return;
      }
      const content = message.message?.content ?? [];
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolId = String(block.id ?? "");
          const toolName = String(block.name ?? "unknown");
          if (!state.toolIdToName.has(toolId)) {
            state.toolIdToName.set(toolId, toolName);
            state.toolCount += 1;
            emit("tool_use", { id: toolId, name: toolName, input: block.input ?? {} });
          }
        } else if (block.type === "text" && !state.usedStreaming) {
          const text = typeof block.text === "string" ? block.text : "";
          if (text) {
            state.responseChunks.push(text);
            emit("text", { text });
          }
        }
      }
      return;
    }

    if (message.type === "user" && message.tool_use_result && state) {
      const toolUseId = message.parent_tool_use_id ?? "";
      const toolName = state.toolIdToName.get(toolUseId) ?? "unknown";
      emit("tool_result", {
        tool_use_id: toolUseId,
        name: toolName,
        output: message.tool_use_result,
        is_error: false,
      });
      return;
    }

    if (message.type === "result") {
      if (state) {
        if (message.subtype !== "success") {
          const errors = Array.isArray(message.errors) ? message.errors.join(", ") : "";
          emitError(
            `Structured output failed (${message.subtype})${errors ? `: ${errors}` : ""}`,
            false,
          );
        } else if ("structured_output" in message) {
          state.structuredOutput = message.structured_output ?? null;
        }
        this.finishState(state);
      }
    }
  }
}

function parseListEnv(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function parseJsonEnv(value: string | undefined): JsonRecord | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as JsonRecord;
  } catch {
    return null;
  }
}

async function writeSettingsFile(settings: JsonRecord): Promise<string> {
  const filename = `dere-sandbox-settings-${Date.now()}-${randomUUID()}.json`;
  const path = join(tmpdir(), filename);
  await writeFile(path, JSON.stringify(settings), "utf-8");
  return path;
}

function resolvePlugins(pluginEnv: string | undefined): Array<{ type: "local"; path: string }> {
  const pluginNames = pluginEnv
    ? pluginEnv
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : ["dere_core"];
  return pluginNames
    .map((name) => ({
      type: "local" as const,
      path: `/app/dere/plugins/${name}`,
    }))
    .filter((plugin) => existsSync(plugin.path));
}

async function main(): Promise<void> {
  const runner = new SandboxRunner();

  try {
    await runner.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitError(`Initialization failed: ${message}`, false);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let payload: JsonRecord;
      try {
        payload = JSON.parse(trimmed) as JsonRecord;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitError(`Invalid JSON: ${message}`);
        continue;
      }

      const type = payload.type;
      if (type === "query") {
        const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
        await runner.processQuery(prompt);
      } else if (type === "close") {
        break;
      } else {
        emitError(`Unknown command type: ${String(type)}`);
      }
    }
  } finally {
    rl.close();
    await runner.close();
  }
}

void main();
