import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ScrollShadowProps extends React.HTMLAttributes<HTMLDivElement> {
  topShadowClassName?: string;
  bottomShadowClassName?: string;
}

export const ScrollShadow = forwardRef<HTMLDivElement, ScrollShadowProps>(
  (
    {
      children,
      className,
      topShadowClassName,
      bottomShadowClassName,
      ...props
    },
    ref,
  ) => {
    return (
      <div className="relative h-full w-full">
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background via-background/70 to-transparent transition-opacity',
            topShadowClassName,
          )}
        />
        <div
          ref={ref}
          className={cn('h-full w-full overflow-y-auto', className)}
          {...props}
        >
          {children}
        </div>
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background via-background/70 to-transparent transition-opacity',
            bottomShadowClassName,
          )}
        />
      </div>
    );
  },
);

ScrollShadow.displayName = 'ScrollShadow';

