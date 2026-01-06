import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options as SDKOptions } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { StructuredOutputError } from "./client.js";
import type {
  StructuredOutputMessage,
  StructuredOutputRequestOptions,
  StructuredOutputTransport,
} from "./client.js";

export interface ClaudeAgentTransportOptions {
  workingDirectory?: string;
  defaultSchemaName?: string;
}

export class ClaudeAgentTransport implements StructuredOutputTransport {
  private readonly workingDirectory: string | undefined;
  private readonly defaultSchemaName: string;

  constructor(options: ClaudeAgentTransportOptions = {}) {
    this.workingDirectory = options.workingDirectory;
    this.defaultSchemaName = options.defaultSchemaName ?? "structured_output";
  }

  async *query(
    prompt: string,
    options: StructuredOutputRequestOptions,
  ): AsyncIterable<StructuredOutputMessage> {
    const model = options.model;
    const cwd = options.workingDirectory ?? this.workingDirectory;
    const schema = options.schema as z.ZodTypeAny | undefined;

    const sdkOptions: SDKOptions = {
      persistSession: false, // One-shot queries, don't clutter filesystem
    };

    if (model) {
      sdkOptions.model = model;
    }
    if (cwd) {
      sdkOptions.cwd = cwd;
    }
    // Use outputFormat with json_schema - works WITH tools
    if (schema) {
      const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
      // Remove $schema key - SDK ignores outputFormat when this key is present
      const { $schema: _, ...cleanSchema } = jsonSchema;
      sdkOptions.outputFormat = {
        type: "json_schema",
        schema: cleanSchema,
      };
    }
    if (options.tools) {
      sdkOptions.tools = options.tools;
    }
    if (options.allowedTools) {
      sdkOptions.allowedTools = options.allowedTools;
    }
    if (options.permissionMode) {
      sdkOptions.permissionMode = options.permissionMode;
    }
    if (options.allowDangerouslySkipPermissions) {
      sdkOptions.allowDangerouslySkipPermissions = true;
    }

    const response = query({
      prompt,
      options: sdkOptions,
    });

    let lastAssistantContent: unknown = null;

    for await (const message of response) {
      if (message.type === "result") {
        const resultMessage = message as {
          subtype?: string;
          structured_output?: unknown;
          result?: string;
          error?: unknown;
          message?: unknown;
        };
        if (resultMessage.subtype && resultMessage.subtype !== "success") {
          const details =
            typeof resultMessage.error === "string"
              ? resultMessage.error
              : typeof resultMessage.message === "string"
                ? resultMessage.message
                : "";
          const suffix = details ? `: ${details}` : "";
          const err = new StructuredOutputError(
            `Structured output failed (${resultMessage.subtype})${suffix}`,
          );
          (err as { subtype?: string }).subtype = resultMessage.subtype;
          throw err;
        }
        if (resultMessage.subtype === "success") {
          if (resultMessage.structured_output) {
            yield { structured_output: resultMessage.structured_output };
          } else if (resultMessage.result) {
            // No structured_output, yield the result text for parsing
            yield { content: resultMessage.result };
          }
        }
        continue;
      }

      // Capture assistant message content for fallback extraction
      if (message.type === "assistant") {
        const assistantMsg = message as { message?: { content?: unknown } };
        if (assistantMsg.message?.content) {
          lastAssistantContent = assistantMsg.message.content;
        }
      }

      yield { content: (message as { content?: unknown }).content };
    }

    // If we got assistant content but no structured_output was yielded, try to extract from content
    if (lastAssistantContent) {
      yield { content: lastAssistantContent };
    }
  }
}
