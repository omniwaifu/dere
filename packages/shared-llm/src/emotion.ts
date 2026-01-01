export type OCCGoal = {
  id: string;
  description?: string;
  active?: boolean;
  importance?: number;
};

export type OCCStandard = {
  id: string;
  description?: string;
  importance?: number;
  praiseworthiness?: number;
};

export type OCCAttitude = {
  id: string;
  target_object?: string;
  description?: string;
  appealingness?: number;
};

export type OCCEmotion = {
  type: string;
  intensity: number;
  name: string;
  eliciting?: string;
};

export type OCCEmotionState = {
  primary: OCCEmotion;
  secondary?: OCCEmotion | null;
  intensity: number;
};

export function buildEmotionStateFromActive(
  active: Record<string, { type: string; intensity: number }>,
): OCCEmotionState {
  const sorted = Object.values(active).sort((a, b) => b.intensity - a.intensity);
  if (sorted.length === 0) {
    return {
      primary: { type: "neutral", intensity: 0, name: "neutral" },
      intensity: 0,
    };
  }

  const primary = sorted[0];
  const secondary = sorted.length > 1 ? sorted[1] : null;
  return {
    primary: {
      type: primary.type,
      intensity: primary.intensity,
      name: primary.type,
    },
    secondary: secondary
      ? {
          type: secondary.type,
          intensity: secondary.intensity,
          name: secondary.type,
        }
      : null,
    intensity: primary.intensity,
  };
}

function formatUserProfile(
  goals: OCCGoal[],
  standards: OCCStandard[],
  attitudes: OCCAttitude[],
): string {
  const goalsStr = goals
    .filter((goal) => goal.active !== false)
    .map((goal) => `${goal.id}(${goal.importance ?? 0})`)
    .join(", ");
  const standardsStr = standards
    .map((standard) => `${standard.id}(${standard.importance ?? 0})`)
    .join(", ");
  const attitudesStr = attitudes
    .map((attitude) => `${attitude.target_object ?? attitude.id}(${attitude.appealingness ?? 0})`)
    .join(", ");

  return `Goals: ${goalsStr}\nStandards: ${standardsStr}\nAttitudes: ${attitudesStr}`;
}

function formatAppraisalTask(personaPrompt: string): string {
  const personaInstruction = personaPrompt
    ? `\n\nPersona (write reasoning in this voice):\n${personaPrompt}`
    : "";
  return `Detect USER emotions (OCC model).${personaInstruction}

Event/Action/Object dimensions, strength -10 to 10. Intensity 0-100 (normal=20-40, intense=70+).`;
}

function formatResponseSchema(): string {
  return `IMPORTANT: Use ONLY these exact emotion type values (no descriptions, no combinations):
hope, fear, joy, distress, satisfaction, relief, fears-confirmed, disappointment, happy-for, pity, gloating, resentment, pride, shame, admiration, reproach, love, hate, interest, disgust, gratitude, anger, gratification, remorse, neutral.`;
}

export function buildAppraisalPrompt(args: {
  stimulus: Record<string, unknown> | string;
  currentEmotionState: OCCEmotionState;
  context: Record<string, unknown>;
  personaPrompt: string;
  goals: OCCGoal[];
  standards: OCCStandard[];
  attitudes: OCCAttitude[];
}): string {
  const current = args.currentEmotionState;
  let currentEmotionStr = `User's current primary emotion: ${current.primary.name} (${current.primary.type}) at intensity ${current.intensity}.`;
  if (current.secondary) {
    currentEmotionStr += ` Secondary: ${current.secondary.name} (${current.secondary.type}).`;
  }

  const stimulusStr =
    typeof args.stimulus === "string" ? args.stimulus : JSON.stringify(args.stimulus, null, 2);

  let contextStr = "";
  const temporal = args.context.temporal ?? {};
  const session = args.context.session ?? {};
  if (temporal || session) {
    const lines: string[] = ["CONTEXTUAL INFORMATION:"];
    if (temporal.time_of_day || temporal.day_of_week || temporal.hour !== undefined) {
      lines.push(
        `Time: ${temporal.time_of_day ?? "unknown"} (${temporal.hour ?? "unknown"}:00) on ${
          temporal.day_of_week ?? "unknown"
        }`,
      );
    }
    if (session.duration_minutes) {
      lines.push(`Session duration: ${session.duration_minutes} minutes`);
    }
    if (session.working_dir) {
      lines.push(`Working on: ${session.working_dir}`);
    }
    contextStr = `${lines.join("\n")}\n\n`;
  }

  const userProfile = formatUserProfile(args.goals, args.standards, args.attitudes);
  const appraisalTask = formatAppraisalTask(args.personaPrompt);
  const responseSchema = formatResponseSchema();

  return `${appraisalTask}

${userProfile}
Current: ${currentEmotionStr}
${contextStr}Stimulus: ${stimulusStr}

${responseSchema}`;
}
