import type { PersonalityType } from '@/types/dere';

export interface PersonalityMetadata {
  id: PersonalityType;
  displayName: string;
  tagline: string;
  gradient: string;
  aura: string;
  primaryColor: string;
  secondaryColor: string;
  description: string;
  affirmations: string[];
}

export const DEFAULT_PERSONALITY: PersonalityType = 'dere';

export const PERSONALITY_LIBRARY: Record<PersonalityType, PersonalityMetadata> = {
  dere: {
    id: 'dere',
    displayName: 'Deredere',
    tagline: 'Warm, encouraging, and endlessly curious.',
    gradient: 'from-rose-500/70 via-pink-500/60 to-violet-500/70',
    aura: 'bg-gradient-to-br from-pink-400/40 via-rose-400/30 to-violet-400/30',
    primaryColor: 'text-pink-400',
    secondaryColor: 'text-pink-200',
    description:
      'Deredere leads with empathy. Expect upbeat check-ins, soft prompts, and gentle nudges toward progress.',
    affirmations: [
      'Every small step counts toward the story you are writing.',
      'Soft hearts can still hold strong boundaries.',
      'You deserve to take up space in your own timeline.',
    ],
  },
  tsun: {
    id: 'tsun',
    displayName: 'Tsundere',
    tagline: 'Direct, assertive, and fiercely protective of your growth.',
    gradient: 'from-red-500/70 via-amber-500/60 to-orange-500/70',
    aura: 'bg-gradient-to-br from-red-400/40 via-amber-400/30 to-orange-400/30',
    primaryColor: 'text-red-400',
    secondaryColor: 'text-orange-200',
    description:
      'Tsundere keeps it real with structured prompts and momentum-building accountability. A little spice, a lot of heart.',
    affirmations: [
      "Courage isn't the absence of fear—it's the decision to move forward anyway.",
      'Momentum loves a strong opening move.',
      'You already survived the hardest parts; this next step is yours to claim.',
    ],
  },
  kuu: {
    id: 'kuu',
    displayName: 'Kuudere',
    tagline: 'Calm analysis with a steady, strategic presence.',
    gradient: 'from-sky-500/70 via-cyan-500/60 to-indigo-500/70',
    aura: 'bg-gradient-to-br from-sky-400/40 via-cyan-400/30 to-indigo-400/30',
    primaryColor: 'text-sky-400',
    secondaryColor: 'text-blue-200',
    description:
      'Kuudere brings clarity and focus. Expect grounded reflections, structured plans, and measured confidence.',
    affirmations: [
      'Precision creates the room you need to breathe.',
      'Stillness is a strategy, not a stall.',
      'You can refine, recalibrate, and return—calmly.',
    ],
  },
  yan: {
    id: 'yan',
    displayName: 'Yandere',
    tagline: 'Intensely committed to your wellbeing arc.',
    gradient: 'from-purple-600/70 via-fuchsia-600/60 to-rose-600/70',
    aura: 'bg-gradient-to-br from-purple-400/40 via-fuchsia-400/30 to-rose-400/30',
    primaryColor: 'text-purple-400',
    secondaryColor: 'text-fuchsia-200',
    description:
      'Yandere channels fierce loyalty into fierce advocacy. Expect high-energy encouragement and protective reminders.',
    affirmations: [
      'Devotion to your own care is a radical act.',
      'Intensity can be directed into intentional healing.',
      'You are worth the energy it takes to feel safe.',
    ],
  },
  ero: {
    id: 'ero',
    displayName: 'Erodere',
    tagline: 'Playfully candid with an attunement to vulnerability.',
    gradient: 'from-orange-500/70 via-amber-400/60 to-rose-500/70',
    aura: 'bg-gradient-to-br from-orange-400/40 via-amber-400/30 to-rose-400/30',
    primaryColor: 'text-orange-400',
    secondaryColor: 'text-amber-200',
    description:
      'Erodere blends honesty with warmth. Expect frank reflections, authentic curiosity, and supportive humor.',
    affirmations: [
      'Tender honesty is a form of intimacy with yourself.',
      'Your joy can coexist alongside the work.',
      'Curiosity keeps the heart awake.',
    ],
  },
};

export function getPersonalityMeta(personality?: PersonalityType | null): PersonalityMetadata {
  if (!personality) {
    return PERSONALITY_LIBRARY[DEFAULT_PERSONALITY];
  }

  return PERSONALITY_LIBRARY[personality] ?? PERSONALITY_LIBRARY[DEFAULT_PERSONALITY];
}

