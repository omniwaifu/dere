import { z } from "zod";

import { AuthenticationError, isAuthError, isAuthFailed, markAuthFailed } from "./auth.js";
import {
  parseStructuredOutput,
  tryParseJsonFromText,
  unwrapToolPayload,
} from "./structured-output.js";

export interface StructuredOutputMessage {
  structured_output?: unknown;
  content?: unknown;
}

export interface StructuredOutputRequestOptions {
  model?: string;
  outputFormat?: unknown;
  schema?: z.ZodTypeAny;
  schemaName?: string;
  workingDirectory?: string;
}

export interface StructuredOutputClientOptions {
  model?: string;
  maxRetries?: number;
  transport: StructuredOutputTransport;
}

export interface StructuredOutputTransport {
  query(
    prompt: string,
    options: StructuredOutputRequestOptions,
  ): AsyncIterable<StructuredOutputMessage>;
}

export class StructuredOutputError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StructuredOutputError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export class StructuredOutputClient {
  private readonly model: string | undefined;
  private readonly maxRetries: number;
  private readonly transport: StructuredOutputTransport;

  constructor(options: StructuredOutputClientOptions) {
    this.model = options.model;
    this.maxRetries = options.maxRetries ?? 2;
    this.transport = options.transport;
  }

  async generate<TSchema extends z.ZodTypeAny>(
    prompt: string,
    schema: TSchema,
    overrides: StructuredOutputRequestOptions = {},
  ): Promise<z.infer<TSchema>> {
    // Fast-fail if auth is known to be dead
    if (isAuthFailed()) {
      throw new AuthenticationError();
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let lastText = "";
      let structuredCandidate: unknown | null = null;

      try {
        const iterator = this.transport.query(prompt, {
          model: overrides.model ?? this.model,
          outputFormat: overrides.outputFormat,
          schema: overrides.schema ?? schema,
          schemaName: overrides.schemaName,
          workingDirectory: overrides.workingDirectory,
        });

        for await (const message of iterator) {
          if (message.structured_output) {
            structuredCandidate = unwrapToolPayload(message.structured_output);
          }

          if (!structuredCandidate && message.content !== undefined) {
            const content = message.content;
            if (typeof content === "string") {
              lastText = content;
              const parsed = tryParseJsonFromText(content);
              if (parsed !== null) {
                structuredCandidate = unwrapToolPayload(parsed);
              }
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (typeof block === "string") {
                  lastText = block;
                  const parsed = tryParseJsonFromText(block);
                  if (parsed !== null) {
                    structuredCandidate = unwrapToolPayload(parsed);
                    break;
                  }
                  continue;
                }

                if (block && typeof block === "object") {
                  const blockRecord = block as Record<string, unknown>;
                  if ("input" in blockRecord && blockRecord.input) {
                    structuredCandidate = unwrapToolPayload(blockRecord.input);
                    break;
                  }
                  if ("text" in blockRecord && typeof blockRecord.text === "string") {
                    lastText = blockRecord.text;
                    const parsed = tryParseJsonFromText(blockRecord.text);
                    if (parsed !== null) {
                      structuredCandidate = unwrapToolPayload(parsed);
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        if (structuredCandidate !== null) {
          return parseStructuredOutput(structuredCandidate, schema);
        }

        throw new StructuredOutputError(
          lastText
            ? `No structured output in response (last text: ${lastText.slice(0, 200)})`
            : "No structured output in response",
        );
      } catch (error) {
        // Auth failures: mark state and throw immediately (no retries)
        if (isAuthError(error)) {
          markAuthFailed();
          throw new AuthenticationError();
        }

        lastError = error;
        if (error instanceof StructuredOutputError) {
          const subtype = (error as { subtype?: string }).subtype;
          if (subtype) {
            throw error;
          }
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new StructuredOutputError("Structured output generation failed", lastError);
  }
}
