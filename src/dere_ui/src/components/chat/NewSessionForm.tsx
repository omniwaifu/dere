import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, Loader2, ArrowUp, ChevronDown, User, Palette, Cpu, Brain } from "lucide-react";
import { useChatStore } from "@/stores/chat";
import {
  usePersonalities,
  useOutputStyles,
  useModels,
  useRecentDirectories,
} from "@/hooks/queries";
import type { SessionConfig } from "@/types/api";
import { cn } from "@/lib/utils";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Hello, night owl";
}

export function NewSessionForm() {
  const [workingDir, setWorkingDir] = useState("");
  const [message, setMessage] = useState("");
  const [personality, setPersonality] = useState("");
  const [outputStyle, setOutputStyle] = useState("web");
  const [model, setModel] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showDirDropdown, setShowDirDropdown] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const status = useChatStore((s) => s.status);
  const newSession = useChatStore((s) => s.newSession);
  const setOnSessionCreated = useChatStore((s) => s.setOnSessionCreated);

  const { data: personalities } = usePersonalities();
  const { data: outputStyles } = useOutputStyles();
  const { data: models } = useModels();
  const { data: recentDirs } = useRecentDirectories();

  const greeting = getGreeting();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        dirInputRef.current &&
        !dirInputRef.current.contains(event.target as Node)
      ) {
        setShowDirDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  // Navigate to new session when created
  useEffect(() => {
    setOnSessionCreated((sessionId) => {
      navigate({ to: "/chat/$sessionId", params: { sessionId: String(sessionId) } });
    });
    return () => setOnSessionCreated(null);
  }, [navigate, setOnSessionCreated]);

  const handleSubmit = () => {
    if (!workingDir.trim() || status !== "connected") return;

    setIsCreating(true);
    const config: SessionConfig = {
      working_dir: workingDir.trim(),
      output_style: outputStyle,
      personality: personality || undefined,
      model: model || undefined,
      include_context: true,
      enable_streaming: true,
      thinking_budget: thinkingEnabled ? 10000 : null,
    };
    newSession(config, message.trim() || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectDirectory = (dir: string) => {
    setWorkingDir(dir);
    setShowDirDropdown(false);
    textareaRef.current?.focus();
  };

  const canSubmit = workingDir.trim() && status === "connected" && !isCreating;

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Greeting */}
        <h1 className="text-center text-3xl font-light text-foreground/80">
          {greeting}
        </h1>

        {/* Main input card */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* Working directory section */}
          <div className="relative border-b border-border p-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <input
                ref={dirInputRef}
                type="text"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                onFocus={() => setShowDirDropdown(true)}
                placeholder="Working directory"
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              {recentDirs?.directories && recentDirs.directories.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDirDropdown(!showDirDropdown)}
                  className="rounded p-1 hover:bg-accent"
                >
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Recent directories dropdown */}
            {showDirDropdown &&
              recentDirs?.directories &&
              recentDirs.directories.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-border bg-popover shadow-lg"
                >
                  <div className="p-1">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Recent
                    </div>
                    {recentDirs.directories.map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => selectDirectory(dir)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <FolderOpen className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate">{dir}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>

          {/* Message textarea */}
          <div className="p-3">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="How can I help you today?"
              className="min-h-[80px] w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              rows={3}
            />
          </div>

          {/* Config bar */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            {/* Left side: personality, output style */}
            <div className="flex items-center gap-2">
              {/* Personality selector */}
              <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  className="cursor-pointer bg-transparent text-xs text-foreground focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
                >
                  <option value="">Default</option>
                  {personalities?.personalities.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Output style selector */}
              <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={outputStyle}
                  onChange={(e) => setOutputStyle(e.target.value)}
                  className="cursor-pointer bg-transparent text-xs text-foreground focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
                >
                  {outputStyles?.styles.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Thinking mode toggle */}
              <button
                type="button"
                onClick={() => setThinkingEnabled(!thinkingEnabled)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors",
                  thinkingEnabled
                    ? "border-foreground/30 bg-foreground/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
                title="Extended thinking mode"
              >
                <Brain className="h-3.5 w-3.5" />
                <span className="text-xs">Think</span>
              </button>
            </div>

            {/* Right side: model, submit */}
            <div className="flex items-center gap-2">
              {/* Model selector */}
              <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="cursor-pointer bg-transparent text-xs text-foreground focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
                >
                  <option value="">Default</option>
                  {models?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Submit button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Connection status hint */}
        {status !== "connected" && (
          <p className="text-center text-sm text-muted-foreground">
            Connecting to server...
          </p>
        )}
      </div>
    </div>
  );
}
