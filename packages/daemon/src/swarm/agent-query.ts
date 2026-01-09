// Swarm agent query execution via Claude SDK

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKAssistantMessage,
  SDKResultMessage,
  Options as SDKOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { runDockerSandboxQuery } from "../sandbox/docker-runner.js";
import { log } from "../logger.js";
import {
  AgentExecutionError,
  type SwarmRow,
  type SwarmAgentRow,
} from "./types.js";
import { collectText, resolvePluginPaths } from "./utils.js";

export type MessageBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  output?: string;
  is_error?: boolean;
};

export function extractBlocksFromAssistantMessage(message: SDKAssistantMessage): {
  blocks: MessageBlock[];
  toolNames: string[];
} {
  const blocks: MessageBlock[] = [];
  const toolNames: string[] = [];

  const content = message?.message?.content;
  if (!content) {
    return { blocks, toolNames };
  }

  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
    return { blocks, toolNames };
  }

  if (!Array.isArray(content)) {
    return { blocks, toolNames };
  }

  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const block = item as Record<string, unknown>;
    const type = String(block.type ?? "");
    if (type === "text" || type === "thinking") {
      blocks.push({ type, text: collectText(block.text ?? block.content ?? "") });
      continue;
    }
    if (type === "tool_use") {
      const name = typeof block.name === "string" ? block.name : "";
      if (name) {
        toolNames.push(name);
      }
      const toolUseBlock: MessageBlock = { type: "tool_use" };
      if (typeof block.id === "string") {
        toolUseBlock.id = block.id;
      }
      if (name) {
        toolUseBlock.name = name;
      }
      if (typeof block.input === "object" && block.input && !Array.isArray(block.input)) {
        toolUseBlock.input = block.input as Record<string, unknown>;
      }
      blocks.push(toolUseBlock);
      continue;
    }
    if (type === "tool_result") {
      const toolResultBlock: MessageBlock = { type: "tool_result" };
      if (typeof block.tool_use_id === "string") {
        toolResultBlock.tool_use_id = block.tool_use_id;
      }
      toolResultBlock.output = collectText(block.content ?? "");
      toolResultBlock.is_error = Boolean(block.is_error);
      blocks.push(toolResultBlock);
    }
  }

  return { blocks, toolNames };
}

export async function runAgentQuery(args: {
  swarm: SwarmRow;
  agent: SwarmAgentRow;
  prompt: string;
  sessionId: number;
}): Promise<{
  outputText: string;
  blocks: MessageBlock[];
  toolNames: string[];
  toolCount: number;
  structuredOutput?: unknown;
}> {
  const { swarm, agent, prompt, sessionId } = args;

  if (agent.sandbox_mode) {
    try {
      return await runDockerSandboxQuery({
        prompt,
        config: {
          workingDir: swarm.working_dir,
          outputStyle: "default",
          systemPrompt: null,
          model: agent.model ?? null,
          thinkingBudget: agent.thinking_budget ?? null,
          allowedTools: agent.allowed_tools ?? null,
          autoApprove: true,
          outputFormat: null,
          sandboxSettings: null,
          plugins: agent.plugins ?? null,
          env: {
            DERE_SESSION_ID: String(sessionId),
            DERE_SWARM_ID: String(swarm.id),
            DERE_SWARM_AGENT_ID: String(agent.id),
            DERE_SWARM_AGENT_NAME: agent.name,
          },
          sandboxNetworkMode: "bridge",
          mountType: "copy",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.swarm.error("Docker sandbox query failed", {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new AgentExecutionError(`Docker sandbox query failed: ${message}`, {
        swarmId: swarm.id,
        agentId: agent.id,
        agentName: agent.name,
        ...(error instanceof Error && { cause: error }),
      });
    }
  }

  const plugins = resolvePluginPaths(agent.plugins);

  const options: SDKOptions = {
    cwd: swarm.working_dir,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    persistSession: false,
    settingSources: ["project"],
    sandbox: { enabled: false },
    env: {
      DERE_SESSION_ID: String(sessionId),
      DERE_SWARM_ID: String(swarm.id),
      DERE_SWARM_AGENT_ID: String(agent.id),
      DERE_SWARM_AGENT_NAME: agent.name,
    },
  };
  options.systemPrompt = { type: "preset", preset: "claude_code" };

  if (agent.model) {
    options.model = agent.model;
  }

  if (agent.allowed_tools && agent.allowed_tools.length > 0) {
    options.tools = agent.allowed_tools;
    options.allowedTools = agent.allowed_tools;
  } else {
    options.tools = { type: "preset", preset: "claude_code" };
  }

  if (plugins && plugins.length > 0) {
    options.plugins = plugins;
  }

  const blocks: MessageBlock[] = [];
  const toolNames: string[] = [];
  let toolCount = 0;
  let structuredOutput: unknown;
  let resultText = "";

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.swarm.error("Agent SDK query failed", {
      swarmId: swarm.id,
      agentId: agent.id,
      agentName: agent.name,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new AgentExecutionError(`Agent SDK query failed: ${message}`, {
      swarmId: swarm.id,
      agentId: agent.id,
      agentName: agent.name,
      ...(error instanceof Error && { cause: error }),
    });
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

