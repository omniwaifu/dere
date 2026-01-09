import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKAssistantMessage,
  SDKResultMessage,
  Options as SDKOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentTransport, TextResponseClient } from "@dere/shared-llm";
import { sql } from "kysely";

import { getDb } from "../db.js";
import { log } from "../logger.js";
import { buildSessionContextXml } from "../context/prompt.js";
import { bufferInteractionStimulus } from "../emotions/runtime.js";
import {
  runDockerSandboxQuery,
  type SandboxMountType,
} from "../sandbox/docker-runner.js";

const MAX_OUTPUT_SIZE = 50 * 1024;
const SUMMARY_THRESHOLD = 1000;
const SUMMARY_MODEL = "claude-haiku-4-5";

type MissionRow = {
  id: number;
  name: string;
  prompt: string;
  personality: string | null;
  thinking_budget: number | null;
  model: string;
  working_dir: string;
  sandbox_mode: boolean;
  sandbox_mount_type: string;
  sandbox_settings: unknown;
  user_id: string | null;
  allowed_tools: string[] | null;
  mcp_servers: string[] | null;
  plugins: string[] | null;
};

type MissionExecutionRow = {
  id: number;
  mission_id: number;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  output_text: string | null;
  output_summary: string | null;
  tool_count: number | null;
  error_message: string | null;
  execution_metadata: unknown;
  created_at: Date | null;
};

function nowDate(): Date {
  return new Date();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_SIZE) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_SIZE)}\n\n[Output truncated]`;
}

function normalizeSandboxMountType(value: string | null | undefined): SandboxMountType {
  if (value === "direct" || value === "copy" || value === "none") {
    return value;
  }
  return "copy";
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getTextClient(model?: string): TextResponseClient {
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  const options: { transport: ClaudeAgentTransport; model?: string } = { transport };
  if (model) {
    options.model = model;
  }
  return new TextResponseClient(options);
}

async function dequeueShareableFinding(
  sessionId: number,
  userId: string | null,
): Promise<string | null> {
  if (!userId) {
    return null;
  }

  try {
    const db = await getDb();
    const surfacedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const finding = await db
      .selectFrom("exploration_findings as ef")
      .select(["ef.id", "ef.finding", "ef.share_message"])
      .where("ef.worth_sharing", "=", true)
      .where("ef.confidence", ">=", 0.8)
      .where("ef.user_id", "=", userId)
      .where(
        sql<boolean>`not exists (select 1 from surfaced_findings sf where sf.finding_id = ef.id and sf.surfaced_at > ${surfacedCutoff} and sf.session_id = ${sessionId})`,
      )
      .orderBy("ef.created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!finding || !finding.id) {
      return null;
    }

    await db
      .insertInto("surfaced_findings")
      .values({
        finding_id: finding.id,
        session_id: sessionId,
        surfaced_at: nowDate(),
      })
      .execute();

    const text = finding.share_message ?? finding.finding ?? "";
    return text.trim() ? text : null;
  } catch (error) {
    log.ambient.warn("Failed to surface exploration finding", { error: String(error) });
    return null;
  }
}

async function insertConversation(
  sessionId: number,
  messageType: string,
  prompt: string,
  userId: string | null,
  personality: string | null,
  metadata?: { toolUses?: number; toolNames?: string[] | null },
): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const timestamp = nowSeconds();

  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt,
      message_type: messageType,
      personality,
      timestamp,
      medium: "agent_api",
      user_id: userId,
      ttft_ms: null,
      response_ms: null,
      thinking_ms: null,
      tool_uses: metadata?.toolUses ?? null,
      tool_names: metadata?.toolNames ?? null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  if (prompt.trim()) {
    await db
      .insertInto("conversation_blocks")
      .values({
        conversation_id: conversation.id,
        ordinal: 0,
        block_type: "text",
        text: prompt,
        tool_use_id: null,
        tool_name: null,
        tool_input: null,
        is_error: null,
        content_embedding: null,
        created_at: now,
      })
      .execute();
  }

  await db
    .updateTable("sessions")
    .set({ last_activity: now })
    .where("id", "=", sessionId)
    .execute();

  return conversation.id;
}

async function insertAssistantBlocks(
  sessionId: number,
  blocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    output?: string;
    is_error?: boolean;
  }>,
  userId: string | null,
  personality: string | null,
  metadata: { toolUses: number; toolNames: string[] },
): Promise<number | null> {
  if (blocks.length === 0) {
    return null;
  }

  const db = await getDb();
  const now = nowDate();
  const timestamp = nowSeconds();

  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt: blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join(""),
      message_type: "assistant",
      personality,
      timestamp,
      medium: "agent_api",
      user_id: userId,
      ttft_ms: null,
      response_ms: null,
      thinking_ms: null,
      tool_uses: metadata.toolUses,
      tool_names: metadata.toolNames.length > 0 ? metadata.toolNames : null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  let ordinal = 0;
  for (const block of blocks) {
    if (block.type === "text" || block.type === "thinking") {
      const text = block.text ?? "";
      if (!text) {
        continue;
      }
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text,
          tool_use_id: null,
          tool_name: null,
          tool_input: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_use") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: "tool_use",
          tool_use_id: block.id ?? null,
          tool_name: block.name ?? null,
          tool_input: block.input ?? null,
          text: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_result") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: "tool_result",
          tool_use_id: block.tool_use_id ?? null,
          tool_name: block.name ?? null,
          tool_input: null,
          text: block.output ?? "",
          is_error: block.is_error ?? false,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
    }
  }

  await db
    .updateTable("sessions")
    .set({ last_activity: now })
    .where("id", "=", sessionId)
    .execute();

  return conversation.id;
}

async function createMissionSession(mission: MissionRow): Promise<number> {
  const db = await getDb();
  const now = nowDate();
  const inserted = await db
    .insertInto("sessions")
    .values({
      name: mission.name,
      working_dir: mission.working_dir,
      start_time: nowSeconds(),
      end_time: null,
      last_activity: now,
      continued_from: null,
      project_type: null,
      claude_session_id: null,
      personality: mission.personality,
      medium: "agent_api",
      user_id: mission.user_id,
      thinking_budget: mission.thinking_budget,
      sandbox_mode: mission.sandbox_mode,
      sandbox_mount_type: mission.sandbox_mode
        ? normalizeSandboxMountType(mission.sandbox_mount_type)
        : "none",
      sandbox_settings: toJsonRecord(mission.sandbox_settings),
      is_locked: false,
      mission_id: mission.id,
      created_at: now,
      summary: null,
      summary_updated_at: null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return inserted.id;
}

function resolvePluginPaths(
  plugins: string[] | null,
): Array<{ type: "local"; path: string }> | undefined {
  const resolved = plugins ?? ["dere_core"];
  if (resolved.length === 0) {
    return undefined;
  }
  const base = `${process.cwd()}/plugins`;
  return resolved.map((name) => ({ type: "local", path: `${base}/${name}` }));
}

function collectText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(collectText).join("");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.content)) {
      return record.content.map(collectText).join("");
    }
  }
  return "";
}

function extractBlocksFromAssistantMessage(message: SDKAssistantMessage): {
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
} {
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
  const toolNames: string[] = [];

  const content = (message.message as { content?: unknown }).content;
  if (!content) {
    return { blocks, toolNames };
  }

  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
    return { blocks, toolNames };
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        if (typeof block === "string") {
          blocks.push({ type: "text", text: block });
        }
        continue;
      }
      const record = block as Record<string, unknown>;
      const type = record.type;
      if (type === "text") {
        const text = typeof record.text === "string" ? record.text : collectText(record);
        if (text) {
          blocks.push({ type: "text", text });
        }
        continue;
      }
      if (type === "thinking") {
        const text = typeof record.thinking === "string" ? record.thinking : collectText(record);
        if (text) {
          blocks.push({ type: "thinking", text });
        }
        continue;
      }
      if (type === "tool_use") {
        const name = typeof record.name === "string" ? record.name : undefined;
        if (name) {
          toolNames.push(name);
        }
        const toolUseBlock: {
          type: "tool_use";
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        } = { type: "tool_use" };
        if (typeof record.id === "string") {
          toolUseBlock.id = record.id;
        }
        if (name) {
          toolUseBlock.name = name;
        }
        if (record.input && typeof record.input === "object" && !Array.isArray(record.input)) {
          toolUseBlock.input = record.input as Record<string, unknown>;
        }
        blocks.push(toolUseBlock);
        continue;
      }
      if (type === "tool_result") {
        const output = record.content ? collectText(record.content) : collectText(record);
        const toolResultBlock: {
          type: "tool_result";
          tool_use_id?: string;
          name?: string;
          output?: string;
          is_error?: boolean;
        } = { type: "tool_result" };
        if (typeof record.tool_use_id === "string") {
          toolResultBlock.tool_use_id = record.tool_use_id;
        }
        if (typeof record.name === "string") {
          toolResultBlock.name = record.name;
        }
        toolResultBlock.output = output ?? "";
        toolResultBlock.is_error = Boolean(record.is_error);
        blocks.push(toolResultBlock);
        continue;
      }

      const fallbackText = collectText(record);
      if (fallbackText) {
        blocks.push({ type: "text", text: fallbackText });
      }
    }
  }

  return { blocks, toolNames };
}

async function runMissionQuery(
  mission: MissionRow,
  prompt: string,
  systemPrompt?: string,
  sessionId?: number | null,
): Promise<{
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
  if (mission.sandbox_mode) {
    return await runDockerSandboxQuery({
      prompt,
      config: {
        workingDir: mission.working_dir,
        outputStyle: "default",
        systemPrompt: systemPrompt ?? null,
        model: mission.model,
        thinkingBudget: mission.thinking_budget ?? null,
        allowedTools: mission.allowed_tools ?? null,
        autoApprove: true,
        outputFormat: null,
        sandboxSettings: toJsonRecord(mission.sandbox_settings),
        plugins: mission.plugins ?? null,
        env: sessionId ? { DERE_SESSION_ID: String(sessionId) } : null,
        sandboxNetworkMode: "bridge",
        mountType: normalizeSandboxMountType(mission.sandbox_mount_type),
      },
    });
  }

  const plugins = resolvePluginPaths(mission.plugins);

  const options: SDKOptions = {
    cwd: mission.working_dir,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    persistSession: false,
    settingSources: ["project"],
    sandbox: { enabled: false },
  };

  if (mission.model) {
    options.model = mission.model;
  }

  options.systemPrompt = {
    type: "preset",
    preset: "claude_code",
    ...(systemPrompt ? { append: systemPrompt } : {}),
  };

  if (mission.allowed_tools && mission.allowed_tools.length > 0) {
    options.tools = mission.allowed_tools;
    options.allowedTools = mission.allowed_tools;
  } else {
    options.tools = { type: "preset", preset: "claude_code" };
  }

  if (plugins && plugins.length > 0) {
    options.plugins = plugins;
  }

  if (sessionId) {
    options.env = { DERE_SESSION_ID: String(sessionId) };
  }

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
  const toolNames: string[] = [];
  let toolCount = 0;
  let structuredOutput: unknown;
  let resultText = "";

  const response = query({ prompt, options });
  for await (const message of response) {
    if (message.type === "assistant") {
      const extracted = extractBlocksFromAssistantMessage(message as SDKAssistantMessage);
      if (extracted.blocks.length > 0) {
        blocks.push(...extracted.blocks);
        for (const tool of extracted.blocks) {
          if (tool.type === "tool_use") {
            toolCount += 1;
          }
        }
      }
      if (extracted.toolNames.length > 0) {
        toolNames.push(...extracted.toolNames);
      }
      continue;
    }

    if (message.type === "result") {
      const resultMessage = message as SDKResultMessage;
      if ("structured_output" in resultMessage && resultMessage.structured_output) {
        structuredOutput = resultMessage.structured_output;
      }
      if ("result" in resultMessage && typeof resultMessage.result === "string") {
        resultText = resultMessage.result;
      }
    }
  }

  const outputText =
    blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("") || resultText;

  return {
    outputText,
    blocks,
    toolNames: Array.from(new Set(toolNames)),
    toolCount,
    structuredOutput,
  };
}

export class MissionExecutor {
  async execute(
    mission: MissionRow,
    triggerType = "scheduled",
    triggeredBy: string | null = null,
  ): Promise<MissionExecutionRow> {
    const db = await getDb();
    const startedAt = nowDate();

    const execution = await db
      .insertInto("mission_executions")
      .values({
        mission_id: mission.id,
        trigger_type: triggerType,
        triggered_by: triggeredBy,
        status: "running",
        started_at: startedAt,
        completed_at: null,
        output_text: null,
        output_summary: null,
        tool_count: 0,
        error_message: null,
        execution_metadata: null,
        created_at: startedAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    let sessionId: number | null = null;
    try {
      sessionId = await createMissionSession(mission);
    } catch (error) {
      log.mission.warn("Failed to create session for mission", {
        missionId: mission.id,
        error: String(error),
      });
    }

    try {
      if (sessionId) {
        await insertConversation(
          sessionId,
          "user",
          mission.prompt,
          mission.user_id,
          mission.personality,
        );
      }

      const contextXml = await buildSessionContextXml({
        sessionId,
        personalityOverride: mission.personality,
        includeContext: false,
      });

      let promptForModel = mission.prompt;
      if (sessionId) {
        const findingText = await dequeueShareableFinding(sessionId, mission.user_id ?? null);
        if (findingText) {
          promptForModel = `${mission.prompt}\n\nAssistant context (ambient exploration; share if relevant):\n${findingText}`;
        }
      }

      const {
        outputText: rawOutput,
        blocks,
        toolNames,
        toolCount,
        structuredOutput,
      } = await runMissionQuery(mission, promptForModel, contextXml || undefined, sessionId);

      let outputText = truncateOutput(rawOutput ?? "");
      if (!outputText.trim()) {
        outputText = "";
      }

      let outputSummary: string | null = null;
      if (outputText.length > SUMMARY_THRESHOLD) {
        outputSummary = await this.generateSummary(outputText);
      }

      const completedAt = nowDate();
      const updated = await db
        .updateTable("mission_executions")
        .set({
          status: "completed",
          completed_at: completedAt,
          output_text: outputText,
          output_summary: outputSummary,
          tool_count: toolCount,
          error_message: null,
          execution_metadata: structuredOutput ? { structured_output: structuredOutput } : null,
        })
        .where("id", "=", execution.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (sessionId) {
        let assistantConversationId: number | null = null;
        if (blocks.length > 0) {
          assistantConversationId = await insertAssistantBlocks(
            sessionId,
            blocks,
            mission.user_id,
            mission.personality,
            {
              toolUses: toolCount,
              toolNames,
            },
          );
        } else if (outputText) {
          assistantConversationId = await insertConversation(
            sessionId,
            "assistant",
            outputText,
            mission.user_id,
            mission.personality,
            {
              toolUses: toolCount,
              toolNames,
            },
          );
        }

        void bufferInteractionStimulus({
          sessionId,
          prompt: mission.prompt,
          responseText: outputText,
          toolCount,
          personality: mission.personality,
          workingDir: mission.working_dir,
        }).catch((error) => {
          log.emotion.warn("Emotion buffer failed", { error: String(error) });
        });
      }

      log.mission.info("Mission completed", {
        missionId: mission.id,
        name: mission.name,
        outputLen: outputText.length,
      });

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.mission.error("Mission execution failed", { missionId: mission.id, error: message });

      const completedAt = nowDate();
      const updated = await db
        .updateTable("mission_executions")
        .set({
          status: "failed",
          completed_at: completedAt,
          error_message: message,
        })
        .where("id", "=", execution.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return updated;
    } finally {
      // Always close the session when mission execution ends
      if (sessionId) {
        try {
          await db
            .updateTable("sessions")
            .set({ end_time: nowSeconds(), is_locked: true })
            .where("id", "=", sessionId)
            .execute();
        } catch (cleanupError) {
          log.mission.warn("Session cleanup failed", { sessionId, error: String(cleanupError) });
        }
      }
    }
  }

  private async generateSummary(outputText: string): Promise<string | null> {
    try {
      const client = getTextClient(process.env.DERE_MISSION_SUMMARY_MODEL ?? SUMMARY_MODEL);
      const maxContext = 2000;
      const context =
        outputText.length > maxContext * 2
          ? `${outputText.slice(0, maxContext)}\n\n[...]\n\n${outputText.slice(-maxContext)}`
          : outputText;

      const prompt = `Summarize this mission output in 1-2 sentences. Focus on the main result or outcome.

Output:
${context}

Summary:`;

      const summary = await client.generate(prompt);
      return summary.trim();
    } catch (error) {
      log.mission.warn("Summary generation failed", { error: String(error) });
      return null;
    }
  }
}
