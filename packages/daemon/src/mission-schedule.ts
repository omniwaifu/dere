import { CronExpressionParser } from "cron-parser";

import {
  ClaudeAgentTransport,
  StructuredOutputClient,
  ScheduleParseResultSchema,
} from "@dere/shared-llm";

import { log } from "./logger.js";

const DEFAULT_SCHEDULE_MODEL = "claude-haiku-4-5";

type ScheduleParseResult = {
  cron: string;
  timezone: string;
  explanation?: string | null;
};

function normalizeSchedule(value: string): string {
  return value.trim();
}

export function validateCronExpression(cronExpr: string): void {
  const normalized = normalizeSchedule(cronExpr);
  const parts = normalized.split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron format: '${cronExpr}' (expected 5 fields: minute hour day month weekday)`,
    );
  }

  try {
    CronExpressionParser.parse(normalized, { currentDate: new Date() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid cron expression '${cronExpr}': ${message}`);
  }
}

export function isValidCron(cronExpr: string): boolean {
  try {
    validateCronExpression(cronExpr);
    return true;
  } catch {
    return false;
  }
}

export function getNextCronRun(cronExpr: string, from: Date, timezone?: string | null): Date {
  const normalized = normalizeSchedule(cronExpr);
  const options = timezone ? { currentDate: from, tz: timezone } : { currentDate: from };
  const interval = CronExpressionParser.parse(normalized, options);
  return interval.next().toDate();
}

function getScheduleClient(): StructuredOutputClient {
  const transport = new ClaudeAgentTransport({
    workingDirectory: process.env.DERE_TS_LLM_CWD ?? "/tmp/dere-llm-sessions",
  });
  return new StructuredOutputClient({
    transport,
    model: process.env.DERE_SCHEDULE_MODEL ?? DEFAULT_SCHEDULE_MODEL,
  });
}

export async function parseSchedule(schedule: string): Promise<{
  cron_expression: string;
  timezone: string;
  natural_language_schedule: string | null;
}> {
  const normalized = normalizeSchedule(schedule);
  if (!normalized) {
    throw new Error("Schedule is required");
  }

  if (isValidCron(normalized)) {
    return {
      cron_expression: normalized,
      timezone: "UTC",
      natural_language_schedule: null,
    };
  }

  const prompt = `Convert this natural language schedule to a cron expression.

Natural language: ${normalized}

Return structured output with:
- cron: standard 5-field cron expression (minute hour day month weekday)
- timezone: IANA timezone like America/New_York or UTC
- explanation: brief explanation of when this runs

Examples:
- "every day at 6pm" -> {"cron": "0 18 * * *", "timezone": "UTC", "explanation": "Daily at 6:00 PM UTC"}
- "every Monday at 9am EST" -> {"cron": "0 9 * * 1", "timezone": "America/New_York", "explanation": "Every Monday at 9:00 AM EST"}
- "every 2 hours" -> {"cron": "0 */2 * * *", "timezone": "UTC", "explanation": "Every 2 hours at the top of the hour"}
- "weekdays at 8:30am" -> {"cron": "30 8 * * 1-5", "timezone": "UTC", "explanation": "Monday through Friday at 8:30 AM"}
- "first of every month at noon" -> {"cron": "0 12 1 * *", "timezone": "UTC", "explanation": "1st of each month at 12:00 PM"}
`;

  try {
    const client = getScheduleClient();
    const result = (await client.generate(prompt, ScheduleParseResultSchema, {
      schemaName: "schedule_parse_result",
    })) as ScheduleParseResult;
    const cronExpr = result.cron;
    const timezone = result.timezone || "UTC";
    validateCronExpression(cronExpr);

    log.mission.info("Parsed schedule", {
      input: normalized,
      cron: cronExpr,
      timezone,
      explanation: result.explanation ?? null,
    });

    return {
      cron_expression: cronExpr,
      timezone,
      natural_language_schedule: normalized,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse schedule '${normalized}': ${message}`);
  }
}
