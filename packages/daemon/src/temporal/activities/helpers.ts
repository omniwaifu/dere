/**
 * Helper functions for temporal exploration activities.
 */

import { EXPLORATION_PROMPT, type CuriosityTask, type ExplorationResult } from "./types.js";

export function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function buildPrompt(task: CuriosityTask): string {
  const extra = task.extra ?? {};
  const sourceContext =
    (extra.source_context as string | undefined) ??
    task.context_summary ??
    task.description ??
    "(no context captured)";
  return EXPLORATION_PROMPT.replace("{topic}", task.title).replace(
    "{source_context}",
    sourceContext,
  );
}

export function buildResult(payload: Record<string, unknown>): ExplorationResult {
  const rawFindings = Array.isArray(payload.findings) ? payload.findings : [];
  const findings = rawFindings.map((item) => String(item).trim()).filter(Boolean);

  const rawQuestions = Array.isArray(payload.follow_up_questions)
    ? payload.follow_up_questions
    : [];
  const followUps = rawQuestions.map((item) => String(item).trim()).filter(Boolean);

  const confidenceRaw = Number(payload.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : 0;

  return {
    findings,
    confidence,
    follow_up_questions: followUps,
    worth_sharing: Boolean(payload.worth_sharing),
    share_message: typeof payload.share_message === "string" ? payload.share_message : null,
  };
}

export function mergeFindings(existing: string[] | undefined, additions: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...(existing ?? []), ...additions]) {
    const normalized = String(item).trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}
