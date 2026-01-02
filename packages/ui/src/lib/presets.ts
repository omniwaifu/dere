import type { SessionConfig } from "@/types/api";

export type PresetKind = "session" | "mission" | "both";

export interface PresetConfig extends Partial<SessionConfig> {
  web_enabled?: boolean;
  thinking_enabled?: boolean;
}

export interface Preset {
  id: string;
  name: string;
  kind: PresetKind;
  config: PresetConfig;
  is_default?: boolean;
}

const STORAGE_KEY = "dere.presets.v1";

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: "default-empty-web",
    name: "Empty Sandbox + Web",
    kind: "both",
    is_default: true,
    config: {
      sandbox_mode: true,
      sandbox_mount_type: "none",
      web_enabled: true,
      thinking_enabled: false,
      model: "claude-opus-4-5",
      output_style: "default",
    },
  },
  {
    id: "default-ro-project",
    name: "Project Read‑Only (No Web)",
    kind: "both",
    is_default: true,
    config: {
      sandbox_mode: true,
      sandbox_mount_type: "copy",
      web_enabled: false,
      thinking_enabled: false,
      model: "claude-sonnet-4-5",
      output_style: "default",
    },
  },
  {
    id: "default-full-dev",
    name: "Full Project + Web",
    kind: "both",
    is_default: true,
    config: {
      sandbox_mode: true,
      sandbox_mount_type: "direct",
      web_enabled: true,
      thinking_enabled: true,
      model: "claude-opus-4-5",
      output_style: "default",
    },
  },
];

function safeParse(json: string | null): Preset[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === "string" && typeof p.name === "string");
  } catch {
    return [];
  }
}

export function loadCustomPresets(): Preset[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return safeParse(raw).map((p) => ({ ...p, is_default: false }));
}

export function saveCustomPresets(presets: Preset[]) {
  const toStore = presets.map(({ id, name, kind, config }) => ({
    id,
    name,
    kind,
    config,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
}

export function getAllPresets(): Preset[] {
  return [...DEFAULT_PRESETS, ...loadCustomPresets()];
}

export function createPreset(name: string, kind: PresetKind, config: PresetConfig): Preset {
  const id =
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, kind, config, is_default: false };
}
