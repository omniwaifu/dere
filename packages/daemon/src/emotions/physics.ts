export type EmotionCharacteristics = {
  valence: "positive" | "negative" | "neutral";
  arousal: "high" | "medium" | "low";
  persistence: "sticky" | "normal" | "fleeting";
  social_relevance: "high" | "medium" | "low";
  action_tendency: "approach" | "avoid" | "freeze" | "neutral";
};

export type EmotionInstance = {
  type: string;
  intensity: number;
  last_updated: number;
};

export type EmotionPhysicsContext = {
  current_emotions: Record<string, EmotionInstance>;
  recent_stimuli_history: Array<{ timestamp: number; valence: number }>;
  time_since_last_major_change: number;
  social_context?: Record<string, unknown> | null;
};

export type EmotionPhysicsResult = {
  final_intensity: number;
  momentum_resistance: number;
  valence_damping: number;
  personality_pull: number;
  diminishing_factor: number;
  contextual_bias: number;
  reasoning: string;
};

type EmotionFactors = {
  momentum_resistance: number;
  valence_damping: number;
  diminishing_factor: number;
  contextual_bias: number;
};

const EMOTION_PHYSICS_CONSTANTS = {
  MOMENTUM_FACTOR: 0.8,
  POSITIVE_NEGATIVE_INTERFERENCE: 0.7,
  PERSONALITY_DRIFT_RATE: 0.02,
  REPETITION_DECAY_FACTOR: 0.3,
  MOOD_BIAS_FACTOR: 0.4,
  BUFFERING_THRESHOLD: 60,
  BUFFERING_STRENGTH: 0.5,
} as const;

export const EMOTION_CHARACTERISTICS: Record<string, EmotionCharacteristics> & {
  neutral: EmotionCharacteristics;
} = {
  joy: {
    valence: "positive",
    arousal: "high",
    persistence: "normal",
    social_relevance: "medium",
    action_tendency: "approach",
  },
  hope: {
    valence: "positive",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "low",
    action_tendency: "approach",
  },
  satisfaction: {
    valence: "positive",
    arousal: "medium",
    persistence: "normal",
    social_relevance: "low",
    action_tendency: "approach",
  },
  relief: {
    valence: "positive",
    arousal: "low",
    persistence: "fleeting",
    social_relevance: "low",
    action_tendency: "neutral",
  },
  "happy-for": {
    valence: "positive",
    arousal: "medium",
    persistence: "normal",
    social_relevance: "high",
    action_tendency: "approach",
  },
  pride: {
    valence: "positive",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "medium",
    action_tendency: "approach",
  },
  admiration: {
    valence: "positive",
    arousal: "low",
    persistence: "normal",
    social_relevance: "high",
    action_tendency: "approach",
  },
  love: {
    valence: "positive",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "high",
    action_tendency: "approach",
  },
  gratitude: {
    valence: "positive",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "high",
    action_tendency: "approach",
  },
  gratification: {
    valence: "positive",
    arousal: "high",
    persistence: "normal",
    social_relevance: "low",
    action_tendency: "approach",
  },
  interest: {
    valence: "positive",
    arousal: "medium",
    persistence: "normal",
    social_relevance: "low",
    action_tendency: "approach",
  },
  distress: {
    valence: "negative",
    arousal: "high",
    persistence: "sticky",
    social_relevance: "medium",
    action_tendency: "avoid",
  },
  fear: {
    valence: "negative",
    arousal: "high",
    persistence: "sticky",
    social_relevance: "low",
    action_tendency: "freeze",
  },
  disappointment: {
    valence: "negative",
    arousal: "medium",
    persistence: "normal",
    social_relevance: "low",
    action_tendency: "avoid",
  },
  "fears-confirmed": {
    valence: "negative",
    arousal: "high",
    persistence: "sticky",
    social_relevance: "low",
    action_tendency: "freeze",
  },
  pity: {
    valence: "negative",
    arousal: "low",
    persistence: "normal",
    social_relevance: "high",
    action_tendency: "approach",
  },
  gloating: {
    valence: "negative",
    arousal: "medium",
    persistence: "fleeting",
    social_relevance: "high",
    action_tendency: "approach",
  },
  resentment: {
    valence: "negative",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "high",
    action_tendency: "avoid",
  },
  shame: {
    valence: "negative",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "high",
    action_tendency: "avoid",
  },
  reproach: {
    valence: "negative",
    arousal: "medium",
    persistence: "normal",
    social_relevance: "high",
    action_tendency: "avoid",
  },
  hate: {
    valence: "negative",
    arousal: "high",
    persistence: "sticky",
    social_relevance: "high",
    action_tendency: "avoid",
  },
  anger: {
    valence: "negative",
    arousal: "high",
    persistence: "normal",
    social_relevance: "high",
    action_tendency: "approach",
  },
  remorse: {
    valence: "negative",
    arousal: "medium",
    persistence: "sticky",
    social_relevance: "medium",
    action_tendency: "avoid",
  },
  disgust: {
    valence: "negative",
    arousal: "medium",
    persistence: "normal",
    social_relevance: "low",
    action_tendency: "avoid",
  },
  neutral: {
    valence: "neutral",
    arousal: "low",
    persistence: "normal",
    social_relevance: "low",
    action_tendency: "neutral",
  },
};

export class EmotionPhysics {
  calculateIntensityChange(
    emotionType: string,
    rawIntensityDelta: number,
    context: EmotionPhysicsContext,
  ): EmotionPhysicsResult {
    const characteristics = EMOTION_CHARACTERISTICS[emotionType] ?? EMOTION_CHARACTERISTICS.neutral;
    const current = context.current_emotions[emotionType];
    const currentIntensity = current?.intensity ?? 0;

    const momentumResistance = this.calculateMomentum(currentIntensity, characteristics);
    const valenceDamping = this.calculateValenceCompetition(
      emotionType,
      characteristics,
      context.current_emotions,
    );
    const diminishingFactor = this.calculateDiminishingReturns(
      characteristics,
      context.recent_stimuli_history,
    );
    const contextualBias = this.calculateContextualBias(
      rawIntensityDelta,
      context.current_emotions,
      characteristics,
    );

    let adjustedDelta = rawIntensityDelta;
    adjustedDelta *= 1 - momentumResistance;
    adjustedDelta *= 1 - valenceDamping;
    adjustedDelta *= diminishingFactor;
    adjustedDelta += contextualBias;

    const finalIntensity = Math.max(0, Math.min(100, currentIntensity + adjustedDelta));

    return {
      final_intensity: finalIntensity,
      momentum_resistance: momentumResistance,
      valence_damping: valenceDamping,
      personality_pull: 0,
      diminishing_factor: diminishingFactor,
      contextual_bias: contextualBias,
      reasoning: this.generateReasoning(
        emotionType,
        rawIntensityDelta,
        adjustedDelta,
        currentIntensity,
        finalIntensity,
        {
          momentum_resistance: momentumResistance,
          valence_damping: valenceDamping,
          diminishing_factor: diminishingFactor,
          contextual_bias: contextualBias,
        },
      ),
    };
  }

  private calculateMomentum(
    currentIntensity: number,
    characteristics: EmotionCharacteristics,
  ): number {
    const base = Math.pow(currentIntensity / 100, 2) * EMOTION_PHYSICS_CONSTANTS.MOMENTUM_FACTOR;
    const persistenceMultiplier =
      characteristics.persistence === "sticky"
        ? 1.3
        : characteristics.persistence === "fleeting"
          ? 0.7
          : 1.0;
    return base * persistenceMultiplier;
  }

  private calculateValenceCompetition(
    emotionType: string,
    characteristics: EmotionCharacteristics,
    current: Record<string, EmotionInstance>,
  ): number {
    if (characteristics.valence === "neutral") {
      return 0;
    }
    let oppositeStrength = 0;
    for (const [key, emotion] of Object.entries(current)) {
      if (key === "neutral" || key === emotionType) {
        continue;
      }
      const other = EMOTION_CHARACTERISTICS[key];
      if (!other) {
        continue;
      }
      const isOpposite =
        (characteristics.valence === "positive" && other.valence === "negative") ||
        (characteristics.valence === "negative" && other.valence === "positive");
      if (isOpposite) {
        oppositeStrength += emotion.intensity;
      }
    }
    return Math.min(
      EMOTION_PHYSICS_CONSTANTS.POSITIVE_NEGATIVE_INTERFERENCE,
      (oppositeStrength / 200) * EMOTION_PHYSICS_CONSTANTS.POSITIVE_NEGATIVE_INTERFERENCE,
    );
  }

  private calculateDiminishingReturns(
    characteristics: EmotionCharacteristics,
    recentHistory: Array<{ timestamp: number; valence: number }>,
  ): number {
    const now = Date.now();
    const recentWindow = 10 * 60 * 1000;
    let similarCount = 0;
    for (const stimulus of recentHistory) {
      if (now - stimulus.timestamp < recentWindow) {
        const isPositiveStimulus = stimulus.valence > 0;
        const isPositiveEmotion = characteristics.valence === "positive";
        if (isPositiveStimulus === isPositiveEmotion) {
          similarCount += 1;
        }
      }
    }
    return Math.max(0.1, 1 - similarCount * EMOTION_PHYSICS_CONSTANTS.REPETITION_DECAY_FACTOR);
  }

  private calculateContextualBias(
    rawDelta: number,
    current: Record<string, EmotionInstance>,
    characteristics: EmotionCharacteristics,
  ): number {
    let dominant: EmotionInstance | null = null;
    for (const emotion of Object.values(current)) {
      if (emotion.type !== "neutral" && (!dominant || emotion.intensity > dominant.intensity)) {
        dominant = emotion;
      }
    }
    if (!dominant || dominant.intensity < 30) {
      return 0;
    }
    const dominantChar = EMOTION_CHARACTERISTICS[dominant.type];
    if (!dominantChar) {
      return 0;
    }

    let bias = 0;
    if (dominantChar.valence === "negative") {
      if (characteristics.valence === "negative") {
        bias = dominant.intensity * 0.01 * EMOTION_PHYSICS_CONSTANTS.MOOD_BIAS_FACTOR;
      } else if (characteristics.valence === "positive") {
        bias = -dominant.intensity * 0.005 * EMOTION_PHYSICS_CONSTANTS.MOOD_BIAS_FACTOR;
      }
    } else if (dominantChar.valence === "positive") {
      if (characteristics.valence === "positive") {
        bias = dominant.intensity * 0.005 * EMOTION_PHYSICS_CONSTANTS.MOOD_BIAS_FACTOR;
      } else if (characteristics.valence === "negative") {
        bias = -dominant.intensity * 0.01 * EMOTION_PHYSICS_CONSTANTS.MOOD_BIAS_FACTOR;
      }
    }

    return bias;
  }

  private generateReasoning(
    emotionType: string,
    rawDelta: number,
    adjustedDelta: number,
    currentIntensity: number,
    finalIntensity: number,
    factors: EmotionFactors,
  ): string {
    const parts: string[] = [];
    parts.push(`${emotionType} change: ${rawDelta.toFixed(1)} -> ${adjustedDelta.toFixed(1)}`);
    if (factors.momentum_resistance > 0.1) {
      parts.push(`momentum resistance: ${(factors.momentum_resistance * 100).toFixed(0)}%`);
    }
    if (factors.valence_damping > 0.1) {
      parts.push(`valence competition: ${(factors.valence_damping * 100).toFixed(0)}%`);
    }
    if (factors.diminishing_factor < 0.9) {
      parts.push(`diminishing returns: ${(factors.diminishing_factor * 100).toFixed(0)}%`);
    }
    if (Math.abs(factors.contextual_bias) > 1) {
      const sign = factors.contextual_bias > 0 ? "+" : "";
      parts.push(`mood bias: ${sign}${factors.contextual_bias.toFixed(1)}`);
    }
    parts.push(`final: ${currentIntensity.toFixed(1)} -> ${finalIntensity.toFixed(1)}`);
    return parts.join(", ");
  }
}
