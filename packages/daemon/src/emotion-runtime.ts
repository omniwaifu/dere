import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type OCCGoal, type OCCStandard, type OCCAttitude } from "@dere/shared-llm";
import { EmotionManager, EMOTION_BATCH_LIMIT, trimStimulusInput } from "./emotion-manager.js";
import { loadPersonality } from "./personalities.js";
import { log } from "./logger.js";

const EMOTION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const EMOTION_CHECK_INTERVAL_MS = 60 * 1000;
const GLOBAL_EMOTION_SESSION_ID = 0;

type ManagerEntry = {
  manager: EmotionManager;
  initialized: boolean;
};

const managers = new Map<number, ManagerEntry>();
let loopTimer: ReturnType<typeof setInterval> | null = null;

type OccProfile = {
  goals: OCCGoal[];
  standards: OCCStandard[];
  attitudes: OCCAttitude[];
};

const OCC_PROFILE_PATH = join(homedir(), ".config", "dere", "user_occ.json");
const personaPromptCache = new Map<string, string>();

const DEFAULT_OCC_PROFILE: OccProfile = {
  goals: [
    {
      id: "accomplish_tasks",
      description: "Complete tasks and get things done",
      active: true,
      importance: 8,
    },
    {
      id: "learn_and_grow",
      description: "Learn new things and develop skills",
      active: true,
      importance: 7,
    },
    {
      id: "maintain_balance",
      description: "Balance work, rest, and personal life",
      active: true,
      importance: 6,
    },
  ],
  standards: [
    {
      id: "be_productive",
      description: "Use time effectively and accomplish goals",
      importance: 8,
      praiseworthiness: 7,
    },
    {
      id: "be_thoughtful",
      description: "Consider consequences and make good decisions",
      importance: 7,
      praiseworthiness: 8,
    },
    {
      id: "be_persistent",
      description: "Keep trying despite difficulties",
      importance: 6,
      praiseworthiness: 7,
    },
  ],
  attitudes: [
    {
      id: "challenges",
      target_object: "unexpected_challenges",
      description: "Attitude toward unexpected challenges",
      appealingness: -2,
    },
    {
      id: "learning",
      target_object: "learning_opportunities",
      description: "Attitude toward learning new things",
      appealingness: 5,
    },
    {
      id: "interruptions",
      target_object: "interruptions",
      description: "Attitude toward being interrupted during work",
      appealingness: -5,
    },
  ],
};

function parseOccProfile(parsed: Record<string, unknown>): OccProfile {
  return {
    goals: Array.isArray(parsed.goals) ? (parsed.goals as OCCGoal[]) : [],
    standards: Array.isArray(parsed.standards) ? (parsed.standards as OCCStandard[]) : [],
    attitudes: Array.isArray(parsed.attitudes) ? (parsed.attitudes as OCCAttitude[]) : [],
  };
}

function mergeWithDefaults(profile: OccProfile): OccProfile {
  return {
    goals: profile.goals.length > 0 ? profile.goals : DEFAULT_OCC_PROFILE.goals,
    standards: profile.standards.length > 0 ? profile.standards : DEFAULT_OCC_PROFILE.standards,
    attitudes: profile.attitudes.length > 0 ? profile.attitudes : DEFAULT_OCC_PROFILE.attitudes,
  };
}

async function loadOccProfile(): Promise<OccProfile> {
  try {
    const raw = await readFile(OCC_PROFILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return mergeWithDefaults(parseOccProfile(parsed));
  } catch {
    return DEFAULT_OCC_PROFILE;
  }
}

export async function getOccProfileSnapshot(): Promise<
  OccProfile & { hasProfile: boolean; profilePath: string }
> {
  try {
    const raw = await readFile(OCC_PROFILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const profile = parseOccProfile(parsed);
    return { ...profile, hasProfile: true, profilePath: OCC_PROFILE_PATH };
  } catch (error) {
    const err = error as NodeJS.ErrnoException | null;
    if (err?.code === "ENOENT") {
      return { ...DEFAULT_OCC_PROFILE, hasProfile: false, profilePath: OCC_PROFILE_PATH };
    }
    return {
      goals: [],
      standards: [],
      attitudes: [],
      hasProfile: false,
      profilePath: OCC_PROFILE_PATH,
    };
  }
}

async function getManager(sessionId: number): Promise<EmotionManager> {
  const existing = managers.get(sessionId);
  if (existing) {
    if (!existing.initialized) {
      await existing.manager.initialize();
      existing.initialized = true;
    }
    return existing.manager;
  }

  const profile = await loadOccProfile();
  const manager = new EmotionManager({
    sessionId,
    goals: profile.goals,
    standards: profile.standards,
    attitudes: profile.attitudes,
  });
  await manager.initialize();
  managers.set(sessionId, { manager, initialized: true });
  return manager;
}

async function resolvePersonaPrompt(personality: string | null): Promise<string> {
  if (!personality) {
    return "";
  }
  const cached = personaPromptCache.get(personality);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const info = await loadPersonality(personality);
    const prompt = info.prompt_content ?? "";
    personaPromptCache.set(personality, prompt);
    return prompt;
  } catch {
    personaPromptCache.set(personality, "");
    return "";
  }
}

function getTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return "morning";
  }
  if (hour >= 12 && hour < 17) {
    return "afternoon";
  }
  if (hour >= 17 && hour < 21) {
    return "evening";
  }
  return "night";
}

async function getManagerEntry(sessionId: number): Promise<ManagerEntry | null> {
  const entry = managers.get(sessionId);
  if (!entry) {
    return null;
  }
  if (!entry.initialized) {
    await entry.manager.initialize();
    entry.initialized = true;
  }
  return entry;
}

export async function flushGlobalEmotionBatch(): Promise<void> {
  const entry = await getManagerEntry(GLOBAL_EMOTION_SESSION_ID);
  if (!entry) {
    return;
  }
  if (entry.manager.hasPendingStimuli()) {
    await entry.manager.flushBatch();
  }
}

export async function bufferEmotionStimulus(args: {
  sessionId: number;
  prompt: string;
  personality: string | null;
  workingDir: string;
  messageType?: string;
  conversationId?: number | null;
  sessionDurationMinutes?: number | null;
}): Promise<void> {
  const manager = await getManager(GLOBAL_EMOTION_SESSION_ID);
  const timestamp = Date.now();
  const stimulusText = trimStimulusInput(args.prompt);
  const now = new Date();
  const personaPrompt = await resolvePersonaPrompt(args.personality);

  manager.bufferStimulus({
    stimulus: {
      type: "user_message",
      content: stimulusText,
      message_type: args.messageType ?? "user",
      session_id: args.sessionId,
    },
    context: {
      conversation_id: String(args.conversationId ?? args.sessionId),
      personality: args.personality ?? "",
      temporal: {
        hour: now.getHours(),
        day_of_week: now.toLocaleDateString("en-US", { weekday: "long" }),
        time_of_day: getTimeOfDay(now.getHours()),
      },
      session: {
        duration_minutes:
          typeof args.sessionDurationMinutes === "number"
            ? Math.max(0, Math.floor(args.sessionDurationMinutes))
            : undefined,
        working_dir: args.workingDir,
      },
    },
    personaPrompt,
    timestamp,
  });

  if (manager.pendingCount() >= EMOTION_BATCH_LIMIT) {
    await manager.flushBatch();
  }
}

export async function bufferInteractionStimulus(args: {
  sessionId: number;
  prompt: string;
  responseText: string;
  toolCount: number;
  personality: string | null;
  workingDir: string;
}): Promise<void> {
  const manager = await getManager(GLOBAL_EMOTION_SESSION_ID);
  const timestamp = Date.now();
  const stimulusText = trimStimulusInput(args.prompt);
  const now = new Date();
  const personaPrompt = await resolvePersonaPrompt(args.personality);

  manager.bufferStimulus({
    stimulus: {
      type: "agent_interaction",
      role: "user",
      message: stimulusText,
      response: args.responseText ? args.responseText.slice(0, 500) : "",
      tool_usage: args.toolCount > 0,
    },
    context: {
      conversation_id: String(args.sessionId),
      personality: args.personality ?? "",
      temporal: {
        hour: now.getHours(),
        day_of_week: now.toLocaleDateString("en-US", { weekday: "long" }),
      },
      session: {
        working_dir: args.workingDir,
      },
    },
    personaPrompt,
    timestamp,
  });

  if (manager.pendingCount() >= EMOTION_BATCH_LIMIT) {
    await manager.flushBatch();
  }
}

export function startEmotionLoop(): void {
  if (loopTimer) {
    return;
  }

  loopTimer = setInterval(() => {
    void processEmotionLoop();
  }, EMOTION_CHECK_INTERVAL_MS);

  log.emotion.info("Emotion loop started", { intervalMs: EMOTION_CHECK_INTERVAL_MS });
}

export function stopEmotionLoop(): void {
  if (!loopTimer) {
    return;
  }
  clearInterval(loopTimer);
  loopTimer = null;
  log.emotion.info("Emotion loop stopped");
}

async function processEmotionLoop(): Promise<void> {
  for (const [sessionId, entry] of managers.entries()) {
    if (!entry.initialized) {
      await entry.manager.initialize();
      entry.initialized = true;
    }

    const manager = entry.manager;
    if (manager.hasPendingStimuli()) {
      const idleTime = Date.now() - manager.getLastStimulusTime();
      if (idleTime >= EMOTION_IDLE_TIMEOUT_MS) {
        try {
          await manager.flushBatch();
        } catch (error) {
          log.emotion.warn("Batch appraisal failed", { sessionId, error: String(error) });
        }
      }
    }

    try {
      await manager.applyDecay();
    } catch (error) {
      log.emotion.warn("Decay failed", { sessionId, error: String(error) });
    }
  }
}
