import { create } from "zustand";
import type {
  DashboardEmotionState,
  DashboardActivityState,
  DashboardAmbientState,
} from "@/types/api";
import { api } from "@/lib/api";

interface DashboardStore {
  emotion: DashboardEmotionState | null;
  activity: DashboardActivityState | null;
  ambient: DashboardAmbientState | null;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;
  pollingInterval: number | null;

  fetchState: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

const DEFAULT_POLL_INTERVAL = 5000;

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  emotion: null,
  activity: null,
  ambient: null,
  lastUpdate: null,
  isLoading: false,
  error: null,
  pollingInterval: null,

  fetchState: async () => {
    set({ isLoading: true, error: null });

    try {
      const data = await api.dashboard.state();

      set({
        emotion: data.emotion,
        activity: data.activity,
        ambient: data.ambient,
        lastUpdate: new Date(data.timestamp),
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to fetch dashboard state",
      });
    }
  },

  startPolling: (intervalMs = DEFAULT_POLL_INTERVAL) => {
    const { pollingInterval, fetchState, stopPolling } = get();

    if (pollingInterval !== null) {
      stopPolling();
    }

    fetchState();

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
}));
