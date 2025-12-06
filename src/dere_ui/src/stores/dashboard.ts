import { create } from "zustand";
import type {
  DashboardEmotionState,
  DashboardActivityState,
  DashboardAmbientState,
  DashboardBondState,
} from "@/types/api";
import { api } from "@/lib/api";

interface DashboardStore {
  // State
  emotion: DashboardEmotionState | null;
  activity: DashboardActivityState | null;
  ambient: DashboardAmbientState | null;
  bond: DashboardBondState | null;
  attentionCue: string | null;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;

  // Polling
  pollingInterval: number | null;

  // Computed CSS values
  moodHue: number;
  moodCssVar: string;

  // Actions
  fetchState: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
  updateMoodCss: () => void;
}

const DEFAULT_POLL_INTERVAL = 5000; // 5 seconds
const DEFAULT_HUE = 220; // Cool gray-blue for neutral

function hueToHsl(hue: number, saturation = 70, lightness = 50): string {
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  // Initial state
  emotion: null,
  activity: null,
  ambient: null,
  bond: null,
  attentionCue: null,
  lastUpdate: null,
  isLoading: false,
  error: null,
  pollingInterval: null,
  moodHue: DEFAULT_HUE,
  moodCssVar: hueToHsl(DEFAULT_HUE),

  fetchState: async () => {
    set({ isLoading: true, error: null });

    try {
      const data = await api.dashboard.state();

      set({
        emotion: data.emotion,
        activity: data.activity,
        ambient: data.ambient,
        bond: data.bond,
        attentionCue: data.attention_cue,
        lastUpdate: new Date(data.timestamp),
        isLoading: false,
        moodHue: data.emotion?.hue ?? DEFAULT_HUE,
        moodCssVar: hueToHsl(data.emotion?.hue ?? DEFAULT_HUE),
      });

      // Update CSS custom properties on document
      get().updateMoodCss();
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to fetch dashboard state",
      });
    }
  },

  startPolling: (intervalMs = DEFAULT_POLL_INTERVAL) => {
    const { pollingInterval, fetchState, stopPolling } = get();

    // Clear any existing interval
    if (pollingInterval !== null) {
      stopPolling();
    }

    // Initial fetch
    fetchState();

    // Start polling
    const id = window.setInterval(() => {
      fetchState();
    }, intervalMs);

    set({ pollingInterval: id });
  },

  stopPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval !== null) {
      window.clearInterval(pollingInterval);
      set({ pollingInterval: null });
    }
  },

  updateMoodCss: () => {
    const { moodHue, emotion } = get();

    // Set CSS custom properties on document root
    const root = document.documentElement;

    // Primary mood hue (for use in hsl())
    root.style.setProperty("--mood-hue", String(moodHue));

    // Pre-computed mood colors at different saturations/lightnesses
    root.style.setProperty("--mood-primary", `hsl(${moodHue}, 70%, 50%)`);
    root.style.setProperty("--mood-muted", `hsl(${moodHue}, 40%, 40%)`);
    root.style.setProperty("--mood-glow", `hsl(${moodHue}, 80%, 60%)`);
    root.style.setProperty("--mood-bg", `hsl(${moodHue}, 30%, 10%)`);

    // Intensity-based opacity for glow effects (0-1)
    const intensity = emotion?.intensity ?? 0;
    const glowOpacity = Math.min(0.8, 0.2 + intensity * 0.6);
    root.style.setProperty("--mood-glow-opacity", String(glowOpacity.toFixed(2)));

    // Intensity as percentage for width-based indicators
    root.style.setProperty("--mood-intensity", `${Math.round(intensity * 100)}%`);
  },
}));

// React hook for subscribing to mood CSS changes
export function useMoodCss() {
  const moodHue = useDashboardStore((state) => state.moodHue);
  const emotion = useDashboardStore((state) => state.emotion);

  return {
    hue: moodHue,
    type: emotion?.type ?? "neutral",
    intensity: emotion?.intensity ?? 0,
    primary: `hsl(${moodHue}, 70%, 50%)`,
    muted: `hsl(${moodHue}, 40%, 40%)`,
    glow: `hsl(${moodHue}, 80%, 60%)`,
  };
}
