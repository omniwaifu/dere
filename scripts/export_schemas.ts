import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  AmbientEngagementDecisionSchema,
  AmbientMissionDecisionSchema,
  AppraisalOutputSchema,
  ExplorationOutputSchema,
  ScheduleParseResultSchema,
  SessionTitleResultSchema,
} from "../packages/shared-llm/src/schemas.ts";

type JsonRecord = Record<string, unknown>;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

async function writeJson(path: string, payload: JsonRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

const registry = [
  {
    name: "appraisal_output",
    title: "AppraisalOutput",
    schema: AppraisalOutputSchema,
  },
  {
    name: "ambient_engagement_decision",
    title: "AmbientEngagementDecision",
    schema: AmbientEngagementDecisionSchema,
  },
  {
    name: "ambient_mission_decision",
    title: "AmbientMissionDecision",
    schema: AmbientMissionDecisionSchema,
  },
  {
    name: "exploration_output",
    title: "ExplorationOutput",
    schema: ExplorationOutputSchema,
  },
  {
    name: "schedule_parse_result",
    title: "ScheduleParseResult",
    schema: ScheduleParseResultSchema,
  },
  {
    name: "session_title_result",
    title: "SessionTitleResult",
    schema: SessionTitleResultSchema,
  },
];

async function exportLlmSchemas(baseDir: string): Promise<string[]> {
  const outputs: string[] = [];
  for (const entry of registry) {
    const jsonSchema = z.toJSONSchema(entry.schema) as JsonRecord;
    if (entry.title) {
      jsonSchema.title = entry.title;
    }
    const path = join(baseDir, "llm", `${entry.name}.schema.json`);
    await writeJson(path, jsonSchema);
    outputs.push(path);
  }
  return outputs;
}

async function exportConfigSchema(baseDir: string): Promise<string> {
  const path = join(baseDir, "config", "dere_config.schema.json");
  const raw = await readFile(path, "utf-8");
  const schema = JSON.parse(raw) as JsonRecord;
  await writeJson(path, schema);
  return path;
}

async function main(): Promise<void> {
  const baseDir = join(repoRoot, "schemas");
  const llmOutputs = await exportLlmSchemas(baseDir);
  const configOutput = await exportConfigSchema(baseDir);

  const summary = [
    "Exported schemas:",
    ...llmOutputs.map((path) => `- ${path.slice(repoRoot.length + 1)}`),
    `- ${configOutput.slice(repoRoot.length + 1)}`,
  ];
  console.log(summary.join("\n"));
}

await main();
