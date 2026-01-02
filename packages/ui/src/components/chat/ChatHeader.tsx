import { useEffect } from "react";
import { FolderOpen, User, Palette, Brain, Shield } from "lucide-react";
import { useChatHeaderState, useChatActions } from "@/stores/selectors";
import { usePersonalities, useOutputStyles } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { alphaHex, isHexColor } from "@/lib/color";

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

  const thinkingEnabled = !!sessionConfig.thinking_budget;

  const currentPersonality = Array.isArray(sessionConfig.personality)
    ? sessionConfig.personality.join(", ")
    : sessionConfig.personality || "default";

  const personalityInfo = personalities?.personalities.find((p) => p.name === currentPersonality);
  const personalityColor = personalityInfo?.color;
  const tintBg = isHexColor(personalityColor) ? alphaHex(personalityColor, 0.06) : undefined;
  const tintBorder = isHexColor(personalityColor) ? alphaHex(personalityColor, 0.25) : undefined;
  const avatarUrl = personalityInfo
    ? `/api/personalities/${encodeURIComponent(personalityInfo.name)}/avatar`
    : undefined;

  return (
    <header
      className="flex items-center gap-4 border-b px-4 py-3"
      style={{ backgroundColor: tintBg, borderBottomColor: tintBorder }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted/30">
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-sm font-semibold"
              style={
                personalityColor
                  ? { backgroundColor: personalityColor + "20", color: personalityColor }
                  : undefined
              }
            >
              {personalityInfo?.icon || "●"}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {sessionName && (
            <h1 className="text-sm font-semibold truncate max-w-[260px]">{sessionName}</h1>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="truncate max-w-[260px]">{sessionConfig.working_dir}</span>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
          style={{ backgroundColor: tintBg }}
        >
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

        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm",
            thinkingEnabled
              ? "border-foreground/30 bg-foreground/10 text-foreground"
              : "border-transparent text-muted-foreground",
          )}
          title={
            thinkingEnabled
              ? "Extended thinking enabled (set at session start)"
              : "Extended thinking disabled (set at session start)"
          }
        >
          <Brain className="h-4 w-4" />
        </div>

        {sessionConfig.include_context && (
          <Badge variant="secondary" className="text-xs">
            context
          </Badge>
        )}

        {sessionConfig.sandbox_mode && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400"
          >
            <Shield className="h-3 w-3" />
            sandbox
          </Badge>
        )}
      </div>
    </header>
  );
}
