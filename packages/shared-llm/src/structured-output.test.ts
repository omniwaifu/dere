import { describe, expect, test } from "bun:test";

import { AppraisalOutputSchema, EmotionSchemaOutputSchema } from "./schemas.js";
import { parseStructuredOutput, unwrapToolPayload } from "./structured-output.js";

describe("unwrapToolPayload", () => {
  test("unwraps single-key wrappers", () => {
    const payload = unwrapToolPayload({ parameters: { foo: "bar" } });
    expect(payload).toEqual({ foo: "bar" });
  });
});

describe("parseStructuredOutput", () => {
  test("parses embedded JSON string", () => {
    const input = 'Result: {"value": 42}';
    const parsed = parseStructuredOutput(input, AppraisalOutputSchema);
    expect(parsed.resulting_emotions[0]?.type).toBe("neutral");
  });
});

describe("EmotionSchemaOutputSchema", () => {
  test("normalizes synonyms", () => {
    const parsed = EmotionSchemaOutputSchema.parse({
      type: "sad",
      intensity: 10,
      eliciting: "rain",
    });
    expect(parsed.type).toBe("distress");
  });
});

describe("AppraisalOutputSchema", () => {
  test("defaults resulting_emotions when missing", () => {
    const parsed = AppraisalOutputSchema.parse({});
    expect(parsed.resulting_emotions[0]?.type).toBe("neutral");
  });

  test("parses resulting_emotions when provided as JSON string", () => {
    const parsed = AppraisalOutputSchema.parse({
      resulting_emotions: '[{"type": "joy", "intensity": 30, "eliciting": "win"}]',
    });
    expect(parsed.resulting_emotions[0]?.type).toBe("joy");
  });
});
