import React from 'react';
import { Sparkles, Zap } from 'lucide-react';
import { getPersonalityMeta } from '@/data/personalities';
import type { PersonalityType } from '@/types/dere';

interface AvatarPreviewProps {
  personality?: PersonalityType | null;
  moodScore?: number;
  modeLabel?: string;
  variant?: 'sidebar' | 'card';
}

export const AvatarPreview: React.FC<AvatarPreviewProps> = ({
  personality = 'dere',
  moodScore = 78,
  modeLabel = 'Mindfulness Draft',
  variant = 'sidebar',
}) => {
  const meta = getPersonalityMeta(personality);
  const isCompact = variant === 'card';

  return (
    <div
      className={`flex flex-col ${isCompact ? 'p-4 sm:p-6 gap-4' : 'p-6 xl:p-8 gap-6'}`}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.32em] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-amber-300" />
              Persona
            </div>
            <h2 className="mt-2 text-lg font-semibold text-foreground">
              {meta.displayName}
            </h2>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-card/70 px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {modeLabel}
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {meta.description}
        </p>
      </div>

      <div className="relative">
        <div
          className={`rounded-3xl border border-border/70 bg-background/70 p-4 ${
            isCompact ? 'h-56' : 'h-72'
          } flex items-center justify-center`}
        >
          <div
            className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ${meta.gradient} border border-white/10`}
          >
            <div className="absolute inset-0 bg-noise opacity-10 mix-blend-soft-light" />
            <div className="absolute bottom-4 right-4 flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/70">
              <Zap className="h-3 w-3" />
              VRoid slot ready
            </div>
            <div className="relative">
              <div className={`h-32 w-32 rounded-full blur-2xl ${meta.aura}`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-24 w-24 rounded-full border border-white/50 bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-border/60 bg-card/50 p-3">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Mood</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">
            {moodScore}
            <span className="ml-1 text-xs text-muted-foreground">/100</span>
          </dd>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/50 p-3">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Presence</dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">
            Ambient
          </dd>
        </div>
      </dl>

      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <h3 className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
          Tone Fragments
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {meta.affirmations.map((line) => (
            <li key={line} className="leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

