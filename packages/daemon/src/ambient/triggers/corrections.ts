const CORRECTION_PATTERNS = [
  /^(no|nah|not quite|actually|correction)\b/i,
  /\b(it's|it is|that's|that is)\s+(actually|not)\b/i,
  /\b(i meant|i said|what i meant)\b/i,
  /\b(correct(ing)?|to clarify|let me clarify)\b/i,
];

const TOPIC_PATTERNS = [
  /\b(it's|it is|that's|that is)\s+(actually\s+)?(?<topic>.+)/i,
  /\b(correct(ing)?|correction):?\s+(?<topic>.+)/i,
];

export interface CuriosityCorrection {
  topic: string;
  sourceContext: string;
  triggerReason: string;
}

export function detectCorrection(
  prompt: string,
  previousAssistant: string | null,
): CuriosityCorrection | null {
  if (!previousAssistant) {
    return null;
  }
  const text = prompt.trim();
  if (text.length < 6) {
    return null;
  }
  if (!CORRECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return null;
  }

  const topic = extractTopic(text);
  const sourceContext = `Assistant: ${truncate(previousAssistant, 200)}\nUser: ${truncate(
    text,
    200,
  )}`;
  return {
    topic,
    sourceContext,
    triggerReason: "User corrected the assistant",
  };
}

function extractTopic(text: string): string {
  for (const pattern of TOPIC_PATTERNS) {
    const match = pattern.exec(text);
    const topic = match?.groups?.topic?.trim();
    if (topic) {
      return truncate(topic, 80);
    }
  }
  return truncate(text.trim(), 80);
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}
