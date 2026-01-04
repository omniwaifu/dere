import { AuthenticationError, isAuthError, isAuthFailed, markAuthFailed } from "./auth.js";
import type { StructuredOutputRequestOptions, StructuredOutputTransport } from "./client.js";

export interface TextResponseClientOptions {
  model?: string;
  maxRetries?: number;
  transport: StructuredOutputTransport;
}

export class TextResponseClient {
  private readonly model: string | undefined;
  private readonly maxRetries: number;
  private readonly transport: StructuredOutputTransport;

  constructor(options: TextResponseClientOptions) {
    this.model = options.model;
    this.maxRetries = options.maxRetries ?? 2;
    this.transport = options.transport;
  }

  async generate(prompt: string, overrides: StructuredOutputRequestOptions = {}): Promise<string> {
    // Fast-fail if auth is known to be dead
    if (isAuthFailed()) {
      throw new AuthenticationError();
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let responseText = "";

      try {
        const model = overrides.model ?? this.model;
        const workingDirectory = overrides.workingDirectory;
        const iterator = this.transport.query(prompt, {
          ...(model ? { model } : {}),
          ...(workingDirectory ? { workingDirectory } : {}),
        });

        for await (const message of iterator) {
          if (!message.content) {
            continue;
          }

          responseText += extractText(message.content);
        }

        if (responseText.trim()) {
          return responseText;
        }

        throw new Error("No text response returned");
      } catch (error) {
        // Auth failures: mark state and throw immediately (no retries)
        if (isAuthError(error)) {
          markAuthFailed();
          throw new AuthenticationError();
        }

        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error("Text response generation failed");
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(extractText).join("");
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
      return record.content.map(extractText).join("");
    }
  }

  return "";
}
