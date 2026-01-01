import { query } from "@anthropic-ai/claude-agent-sdk";
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
    const schema = options.schema as z.ZodTypeAny | undefined;
    const schemaName = options.schemaName ?? this.defaultSchemaName;

    let outputFormat = options.outputFormat;
    if (!outputFormat && schema) {
      const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
      if (schemaName && !("title" in jsonSchema)) {
        jsonSchema.title = schemaName;
      }
      outputFormat = {
        type: "json_schema",
        schema: jsonSchema,
      };
    }

    const model = options.model;
    const workingDirectory = options.workingDirectory ?? this.workingDirectory;
    const sdkOptions = {
      ...(model ? { model } : {}),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(outputFormat ? { outputFormat } : {}),
    };

    const response = query({
      prompt,
      options: sdkOptions,
    });

    for await (const message of response) {
      if (message.type === "result") {
        const resultMessage = message as {
          subtype?: string;
          structured_output?: unknown;
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
        if (resultMessage.subtype === "success" && resultMessage.structured_output) {
          yield { structured_output: resultMessage.structured_output };
        }
        continue;
      }

      yield { content: (message as { content?: unknown }).content };
    }
  }
}
