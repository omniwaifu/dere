const POSITIVE_WORDS: Record<string, number> = {
  love: 0.9,
  amazing: 0.8,
  excited: 0.8,
  thrilled: 0.9,
  obsessed: 0.7,
  fantastic: 0.8,
  incredible: 0.8,
  awesome: 0.7,
  best: 0.6,
};

const NEGATIVE_WORDS: Record<string, number> = {
  hate: 0.9,
  furious: 0.9,
  angry: 0.7,
  frustrated: 0.7,
  annoyed: 0.6,
  disappointed: 0.6,
  upset: 0.7,
  terrible: 0.7,
  awful: 0.8,
};

const EXCITED_PUNCT = /!{2,}/;
const STRETCH = /([a-zA-Z])\1{2,}/;

export interface EmotionalPeakSignal {
  topic: string;
  sourceContext: string;
  triggerReason: string;
  userInterest: number;
  intensity: number;
}

export function detectEmotionalPeak(prompt: string): EmotionalPeakSignal | null {
  const text = prompt.trim();
  if (text.length < 6) {
    return null;
  }

  const { intensity, reason } = scoreIntensity(text);
  if (intensity < 0.7) {
    return null;
  }

  return {
    topic: truncate(text, 80),
    sourceContext: truncate(text, 400),
    triggerReason: reason,
    userInterest: Math.min(1.0, intensity + 0.1),
    intensity,
  };
}

function scoreIntensity(text: string): { intensity: number; reason: string } {
  const lowered = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const [word, weight] of Object.entries(POSITIVE_WORDS)) {
    if (lowered.includes(word)) {
      score += weight;
      reasons.push(`positive:${word}`);
    }
  }

  for (const [word, weight] of Object.entries(NEGATIVE_WORDS)) {
    if (lowered.includes(word)) {
      score += weight;
      reasons.push(`negative:${word}`);
    }
  }

  if (EXCITED_PUNCT.test(text)) {
    score += 0.4;
    reasons.push("exclamation");
  }

  if (STRETCH.test(text)) {
    score += 0.2;
    reasons.push("stretched_words");
  }

  const ratio = uppercaseRatio(text);
  if (ratio > 0.4 && text.length > 8) {
    score += 0.3;
    reasons.push("uppercase");
  }

  const intensity = Math.min(score / 2, 1.0);
  const reason = reasons.length
    ? `high emotional intensity (${reasons.slice(0, 3).join(", ")})`
    : "high emotional intensity";

  return { intensity, reason };
}

function uppercaseRatio(text: string): number {
  const letters = Array.from(text).filter((ch) => /[a-zA-Z]/.test(ch));
  if (letters.length === 0) {
    return 0;
  }
  const upper = letters.filter((ch) => ch === ch.toUpperCase()).length;
  return upper / letters.length;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}
