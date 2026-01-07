import {
  EMOTION_CHARACTERISTICS,
  type EmotionCharacteristics,
  type EmotionInstance,
} from "./physics.js";

type EmotionDecayProfile = {
  base_decay_rate: number;
  half_life: number;
  minimum_persistence: number;
  resilience: number;
  context_sensitivity: number;
};

export type DecayContext = {
  is_user_present: boolean;
  is_user_engaged: boolean;
  recent_emotional_activity: number;
  environmental_stress: number;
  social_support: number;
  time_of_day: "morning" | "afternoon" | "evening" | "night";
  personality_stability: number;
};

export const DEFAULT_DECAY_CONTEXT: DecayContext = {
  is_user_present: false,
  is_user_engaged: false,
  recent_emotional_activity: 0.5,
  environmental_stress: 0.3,
  social_support: 0.5,
  time_of_day: "afternoon",
  personality_stability: 0.6,
};

type DecayResult = {
  new_intensity: number;
  decay_amount: number;
  reasoning: string;
  should_remove: boolean;
};

const EMOTION_DECAY_PROFILES: Record<string, EmotionDecayProfile> & {
  neutral: EmotionDecayProfile;
} = {
  joy: {
    base_decay_rate: 0.08,
    half_life: 12,
    minimum_persistence: 2,
    resilience: 0.3,
    context_sensitivity: 0.6,
  },
  hope: {
    base_decay_rate: 0.04,
    half_life: 25,
    minimum_persistence: 5,
    resilience: 0.6,
    context_sensitivity: 0.4,
  },
  satisfaction: {
    base_decay_rate: 0.06,
    half_life: 18,
    minimum_persistence: 3,
    resilience: 0.4,
    context_sensitivity: 0.5,
  },
  relief: {
    base_decay_rate: 0.12,
    half_life: 8,
    minimum_persistence: 1,
    resilience: 0.2,
    context_sensitivity: 0.7,
  },
  "happy-for": {
    base_decay_rate: 0.07,
    half_life: 15,
    minimum_persistence: 2,
    resilience: 0.3,
    context_sensitivity: 0.8,
  },
  pride: {
    base_decay_rate: 0.03,
    half_life: 30,
    minimum_persistence: 10,
    resilience: 0.7,
    context_sensitivity: 0.3,
  },
  admiration: {
    base_decay_rate: 0.05,
    half_life: 20,
    minimum_persistence: 3,
    resilience: 0.4,
    context_sensitivity: 0.6,
  },
  love: {
    base_decay_rate: 0.01,
    half_life: 60,
    minimum_persistence: 15,
    resilience: 0.9,
    context_sensitivity: 0.2,
  },
  gratitude: {
    base_decay_rate: 0.04,
    half_life: 25,
    minimum_persistence: 5,
    resilience: 0.6,
    context_sensitivity: 0.5,
  },
  gratification: {
    base_decay_rate: 0.06,
    half_life: 18,
    minimum_persistence: 4,
    resilience: 0.4,
    context_sensitivity: 0.4,
  },
  interest: {
    base_decay_rate: 0.09,
    half_life: 10,
    minimum_persistence: 1,
    resilience: 0.3,
    context_sensitivity: 0.8,
  },
  distress: {
    base_decay_rate: 0.03,
    half_life: 30,
    minimum_persistence: 8,
    resilience: 0.7,
    context_sensitivity: 0.5,
  },
  fear: {
    base_decay_rate: 0.02,
    half_life: 40,
    minimum_persistence: 10,
    resilience: 0.8,
    context_sensitivity: 0.3,
  },
  disappointment: {
    base_decay_rate: 0.05,
    half_life: 22,
    minimum_persistence: 5,
    resilience: 0.5,
    context_sensitivity: 0.6,
  },
  "fears-confirmed": {
    base_decay_rate: 0.02,
    half_life: 45,
    minimum_persistence: 12,
    resilience: 0.8,
    context_sensitivity: 0.3,
  },
  pity: {
    base_decay_rate: 0.06,
    half_life: 18,
    minimum_persistence: 3,
    resilience: 0.4,
    context_sensitivity: 0.7,
  },
  gloating: {
    base_decay_rate: 0.1,
    half_life: 7,
    minimum_persistence: 1,
    resilience: 0.2,
    context_sensitivity: 0.8,
  },
  resentment: {
    base_decay_rate: 0.02,
    half_life: 50,
    minimum_persistence: 15,
    resilience: 0.8,
    context_sensitivity: 0.4,
  },
  shame: {
    base_decay_rate: 0.02,
    half_life: 45,
    minimum_persistence: 12,
    resilience: 0.8,
    context_sensitivity: 0.3,
  },
  reproach: {
    base_decay_rate: 0.04,
    half_life: 25,
    minimum_persistence: 6,
    resilience: 0.6,
    context_sensitivity: 0.5,
  },
  hate: {
    base_decay_rate: 0.01,
    half_life: 80,
    minimum_persistence: 20,
    resilience: 0.9,
    context_sensitivity: 0.2,
  },
  anger: {
    base_decay_rate: 0.06,
    half_life: 18,
    minimum_persistence: 4,
    resilience: 0.5,
    context_sensitivity: 0.6,
  },
  remorse: {
    base_decay_rate: 0.03,
    half_life: 35,
    minimum_persistence: 10,
    resilience: 0.7,
    context_sensitivity: 0.4,
  },
  disgust: {
    base_decay_rate: 0.05,
    half_life: 20,
    minimum_persistence: 4,
    resilience: 0.5,
    context_sensitivity: 0.6,
  },
  neutral: {
    base_decay_rate: 0.15,
    half_life: 5,
    minimum_persistence: 0,
    resilience: 0.1,
    context_sensitivity: 0.9,
  },
};

export class SmartDecay {
  private readonly profiles: Record<string, EmotionDecayProfile> & {
    neutral: EmotionDecayProfile;
  };

  constructor(
    profiles: Record<string, EmotionDecayProfile> & {
      neutral: EmotionDecayProfile;
    } = EMOTION_DECAY_PROFILES,
  ) {
    this.profiles = profiles;
  }

  calculateDecay(
    emotion: EmotionInstance,
    timeDeltaMinutes: number,
    context: DecayContext = DEFAULT_DECAY_CONTEXT,
  ): DecayResult {
    if (emotion.type === "neutral") {
      return {
        new_intensity: 0,
        decay_amount: emotion.intensity,
        reasoning: "Neutral emotion removed",
        should_remove: true,
      };
    }

    const profile = this.profiles[emotion.type] ?? this.profiles.neutral;
    const characteristics =
      EMOTION_CHARACTERISTICS[emotion.type] ?? EMOTION_CHARACTERISTICS.neutral;

    const emotionAge = timeDeltaMinutes;
    if (emotionAge < profile.minimum_persistence) {
      return {
        new_intensity: emotion.intensity,
        decay_amount: 0,
        reasoning: `Too recent (${emotionAge.toFixed(1)}m < ${profile.minimum_persistence}m minimum)`,
        should_remove: false,
      };
    }

    const adjustedDecayRate = this.calculateAdjustedDecayRate(profile, characteristics, context);
    const baseDecayFactor = Math.exp(-adjustedDecayRate * timeDeltaMinutes);
    let newIntensity = emotion.intensity * baseDecayFactor;

    const resilienceProtection = Math.pow(emotion.intensity / 100, 0.5) * profile.resilience;
    newIntensity =
      emotion.intensity - (emotion.intensity - newIntensity) * (1 - resilienceProtection);

    newIntensity = this.applyContextualModifiers(
      newIntensity,
      emotion.intensity,
      characteristics,
      context,
    );

    newIntensity = Math.max(0, Math.min(100, newIntensity));
    const decayAmount = emotion.intensity - newIntensity;
    const removalThreshold = this.calculateRemovalThreshold(characteristics, context);
    const shouldRemove = newIntensity < removalThreshold;

    const reasoning = this.generateDecayReasoning(
      emotion.type,
      emotion.intensity,
      newIntensity,
      adjustedDecayRate,
      resilienceProtection,
      context,
      emotionAge,
    );

    return {
      new_intensity: shouldRemove ? 0 : newIntensity,
      decay_amount: decayAmount,
      reasoning,
      should_remove: shouldRemove,
    };
  }

  applyDecayToEmotions(
    emotions: Record<string, EmotionInstance>,
    timeDeltaMinutes: number,
    context: DecayContext = DEFAULT_DECAY_CONTEXT,
  ): {
    updated_emotions: Record<string, EmotionInstance>;
    decay_results: Array<{ type: string; result: DecayResult }>;
    total_decay_activity: number;
  } {
    const updated: Record<string, EmotionInstance> = {};
    const decayResults: Array<{ type: string; result: DecayResult }> = [];
    let totalDecayActivity = 0;
    const now = Date.now();

    for (const [emotionType, emotion] of Object.entries(emotions)) {
      const result = this.calculateDecay(emotion, timeDeltaMinutes, context);
      decayResults.push({ type: emotionType, result });
      totalDecayActivity += result.decay_amount;
      if (!result.should_remove && result.new_intensity > 0) {
        updated[emotionType] = {
          type: emotion.type,
          intensity: result.new_intensity,
          last_updated: now,
        };
      }
    }

    return {
      updated_emotions: updated,
      decay_results: decayResults,
      total_decay_activity: totalDecayActivity,
    };
  }

  private calculateAdjustedDecayRate(
    profile: EmotionDecayProfile,
    characteristics: EmotionCharacteristics,
    context: DecayContext,
  ): number {
    let adjusted = profile.base_decay_rate;

    if (!context.is_user_present) {
      if (characteristics.social_relevance === "high") {
        adjusted *= 1.3;
      } else if (characteristics.social_relevance === "medium") {
        adjusted *= 1.1;
      }
    }

    if (context.is_user_engaged) {
      adjusted *= 0.8;
    }

    if (context.recent_emotional_activity > 0.7) {
      adjusted *= 0.7;
    } else if (context.recent_emotional_activity < 0.3) {
      adjusted *= 1.2;
    }

    if (context.environmental_stress > 0.6) {
      if (characteristics.valence === "positive") {
        adjusted *= 1.4;
      } else {
        adjusted *= 0.8;
      }
    }

    if (context.social_support > 0.6) {
      if (characteristics.valence === "positive") {
        adjusted *= 0.9;
      } else if (characteristics.valence === "negative") {
        adjusted *= 1.2;
      }
    }

    if (context.time_of_day === "morning") {
      adjusted *= 1.1;
    } else if (context.time_of_day === "evening") {
      adjusted *= 0.9;
    } else if (context.time_of_day === "night" && characteristics.valence === "negative") {
      adjusted *= 0.7;
    }

    const stabilityFactor = 0.5 + context.personality_stability * 0.5;
    adjusted *= stabilityFactor;

    return Math.max(0.001, adjusted);
  }

  private applyContextualModifiers(
    newIntensity: number,
    originalIntensity: number,
    characteristics: EmotionCharacteristics,
    context: DecayContext,
  ): number {
    let modified = newIntensity;

    if (characteristics.arousal === "high" && context.recent_emotional_activity > 0.8) {
      const reboundFactor = 1.05;
      modified = newIntensity + (originalIntensity - newIntensity) * (reboundFactor - 1);
    }

    if (characteristics.persistence === "sticky") {
      if (characteristics.valence === "positive" && context.social_support > 0.7) {
        modified = newIntensity + (originalIntensity - newIntensity) * 0.1;
      } else if (characteristics.valence === "negative" && context.environmental_stress > 0.6) {
        modified = newIntensity + (originalIntensity - newIntensity) * 0.15;
      }
    }

    return Math.max(0, Math.min(100, modified));
  }

  private calculateRemovalThreshold(
    characteristics: EmotionCharacteristics,
    context: DecayContext,
  ): number {
    let threshold = 1.0;
    if (characteristics.persistence === "sticky") {
      threshold = 0.5;
    } else if (characteristics.persistence === "fleeting") {
      threshold = 2.0;
    }

    threshold *= 0.5 + context.personality_stability * 0.5;
    return threshold;
  }

  private generateDecayReasoning(
    emotionType: string,
    originalIntensity: number,
    newIntensity: number,
    decayRate: number,
    resilienceProtection: number,
    context: DecayContext,
    ageMinutes: number,
  ): string {
    const parts: string[] = [];
    parts.push(`${emotionType}: ${originalIntensity.toFixed(1)} -> ${newIntensity.toFixed(1)}`);
    parts.push(`age: ${ageMinutes.toFixed(1)}m`);
    parts.push(`rate: ${decayRate.toFixed(3)}`);

    if (resilienceProtection > 0.1) {
      parts.push(`resilience: ${(resilienceProtection * 100).toFixed(0)}%`);
    }

    if (!context.is_user_present) {
      parts.push("user away");
    }

    if (context.recent_emotional_activity > 0.7) {
      parts.push("high activity");
    } else if (context.recent_emotional_activity < 0.3) {
      parts.push("low activity");
    }

    return parts.join(", ");
  }
}
