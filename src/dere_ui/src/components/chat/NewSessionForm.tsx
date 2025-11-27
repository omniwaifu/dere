import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat";
import { usePersonalities, useOutputStyles } from "@/hooks/queries";
import type { SessionConfig } from "@/types/api";

export function NewSessionForm() {
  const [workingDir, setWorkingDir] = useState("");
  const [personality, setPersonality] = useState("");
  const [outputStyle, setOutputStyle] = useState("web");
  const [isCreating, setIsCreating] = useState(false);

  const status = useChatStore((s) => s.status);
  const newSession = useChatStore((s) => s.newSession);

  const { data: personalities } = usePersonalities();
  const { data: outputStyles } = useOutputStyles();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workingDir.trim() || status !== "connected") return;

    setIsCreating(true);
    const config: SessionConfig = {
      working_dir: workingDir.trim(),
      output_style: outputStyle,
      personality: personality || undefined,
      include_context: true,
    };
    newSession(config);
  };

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">New Session</h1>
          <p className="mt-2 text-muted-foreground">
            Configure your agent session
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Working Directory</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpen className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="/path/to/project"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 pl-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Personality</label>
            <select
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Default</option>
              {personalities?.personalities.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Output Style</label>
            <select
              value={outputStyle}
              onChange={(e) => setOutputStyle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {outputStyles?.styles.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={!workingDir.trim() || status !== "connected" || isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : status !== "connected" ? (
              "Connecting..."
            ) : (
              "Start Session"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
