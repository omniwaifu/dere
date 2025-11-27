import { FolderOpen, User, Palette } from "lucide-react";
import { useChatStore } from "@/stores/chat";
import { usePersonalities, useOutputStyles } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";

export function ChatHeader() {
  const sessionConfig = useChatStore((s) => s.sessionConfig);
  const updateConfig = useChatStore((s) => s.updateConfig);

  const { data: personalities } = usePersonalities();
  const { data: outputStyles } = useOutputStyles();

  if (!sessionConfig) return null;

  const handlePersonalityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateConfig({ ...sessionConfig, personality: e.target.value });
  };

  const handleOutputStyleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateConfig({ ...sessionConfig, output_style: e.target.value });
  };

  const currentPersonality = Array.isArray(sessionConfig.personality)
    ? sessionConfig.personality.join(", ")
    : sessionConfig.personality || "default";

  return (
    <header className="flex items-center gap-4 border-b border-border px-4 py-2">
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
            className="rounded border-none bg-transparent text-sm focus:outline-none focus:ring-0"
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
            className="rounded border-none bg-transparent text-sm focus:outline-none focus:ring-0"
          >
            {outputStyles?.styles.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {sessionConfig.include_context && (
          <Badge variant="secondary" className="text-xs">
            context
          </Badge>
        )}
      </div>
    </header>
  );
}
