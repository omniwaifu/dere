import React from 'react';
import { MessageCircle, LayoutGrid, Telescope, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP = {
  chat: MessageCircle,
  tabs: LayoutGrid,
  roadmap: Telescope,
  rituals: Calendar,
} as const;

type EmptyStateIllustration = keyof typeof ICON_MAP;

interface EmptyStateProps {
  title: string;
  description?: string;
  illustration?: EmptyStateIllustration;
  className?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  illustration = 'chat',
  className,
  action,
}) => {
  const Icon = ICON_MAP[illustration];

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/40 p-8 text-center backdrop-blur',
        'transition-colors duration-200 hover:border-border',
        className,
      )}
    >
      <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background/70 text-muted-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}
      {action ? <div className="mt-6 flex items-center gap-2">{action}</div> : null}
    </div>
  );
};

