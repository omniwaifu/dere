/**
 * Types and constants for temporal exploration activities.
 */

// Types for activity inputs/outputs

export interface CuriosityTask {
  id: number;
  title: string;
  working_dir: string;
  description: string | null;
  context_summary: string | null;
  extra: Record<string, unknown> | null;
}

export interface ExplorationResult {
  findings: string[];
  confidence: number;
  follow_up_questions: string[];
  worth_sharing: boolean;
  share_message: string | null;
}

export interface ExplorationConfig {
  personality: string | null;
  user_id: string | null;
  model: string;
}

// Constants

export const EXPLORATION_PROMPT = `
You are exploring a topic the user mentioned: {topic}

Context from conversation:
{source_context}

Your task:
1. Research this topic using available tools (web search, knowledge lookup)
2. Gather key facts that would be useful for future conversations
3. Note any follow-up questions worth exploring

Return output that matches the provided JSON schema.
`;

export const EXPLORATION_ALLOWED_TOOLS = ["Read", "WebSearch", "WebFetch"];
export const PROMOTION_CONFIDENCE_THRESHOLD = 0.7;
