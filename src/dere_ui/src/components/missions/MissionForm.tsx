import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePersonalities, useModels, useCreateMission, useUpdateMission } from "@/hooks/queries";
import { usePresets } from "@/hooks/usePresets";
import type { Preset } from "@/lib/presets";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Mission, CreateMissionRequest, UpdateMissionRequest } from "@/types/api";

interface MissionFormProps {
  mission?: Mission;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MissionForm({ mission, onSuccess, onCancel }: MissionFormProps) {
  const [name, setName] = useState(mission?.name ?? "");
  const [description, setDescription] = useState(mission?.description ?? "");
  const [prompt, setPrompt] = useState(mission?.prompt ?? "");
  const [schedule, setSchedule] = useState(
    mission?.natural_language_schedule ?? mission?.cron_expression ?? ""
  );
  const [personality, setPersonality] = useState(mission?.personality ?? "");
  const [model, setModel] = useState(mission?.model ?? "claude-opus-4-5");
  const [workingDir, setWorkingDir] = useState(mission?.working_dir ?? "/workspace");
  const [sandboxMode, setSandboxMode] = useState(mission?.sandbox_mode ?? true);
  const [sandboxMountType, setSandboxMountType] = useState(mission?.sandbox_mount_type ?? "none");
  const [webEnabled, setWebEnabled] = useState(() => {
    if (!mission?.allowed_tools) return true;
    return mission.allowed_tools.includes("WebFetch") || mission.allowed_tools.includes("WebSearch");
  });
  const [thinkingEnabled, setThinkingEnabled] = useState(!!mission?.thinking_budget);
  const [runOnce, setRunOnce] = useState(mission?.run_once ?? false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("off");
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  const { data: personalities } = usePersonalities();
  const { data: models } = useModels();
  const createMission = useCreateMission();
  const updateMission = useUpdateMission();
  const { presets, addPreset, deletePreset } = usePresets("mission");

  const isEditing = !!mission;
  const isSubmitting = createMission.isPending || updateMission.isPending;

  // Schedule not required for one-off missions
  const canSubmit = name.trim() && prompt.trim() && (runOnce || schedule.trim()) && !isSubmitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    // For one-off missions, use "in 1 minute" as default schedule to trigger soon
    const effectiveSchedule = runOnce && !schedule.trim() ? "in 1 minute" : schedule.trim();

    const defaultToolsWithoutWeb = ["Read", "Write", "Bash", "Edit", "Glob", "Grep"];
    let effectiveAllowedTools: string[] | undefined;
    if (mission?.allowed_tools) {
      const base = [...mission.allowed_tools];
      if (webEnabled) {
        if (!base.includes("WebSearch")) base.push("WebSearch");
        if (!base.includes("WebFetch")) base.push("WebFetch");
        effectiveAllowedTools = base;
      } else {
        effectiveAllowedTools = base.filter((t) => t !== "WebSearch" && t !== "WebFetch");
      }
    } else {
      effectiveAllowedTools = webEnabled ? undefined : defaultToolsWithoutWeb;
    }

    const data: CreateMissionRequest | UpdateMissionRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      prompt: prompt.trim(),
      schedule: effectiveSchedule,
      personality: personality || undefined,
      model,
      thinking_budget: thinkingEnabled ? 10000 : null,
      working_dir: workingDir,
      sandbox_mode: sandboxMode,
      sandbox_mount_type: sandboxMountType,
      allowed_tools: effectiveAllowedTools,
      run_once: runOnce,
    };

    if (isEditing) {
      updateMission.mutate(
        { id: mission.id, data },
        { onSuccess }
      );
    } else {
      createMission.mutate(data as CreateMissionRequest, { onSuccess });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Preset</Label>
        <div className="flex items-center gap-2">
          <Select value={selectedPresetId} onValueChange={(id) => {
            setSelectedPresetId(id);
            const preset = presets.find((p) => p.id === id);
            if (!preset) return;
            const c = preset.config as Preset["config"];
            if (c.personality !== undefined) setPersonality(typeof c.personality === "string" ? c.personality : "");
            if (c.model !== undefined) setModel(c.model || "claude-opus-4-5");
            if (c.working_dir !== undefined) setWorkingDir(c.working_dir || "/workspace");
            if (c.thinking_enabled !== undefined) setThinkingEnabled(!!c.thinking_enabled);
            if (c.sandbox_mode !== undefined) setSandboxMode(!!c.sandbox_mode);
            if (c.sandbox_mount_type !== undefined) setSandboxMountType(c.sandbox_mount_type);
            if (c.web_enabled !== undefined) setWebEnabled(!!c.web_enabled);
          }}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Choose preset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">None</SelectItem>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Collapsible open={savePresetOpen} onOpenChange={setSavePresetOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Save preset
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex items-center gap-2">
              <Input
                placeholder="Preset name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-48"
              />
              <Button
                type="button"
                size="sm"
                disabled={!presetName.trim()}
                onClick={() => {
                  const name = presetName.trim();
                  if (!name) return;
                  addPreset(name, "mission", {
                    working_dir: workingDir,
                    personality: personality || undefined,
                    model,
                    thinking_enabled: thinkingEnabled,
                    sandbox_mode: sandboxMode,
                    sandbox_mount_type: sandboxMountType,
                    web_enabled: webEnabled,
                  });
                  setPresetName("");
                  setSavePresetOpen(false);
                }}
              >
                Save
              </Button>
              {selectedPresetId !== "off" &&
                presets.find((p) => p.id === selectedPresetId && !p.is_default) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      deletePreset(selectedPresetId);
                      setSelectedPresetId("off");
                    }}
                  >
                    Delete
                  </Button>
                )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Daily news summary"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this mission does"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Summarize the top news stories from today..."
          rows={4}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <div className="font-medium text-sm">One-off Mission</div>
          <div className="text-xs text-muted-foreground">
            Run once immediately, then archive
          </div>
        </div>
        <Switch checked={runOnce} onCheckedChange={setRunOnce} />
      </div>

      {!runOnce && (
        <div className="space-y-2">
          <Label htmlFor="schedule">Schedule</Label>
          <Input
            id="schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="every day at 6pm"
          />
          <p className="text-xs text-muted-foreground">
            Use natural language (e.g., "every day at 6pm") or cron (e.g., "0 18 * * *")
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="personality">Personality</Label>
          <Select value={personality || "_default"} onValueChange={(v) => setPersonality(v === "_default" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_default">Default</SelectItem>
              {personalities?.personalities.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models?.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="workingDir">Working Directory</Label>
        <Input
          id="workingDir"
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          placeholder="/workspace"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <div className="font-medium text-sm">Sandbox Mode</div>
          <div className="text-xs text-muted-foreground">
            Run in isolated container
          </div>
        </div>
        <Switch checked={sandboxMode} onCheckedChange={setSandboxMode} />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <div className="font-medium text-sm">Thinking</div>
          <div className="text-xs text-muted-foreground">
            Enable extended thinking for mission runs
          </div>
        </div>
        <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <div className="font-medium text-sm">Web Access</div>
          <div className="text-xs text-muted-foreground">
            Allow WebFetch / internet access
          </div>
        </div>
        <Switch checked={webEnabled} onCheckedChange={setWebEnabled} />
      </div>

      {sandboxMode && (
        <div className="space-y-2">
          <Label htmlFor="sandboxMount">Mount Type</Label>
          <Select value={sandboxMountType} onValueChange={setSandboxMountType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (empty container)</SelectItem>
              <SelectItem value="copy">Copy (copy files to container)</SelectItem>
              <SelectItem value="direct">Direct (mount directory)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditing ? "Update" : "Create"} Mission
        </Button>
      </div>
    </form>
  );
}
