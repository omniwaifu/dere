import { useMemo, useState } from "react";
import type { Preset, PresetConfig, PresetKind } from "@/lib/presets";
import { DEFAULT_PRESETS, createPreset, loadCustomPresets, saveCustomPresets } from "@/lib/presets";

export function usePresets(kindFilter: PresetKind) {
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => loadCustomPresets());

  const presets = useMemo(() => {
    const all = [...DEFAULT_PRESETS, ...customPresets];
    return all.filter((p) => p.kind === "both" || p.kind === kindFilter);
  }, [customPresets, kindFilter]);

  const addPreset = (name: string, kind: PresetKind, config: PresetConfig) => {
    const next = [...customPresets, createPreset(name, kind, config)];
    setCustomPresets(next);
    saveCustomPresets(next);
  };

  const deletePreset = (id: string) => {
    const next = customPresets.filter((p) => p.id !== id);
    setCustomPresets(next);
    saveCustomPresets(next);
  };

  return { presets, customPresets, addPreset, deletePreset };
}
