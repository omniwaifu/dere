import type {
  SessionConfig,
  SessionResponse,
  SessionListResponse,
  MessageHistoryResponse,
  AvailableOutputStylesResponse,
  AvailablePersonalitiesResponse,
  AvailableModelsResponse,
  RecentDirectoriesResponse,
  EmotionStateResponse,
  EmotionSummaryResponse,
} from "@/types/api";

const API_BASE = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response.json();
}

export const api = {
  sessions: {
    list: () => fetchJson<SessionListResponse>("/agent/sessions"),

    get: (id: number) => fetchJson<SessionResponse>(`/agent/sessions/${id}`),

    create: (config: SessionConfig) =>
      fetchJson<SessionResponse>("/agent/sessions", {
        method: "POST",
        body: JSON.stringify(config),
      }),

    update: (id: number, config: SessionConfig) =>
      fetchJson<SessionResponse>(`/agent/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(config),
      }),

    delete: (id: number) =>
      fetchJson<{ status: string; session_id: number }>(
        `/agent/sessions/${id}`,
        { method: "DELETE" }
      ),

    messages: (
      id: number,
      params?: { limit?: number; before_timestamp?: number }
    ) => {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.before_timestamp)
        searchParams.set("before_timestamp", String(params.before_timestamp));
      const query = searchParams.toString();
      return fetchJson<MessageHistoryResponse>(
        `/agent/sessions/${id}/messages${query ? `?${query}` : ""}`
      );
    },

    generateName: (id: number) =>
      fetchJson<{ name: string; generated: boolean }>(
        `/agent/sessions/${id}/generate-name`,
        { method: "POST" }
      ),
  },

  metadata: {
    outputStyles: () =>
      fetchJson<AvailableOutputStylesResponse>("/agent/output-styles"),

    personalities: () =>
      fetchJson<AvailablePersonalitiesResponse>("/agent/personalities"),

    models: () => fetchJson<AvailableModelsResponse>("/agent/models"),

    recentDirectories: () =>
      fetchJson<RecentDirectoriesResponse>("/agent/recent-directories"),
  },

  emotion: {
    state: (sessionId: number) =>
      fetchJson<EmotionStateResponse>(`/emotion/state/${sessionId}`),

    summary: (sessionId: number) =>
      fetchJson<EmotionSummaryResponse>(`/emotion/summary/${sessionId}`),
  },

  user: {
    info: () => fetchJson<{ name: string }>("/user/info"),
  },
};
