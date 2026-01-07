const HEDGING_PATTERNS = [
  /\bi think\b/i,
  /\bnot sure\b/i,
  /\bnot certain\b/i,
  /\buncertain\b/i,
  /\bI don't know\b/i,
  /\bI do not know\b/i,
  /\bcan't verify\b/i,
  /\bcannot verify\b/i,
  /\bcan't confirm\b/i,
  /\bcannot confirm\b/i,
  /\bprobably\b/i,
  /\bmaybe\b/i,
  /\bguess\b/i,
];

const TOPIC_PATTERNS = [
  /\babout\s+(?<topic>[^.?!]+)/i,
  /\bfor\s+(?<topic>[^.?!]+)/i,
  /\bon\s+(?<topic>[^.?!]+)/i,
];

export interface KnowledgeGapSignal {
  topic: string;
  sourceContext: string;
  triggerReason: string;
}

export function detectKnowledgeGap(
  prompt: string,
  previousUser: string | null,
): KnowledgeGapSignal | null {
  const text = prompt.trim();
  if (text.length < 20) {
    return null;
  }

  const reason = findReason(text);
  if (!reason) {
    return null;
  }

  const topic = extractTopic(text) ?? truncate(previousUser || text, 80);
  const sourceContext = `Assistant: ${truncate(text, 220)}\nUser: ${truncate(
    previousUser || "",
    200,
  )}`;

  return {
    topic,
    sourceContext,
    triggerReason: reason,
  };
}

function findReason(text: string): string | null {
  for (const pattern of HEDGING_PATTERNS) {
    if (pattern.test(text)) {
      return "Assistant expressed uncertainty";
    }
  }
  return null;
}

function extractTopic(text: string): string | null {
  for (const pattern of TOPIC_PATTERNS) {
    const match = pattern.exec(text);
    const candidate = match?.groups?.topic?.trim();
    if (candidate) {
      return truncate(candidate, 80);
    }
  }
  return null;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}
