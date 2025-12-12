import { useState, useRef, useEffect } from "react";
import { FolderOpen, Loader2, ArrowUp, ChevronDown, User, Palette, Cpu, Brain, Shield, Globe } from "lucide-react";
import { useChatStore } from "@/stores/chat";
import {
  usePersonalities,
  useOutputStyles,
  useModels,
  useRecentDirectories,
} from "@/hooks/queries";
import { usePresets } from "@/hooks/usePresets";
import type { Preset } from "@/lib/presets";
import type { SessionConfig } from "@/types/api";
import { cn } from "@/lib/utils";
import { ShootingStars } from "@/components/ui/shooting-stars";
import { StarsBackground } from "@/components/ui/stars-background";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [sandboxMountType, setSandboxMountType] = useState<"direct" | "copy" | "none">("copy");
  const [webEnabled, setWebEnabled] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showDirDropdown, setShowDirDropdown] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("off");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const status = useChatStore((s) => s.status);
  const newSession = useChatStore((s) => s.newSession);

  const { data: personalities } = usePersonalities();
  const { data: outputStyles } = useOutputStyles();
  const { data: models } = useModels();
  const { data: recentDirs } = useRecentDirectories();
  const { presets, addPreset, deletePreset } = usePresets("session");

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

  // NOTE: Navigation to new session is handled by ChatView, not here.
  // This prevents navigating when a background session_ready arrives.

  // Derived state for validation
  const isEmptySandbox = sandboxEnabled && sandboxMountType === "none";
  const dangerousCopyPaths = ["/", "/home", "/usr", "/var", "/etc", "/opt", "/root"];
  const isCopyMode = sandboxEnabled && sandboxMountType === "copy";
  const normalizedDir = workingDir.trim().replace(/\/+$/, "") || "/";
  const isDangerousCopy = isCopyMode && dangerousCopyPaths.includes(normalizedDir);
  const canSubmit = (isEmptySandbox || workingDir.trim()) && status === "connected" && !isCreating && !isDangerousCopy;

  const handleSubmit = () => {
    if (!canSubmit) return;

    setIsCreating(true);
    const defaultToolsWithoutWeb = ["Read", "Write", "Bash", "Edit", "Glob", "Grep"];
    const config: SessionConfig = {
      working_dir: workingDir.trim(),
      output_style: outputStyle,
      personality: personality || undefined,
      model: model || undefined,
      include_context: true,
      enable_streaming: true,
      thinking_budget: thinkingEnabled ? 10000 : null,
      sandbox_mode: sandboxEnabled || undefined,
      sandbox_mount_type: sandboxEnabled ? sandboxMountType : undefined,
      allowed_tools: webEnabled ? undefined : defaultToolsWithoutWeb,
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

  const applyPreset = (preset: Preset) => {
    const c = preset.config;
    if (c.working_dir !== undefined) setWorkingDir(c.working_dir);
    if (c.output_style !== undefined) setOutputStyle(c.output_style || "web");
    if (c.personality !== undefined) setPersonality(typeof c.personality === "string" ? c.personality : "");
    if (c.model !== undefined) setModel(c.model || "");
    if (c.thinking_enabled !== undefined) setThinkingEnabled(!!c.thinking_enabled);
    if (c.sandbox_mode !== undefined) setSandboxEnabled(!!c.sandbox_mode);
    if (c.sandbox_mount_type !== undefined) setSandboxMountType(c.sandbox_mount_type);
    if (c.web_enabled !== undefined) setWebEnabled(!!c.web_enabled);
  };

  const handlePresetChange = (id: string) => {
    setSelectedPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) applyPreset(preset);
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    addPreset(name, "session", {
      working_dir: workingDir.trim() || undefined,
      output_style: outputStyle,
      personality: personality || undefined,
      model: model || undefined,
      thinking_enabled: thinkingEnabled,
      sandbox_mode: sandboxEnabled,
      sandbox_mount_type: sandboxMountType,
      web_enabled: webEnabled,
    });
    setPresetName("");
    setSavePresetOpen(false);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 relative overflow-hidden">
      <StarsBackground className="z-0" />
      <ShootingStars
        starColor="hsl(240 5% 84%)"
        trailColor="hsl(240 5% 65%)"
        className="z-0"
      />
      <div className="w-full max-w-2xl space-y-8 relative z-10">
        {/* Greeting */}
        <h1 className="text-center text-3xl font-light text-foreground/80">
          {greeting}
        </h1>

        {/* Main input card */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* Working directory section */}
          <div className="relative border-b border-border p-3">
            <div className="flex items-center gap-2">
              {/* Preset selector */}
              <div className="group relative flex items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors border-border text-muted-foreground">
                <select
                  value={selectedPresetId}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="cursor-pointer bg-transparent text-xs focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
                >
                  <option value="off">Preset</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sandbox mode selector */}
              <div
                className={cn(
                  "group relative flex items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors",
                  sandboxEnabled
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "border-border text-muted-foreground"
                )}
              >
                <Shield className="h-3.5 w-3.5" />
                <select
                  value={sandboxEnabled ? sandboxMountType : "off"}
                  onChange={(e) => {
                    if (e.target.value === "off") {
                      setSandboxEnabled(false);
                    } else {
                      setSandboxEnabled(true);
                      setSandboxMountType(e.target.value as "direct" | "copy" | "none");
                    }
                  }}
                  className="cursor-pointer bg-transparent text-xs focus:outline-none [&>option]:bg-popover [&>option]:text-popover-foreground"
                >
                  <option value="off">Off</option>
                  <option value="copy">Copy</option>
                  <option value="direct">Direct</option>
                  <option value="none">Empty</option>
                </select>
                {/* Hover tooltip */}
                <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg group-hover:block">
                  <div className="font-medium mb-1">Sandbox Mode</div>
                  <div className="space-y-1 text-muted-foreground">
                    <div><span className="text-foreground">Off:</span> Run locally, full access</div>
                    <div><span className="text-foreground">Copy:</span> Copy files to temp container</div>
                    <div><span className="text-foreground">Direct:</span> Mount directory in container</div>
                    <div><span className="text-foreground">Empty:</span> Empty container, no files</div>
                  </div>
                </div>
              </div>

              {/* Web toggle */}
              <button
                type="button"
                onClick={() => setWebEnabled((v) => !v)}
                className={cn(
                  "group relative flex items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors",
                  webEnabled
                    ? "border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "border-border text-muted-foreground"
                )}
                title={webEnabled ? "WebFetch enabled" : "WebFetch disabled"}
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="text-xs">Web</span>
                <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg group-hover:block">
                  <div className="font-medium mb-1">Web Access</div>
                  <div className="text-muted-foreground">
                    Toggles the WebFetch tool. Turn off to prevent any internet access.
                  </div>
                </div>
              </button>

              <FolderOpen className={cn("h-4 w-4", isEmptySandbox ? "text-muted-foreground/50" : "text-muted-foreground")} />
              <input
                ref={dirInputRef}
                type="text"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                onFocus={() => !isEmptySandbox && setShowDirDropdown(true)}
                disabled={isEmptySandbox}
                placeholder={isEmptySandbox ? "Not used in empty sandbox" : "Working directory"}
                className={cn(
                  "flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none",
                  isEmptySandbox && "cursor-not-allowed opacity-50"
                )}
              />
              {recentDirs?.directories && recentDirs.directories.length > 0 && !isEmptySandbox && (
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

          {/* Preset save / manage */}
          <div className="border-b border-border px-3 py-2">
            <Collapsible open={savePresetOpen} onOpenChange={setSavePresetOpen}>
              <div className="flex items-center justify-between">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Save current as preset
                  </Button>
                </CollapsibleTrigger>
                {selectedPresetId !== "off" &&
                  presets.find((p) => p.id === selectedPresetId && !p.is_default) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        deletePreset(selectedPresetId);
                        setSelectedPresetId("off");
                      }}
                    >
                      Delete preset
                    </Button>
                  )}
              </div>
              <CollapsibleContent className="mt-2 flex gap-2">
                <Input
                  placeholder="Preset name"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <Button onClick={handleSavePreset} disabled={!presetName.trim()}>
                  Save
                </Button>
              </CollapsibleContent>
            </Collapsible>
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

        {/* Warning messages */}
        {isDangerousCopy && (
          <p className="text-center text-sm text-amber-600 dark:text-amber-400">
            Copy mode with "{normalizedDir}" would copy too much data. Use Direct or Empty instead.
          </p>
        )}

        {/* Connection status hint (only after brief grace period) */}
        {status !== "connected" && (
          <DisconnectedHint />
        )}
      </div>
    </div>
  );
}

function DisconnectedHint() {
  const disconnectedAt = useChatStore((s) => s.disconnectedAt);
  const status = useChatStore((s) => s.status);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === "connected" || !disconnectedAt) {
      setShow(false);
      return;
    }
    const timeout = window.setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(timeout);
  }, [status, disconnectedAt]);

  if (!show) return null;
  return (
    <p className="text-center text-sm text-muted-foreground">
      Connecting to server...
    </p>
  );
}
