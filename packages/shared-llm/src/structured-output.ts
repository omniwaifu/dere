import { z } from "zod";

const WRAPPER_KEYS = [
  "parameters",
  "parameter",
  "arguments",
  "argument",
  "input",
  "output",
  "data",
  "object",
  "content",
  "result",
] as const;

const UNKNOWN_WRAPPER_SUFFIXES = ["Output", "Response", "Result", "Schema"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unwrapToolPayload(candidate: unknown): unknown {
  let current: unknown = candidate;
  let iteration = 0;

  while (isRecord(current)) {
    iteration += 1;
    if (iteration > 10) {
      return current;
    }

    const keys = Object.keys(current);

    // Single-key wrappers
    let unwrapped = false;
    for (const key of WRAPPER_KEYS) {
      if (keys.length === 1 && key in current) {
        current = current[key];
        unwrapped = true;
        break;
      }
    }

    if (unwrapped) {
      continue;
    }

    // Two-key wrappers
    if ("parameters" in current && isRecord(current.parameters)) {
      current = current.parameters;
      continue;
    }

    if ("input" in current && isRecord(current.input)) {
      current = current.input;
      continue;
    }

    if (keys.length === 1) {
      const unknownKey = keys[0] ?? "";
      const value = current[unknownKey];
      if (isRecord(value)) {
        if (UNKNOWN_WRAPPER_SUFFIXES.some((suffix) => unknownKey.endsWith(suffix))) {
          current = value;
          continue;
        }
      }
    }

    return current;
  }

  return current;
}

export function tryParseJsonFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through to substring parse
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as unknown;
    } catch {
      return null;
    }
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1)) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}

export function parseStructuredOutput<TSchema extends z.ZodTypeAny>(
  input: unknown,
  schema: TSchema,
): z.infer<TSchema> {
  let candidate: unknown = input;

  if (typeof candidate === "string") {
    const parsed = tryParseJsonFromText(candidate);
    if (parsed !== null) {
      candidate = parsed;
    }
  }

  candidate = unwrapToolPayload(candidate);
  return schema.parse(candidate);
}
