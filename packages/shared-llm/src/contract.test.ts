import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, test } from "bun:test";

import {
  AmbientEngagementDecisionSchema,
  AmbientMissionDecisionSchema,
  AppraisalOutputSchema,
  ExplorationOutputSchema,
  ScheduleParseResultSchema,
  SessionTitleResultSchema,
} from "./schemas.js";

const repoRoot = resolve(process.cwd(), "..", "..");
const fixturesDir = join(repoRoot, "packages", "shared-llm", "fixtures");
const schemaDir = join(repoRoot, "schemas", "llm");

const registry = [
  {
    name: "appraisal_output",
    schema: AppraisalOutputSchema,
    fixture: "appraisal_output.json",
  },
  {
    name: "ambient_engagement_decision",
    schema: AmbientEngagementDecisionSchema,
    fixture: "ambient_engagement_decision.json",
  },
  {
    name: "ambient_mission_decision",
    schema: AmbientMissionDecisionSchema,
    fixture: "ambient_mission_decision.json",
  },
  {
    name: "exploration_output",
    schema: ExplorationOutputSchema,
    fixture: "exploration_output.json",
  },
  {
    name: "schedule_parse_result",
    schema: ScheduleParseResultSchema,
    fixture: "schedule_parse_result.json",
  },
  {
    name: "session_title_result",
    schema: SessionTitleResultSchema,
    fixture: "session_title_result.json",
  },
];

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

describe("LLM schema parity", () => {
  for (const entry of registry) {
    test(entry.name, async () => {
      const [fixtureRaw, schemaRaw] = await Promise.all([
        readFile(join(fixturesDir, entry.fixture), "utf-8"),
        readFile(join(schemaDir, `${entry.name}.schema.json`), "utf-8"),
      ]);

      const fixture = JSON.parse(fixtureRaw) as unknown;
      const jsonSchema = JSON.parse(schemaRaw) as Record<string, unknown>;

      const validate = ajv.compile(jsonSchema);
      const valid = validate(fixture);
      if (!valid) {
        throw new Error(`JSON schema mismatch: ${JSON.stringify(validate.errors)}`);
      }

      const parsed = entry.schema.parse(fixture);
      expect(parsed).toBeTruthy();
    });
  }
});
