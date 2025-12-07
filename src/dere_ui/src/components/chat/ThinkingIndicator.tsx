import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ThinkingIndicatorProps {
  thinking?: string;
  thinkingDuration?: number;
  isStreaming?: boolean;
}

export function ThinkingIndicator({
  thinking,
  thinkingDuration,
  isStreaming,
}: ThinkingIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Actively thinking = streaming but no duration calculated yet AND has thinking content
  const isActivelyThinking = isStreaming && !thinkingDuration && !!thinking;

  // Live timer while thinking
  useEffect(() => {
    if (!isActivelyThinking) return;

    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 100);

    return () => clearInterval(interval);
  }, [isActivelyThinking]);

  // Only render if we have thinking content
  if (!thinking) return null;

  const displayDuration = thinkingDuration ?? elapsed;
  const formattedDuration = displayDuration.toFixed(1);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={cn(
            "h-4 w-4 transition-transform",
            expanded && "rotate-90"
          )}
        />

        {isActivelyThinking ? (
          <>
            <ThinkingDots />
            <span>Thinking...</span>
          </>
        ) : (
          <span>
            {thinkingDuration !== undefined ? `Thought for ${formattedDuration}s` : "Thought process"}
          </span>
        )}
      </CollapsibleTrigger>

      {thinking && (
        <CollapsibleContent>
          <div className="mt-1 rounded border border-border bg-muted/50 p-2">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {thinking}
            </p>
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function ThinkingDots() {
  return (
    <div className="grid h-4 w-4 grid-cols-3 gap-[2px]">
      {[...Array(9)].map((_, i) => (
        <div
          key={i}
          className="h-1 w-1 rounded-full bg-muted-foreground"
          style={{
            animation: "thinking-pulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes thinking-pulse {
          0%, 100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
