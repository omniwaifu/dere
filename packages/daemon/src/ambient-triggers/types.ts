export interface CuriositySignal {
  curiosity_type: string;
  topic: string;
  source_context: string;
  trigger_reason: string;
  user_interest: number;
  knowledge_gap: number;
  metadata: Record<string, unknown>;
}

export function createSignal(
  signal: Omit<CuriositySignal, "knowledge_gap" | "metadata">,
): CuriositySignal {
  return {
    ...signal,
    knowledge_gap: 0,
    metadata: {},
  };
}
