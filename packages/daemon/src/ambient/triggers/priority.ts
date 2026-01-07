import type { CuriositySignal } from "./types.js";

export interface PriorityWeights {
  user_interest: number;
  knowledge_gap: number;
  type_weight: number;
  recency: number;
  exploration_count: number;
}

const DEFAULT_WEIGHTS: PriorityWeights = {
  user_interest: 0.3,
  knowledge_gap: 0.25,
  type_weight: 0.2,
  recency: 0.15,
  exploration_count: 0.1,
};

const TYPE_WEIGHTS: Record<string, number> = {
  correction: 0.9,
  emotional_peak: 0.7,
  unfamiliar_entity: 0.5,
  unfinished_thread: 0.6,
  knowledge_gap: 0.6,
  research_chain: 0.4,
};

export function computeCuriosityPriority(options: {
  signal: CuriositySignal;
  explorationCount?: number;
  recency?: number;
  weights?: PriorityWeights;
}): { score: number; factors: Record<string, number> } {
  const { signal, explorationCount = 0, recency = 1.0, weights = DEFAULT_WEIGHTS } = options;

  const typeWeight = TYPE_WEIGHTS[signal.curiosity_type] ?? 0.5;
  const explorationBoost =
    explorationCount <= 0 ? 1.0 : Math.max(0.0, 1.0 - 0.1 * explorationCount);

  const factors = {
    user_interest: clamp(signal.user_interest),
    knowledge_gap: clamp(signal.knowledge_gap),
    type_weight: clamp(typeWeight),
    recency: clamp(recency),
    exploration_boost: clamp(explorationBoost),
  };

  const score =
    weights.user_interest * factors.user_interest +
    weights.knowledge_gap * factors.knowledge_gap +
    weights.type_weight * factors.type_weight +
    weights.recency * factors.recency +
    weights.exploration_count * factors.exploration_boost;

  return { score: clamp(score), factors };
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}
