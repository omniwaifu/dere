import { z } from "zod";

export const OCC_EMOTION_TYPES = [
  "hope",
  "fear",
  "joy",
  "distress",
  "satisfaction",
  "relief",
  "fears-confirmed",
  "disappointment",
  "happy-for",
  "pity",
  "gloating",
  "resentment",
  "pride",
  "shame",
  "admiration",
  "reproach",
  "love",
  "hate",
  "interest",
  "disgust",
  "gratitude",
  "anger",
  "gratification",
  "remorse",
  "neutral",
] as const;

export const OCCEmotionTypeSchema = z.enum(OCC_EMOTION_TYPES);

const EMOTION_TYPE_MAPPING: Record<string, (typeof OCC_EMOTION_TYPES)[number]> = {
  concern: "fear",
  worry: "fear",
  anxious: "fear",
  anxiety: "fear",
  mild_distress: "distress",
  "mild distress": "distress",
  sadness: "distress",
  sad: "distress",
  upset: "distress",
  happiness: "joy",
  happy: "joy",
  pleased: "joy",
  content: "satisfaction",
  contentment: "satisfaction",
  frustration: "disappointment",
  frustrated: "disappointment",
  annoyed: "anger",
  annoyance: "anger",
  irritated: "anger",
  irritation: "anger",
  worried: "fear",
  nervous: "fear",
};

function normalizeEmotionType(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.toLowerCase().trim();

  const hasCompound =
    normalized.includes("/") || normalized.includes("_") || normalized.includes(" ");
  if (hasCompound) {
    const parts = normalized.replace(/[_/]/g, " ").split(/\s+/).filter(Boolean);
    for (const part of parts) {
      if (OCC_EMOTION_TYPES.includes(part as (typeof OCC_EMOTION_TYPES)[number])) {
        return part;
      }
      if (part in EMOTION_TYPE_MAPPING) {
        return EMOTION_TYPE_MAPPING[part] ?? part;
      }
    }
  }

  if (normalized in EMOTION_TYPE_MAPPING) {
    return EMOTION_TYPE_MAPPING[normalized] ?? normalized;
  }

  if (OCC_EMOTION_TYPES.includes(normalized as (typeof OCC_EMOTION_TYPES)[number])) {
    return normalized;
  }

  return normalized;
}

function normalizeEventOutcomeType(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const normalized = String(value).toLowerCase().trim();
  if (["desirable", "positive", "good"].includes(normalized)) {
    return "desirable";
  }
  if (["undesirable", "negative", "bad"].includes(normalized)) {
    return "undesirable";
  }
  return "neutral";
}

function normalizeAgentActionType(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const normalized = String(value).toLowerCase().trim();
  if (["praiseworthy", "positive", "good", "admirable"].includes(normalized)) {
    return "praiseworthy";
  }
  if (["blameworthy", "negative", "bad", "shameful"].includes(normalized)) {
    return "blameworthy";
  }
  return "neutral";
}

function normalizeObjectAttributeType(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const normalized = String(value).toLowerCase().trim();
  if (["appealing", "positive", "good", "attractive"].includes(normalized)) {
    return "appealing";
  }
  if (["unappealing", "negative", "bad", "repulsive"].includes(normalized)) {
    return "unappealing";
  }
  return "neutral";
}

function parseJsonLike(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fallthrough
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as unknown;
    } catch {
      return value;
    }
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1)) as unknown;
    } catch {
      return value;
    }
  }

  return value;
}

export const EventOutcomeSchema = z.object({
  type: z
    .preprocess(normalizeEventOutcomeType, z.enum(["desirable", "undesirable", "neutral"]))
    .nullable()
    .optional(),
  prospect: z.enum(["prospective", "actual", "none"]).nullable().optional(),
  affected_goals: z.array(z.string()).default([]),
  desirability: z.number().min(-10).max(10).default(0),
});

export const AgentActionSchema = z.object({
  agent: z.enum(["self", "other"]).nullable().optional(),
  type: z
    .preprocess(normalizeAgentActionType, z.enum(["praiseworthy", "blameworthy", "neutral"]))
    .nullable()
    .optional(),
  affected_standards: z.array(z.string()).default([]),
  praiseworthiness: z.number().min(-10).max(10).default(0),
});

export const ObjectAttributeSchema = z.object({
  familiarity: z.enum(["familiar", "unfamiliar", "none"]).nullable().optional(),
  type: z
    .preprocess(normalizeObjectAttributeType, z.enum(["appealing", "unappealing", "neutral"]))
    .nullable()
    .optional(),
  affected_attitudes: z.array(z.string()).default([]),
  appealingness: z.number().min(-10).max(10).default(0),
});

export const EmotionSchemaOutputSchema = z.object({
  type: z.preprocess(normalizeEmotionType, OCCEmotionTypeSchema),
  intensity: z.number().min(0).max(100),
  eliciting: z.string(),
});

const ResultingEmotionsSchema = z.preprocess(
  (value) => (typeof value === "string" ? parseJsonLike(value) : value),
  z.array(EmotionSchemaOutputSchema).min(1),
);

export const AppraisalOutputSchema = z.object({
  event_outcome: EventOutcomeSchema.nullable().optional(),
  agent_action: AgentActionSchema.nullable().optional(),
  object_attribute: ObjectAttributeSchema.nullable().optional(),
  resulting_emotions: ResultingEmotionsSchema.default([
    { type: "neutral", intensity: 20, eliciting: "No emotion detected" },
  ]),
  reasoning: z.string().nullable().optional(),
});

export const AmbientEngagementDecisionSchema = z.object({
  should_engage: z.boolean(),
  message: z.string().nullable().optional(),
  priority: z.enum(["alert", "conversation"]).default("conversation"),
  reasoning: z.string(),
});

export const AmbientMissionDecisionSchema = z.object({
  send: z.boolean(),
  message: z.string().nullable().optional(),
  priority: z.enum(["alert", "conversation"]).default("conversation"),
  confidence: z.number().default(0),
  reasoning: z.string().nullable().optional(),
});

export const ExplorationOutputSchema = z.object({
  findings: z.array(z.string()).default([]),
  confidence: z.number().default(0),
  follow_up_questions: z.array(z.string()).default([]),
  worth_sharing: z.boolean().default(false),
  share_message: z.string().nullable().optional(),
});

export const ScheduleParseResultSchema = z.object({
  cron: z.string(),
  timezone: z.string().default("UTC"),
  explanation: z.string().nullable().optional(),
});

export const SessionTitleResultSchema = z.object({
  title: z.string(),
});

export type OCCEmotionType = z.infer<typeof OCCEmotionTypeSchema>;
export type EventOutcome = z.infer<typeof EventOutcomeSchema>;
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type ObjectAttribute = z.infer<typeof ObjectAttributeSchema>;
export type EmotionSchemaOutput = z.infer<typeof EmotionSchemaOutputSchema>;
export type AppraisalOutput = z.infer<typeof AppraisalOutputSchema>;
export type AmbientEngagementDecision = z.infer<typeof AmbientEngagementDecisionSchema>;
export type AmbientMissionDecision = z.infer<typeof AmbientMissionDecisionSchema>;
export type ExplorationOutput = z.infer<typeof ExplorationOutputSchema>;
export type ScheduleParseResult = z.infer<typeof ScheduleParseResultSchema>;
export type SessionTitleResult = z.infer<typeof SessionTitleResultSchema>;
