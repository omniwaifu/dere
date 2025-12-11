import { useEffect } from "react";
import { FolderOpen, User, Palette, Brain, Shield } from "lucide-react";
import { useChatHeaderState, useChatActions } from "@/stores/selectors";
import { usePersonalities, useOutputStyles } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ChatHeader() {
  const { sessionConfig, sessionName } = useChatHeaderState();
  const { updateConfig } = useChatActions();

  // Update document title based on session name
  useEffect(() => {
    document.title = sessionName ? `${sessionName} - dere` : "dere";
    return () => {
      document.title = "dere";
    };
  }, [sessionName]);

  const { data: personalities } = usePersonalities();
  const { data: outputStyles } = useOutputStyles();

  if (!sessionConfig) return null;

  const handlePersonalityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateConfig({ ...sessionConfig, personality: e.target.value });
  };

  const handleOutputStyleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateConfig({ ...sessionConfig, output_style: e.target.value });
  };

  const handleThinkingToggle = () => {
    const newBudget = sessionConfig.thinking_budget ? null : 10000;
    updateConfig({ ...sessionConfig, thinking_budget: newBudget });
  };

  const thinkingEnabled = !!sessionConfig.thinking_budget;

  const currentPersonality = Array.isArray(sessionConfig.personality)
    ? sessionConfig.personality.join(", ")
    : sessionConfig.personality || "default";

  return (
    <header className="flex items-center gap-4 border-b border-border/50 px-4 py-2">
      {sessionName && (
        <h1 className="text-sm font-medium truncate max-w-[200px]">
          {sessionName}
        </h1>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderOpen className="h-4 w-4" />
        <span className="truncate max-w-[200px]">
          {sessionConfig.working_dir}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <select
            value={currentPersonality}
            onChange={handlePersonalityChange}
            className="cursor-pointer rounded border-none bg-transparent text-sm focus:outline-none focus:ring-0 [&>option]:bg-popover [&>option]:text-popover-foreground"
          >
            <option value="">default</option>
            {personalities?.personalities.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <select
            value={sessionConfig.output_style || "default"}
            onChange={handleOutputStyleChange}
            className="cursor-pointer rounded border-none bg-transparent text-sm focus:outline-none focus:ring-0 [&>option]:bg-popover [&>option]:text-popover-foreground"
          >
            {outputStyles?.styles.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleThinkingToggle}
          disabled={sessionConfig.sandbox_mode}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors",
            thinkingEnabled
              ? "border-foreground/30 bg-foreground/10 text-foreground"
              : "border-transparent text-muted-foreground",
            sessionConfig.sandbox_mode
              ? "cursor-not-allowed"
              : "hover:text-foreground"
          )}
          title={sessionConfig.sandbox_mode
            ? "Thinking mode cannot be changed in sandbox sessions"
            : "Extended thinking mode"}
        >
          <Brain className="h-4 w-4" />
        </button>

        {sessionConfig.include_context && (
          <Badge variant="secondary" className="text-xs">
            context
          </Badge>
        )}

        {sessionConfig.sandbox_mode && (
          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
            <Shield className="h-3 w-3" />
            sandbox
          </Badge>
        )}
      </div>
    </header>
  );
}
