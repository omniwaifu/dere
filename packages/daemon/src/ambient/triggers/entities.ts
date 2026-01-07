const GENERIC_ENTITY_NAMES = new Set(["user", "assistant", "ai", "system", "daemon"]);

export interface EntityNodeLike {
  name?: string | null;
  labels?: string[] | null;
}

export interface EntitySignal {
  topic: string;
  sourceContext: string;
  triggerReason: string;
}

export function detectUnfamiliarEntities(options: {
  prompt: string;
  nodes: EntityNodeLike[] | null;
  speakerName: string | null;
  personality: string | null;
  maxEntities?: number;
}): EntitySignal[] {
  const { prompt, nodes, speakerName, personality } = options;
  const maxEntities = options.maxEntities ?? 3;

  if (!nodes || prompt.trim().length === 0) {
    return [];
  }

  const signals: EntitySignal[] = [];
  for (const node of nodes) {
    const name = String(node.name ?? "").trim();
    if (!name) {
      continue;
    }

    if (isGenericEntity(node, name, speakerName, personality)) {
      continue;
    }
    if (appearsAsLogPrefix(name, prompt)) {
      continue;
    }

    signals.push({
      topic: name,
      sourceContext: truncate(prompt, 400),
      triggerReason: "New entity extracted from user message",
    });

    if (signals.length >= maxEntities) {
      break;
    }
  }

  return signals;
}

function isGenericEntity(
  node: EntityNodeLike,
  name: string,
  speakerName: string | null,
  personality: string | null,
): boolean {
  if (name.length < 3) {
    return true;
  }

  const normalized = name.toLowerCase();
  if (GENERIC_ENTITY_NAMES.has(normalized)) {
    return true;
  }

  const labels = new Set((node.labels ?? []).map((label) => String(label).toLowerCase()));
  if (["user", "assistant", "ai"].some((label) => labels.has(label))) {
    return true;
  }

  if (speakerName && normalized === speakerName.trim().toLowerCase()) {
    return true;
  }

  if (personality && normalized === personality.trim().toLowerCase()) {
    return true;
  }

  return false;
}

function appearsAsLogPrefix(name: string, prompt: string): boolean {
  const normalized = name.toLowerCase();
  if (!normalized) {
    return false;
  }
  const pattern = new RegExp(`^\\s*${escapeRegExp(normalized)}(?:\\.\\d+)?\\s*\\|`, "i");
  return prompt.split("\n").some((line) => pattern.test(line));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}
