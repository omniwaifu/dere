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
  EmotionHistoryResponse,
  EmotionHistoryDBResponse,
  EmotionProfileResponse,
  TasksResponse,
  DereConfig,
  ConfigSchema,
  Mission,
  MissionExecution,
  CreateMissionRequest,
  UpdateMissionRequest,
  DashboardStateResponse,
  SummaryContextResponse,
  KGEntityListResponse,
  KGSearchResultsResponse,
  KGFactsTimelineResponse,
  KGStatsResponse,
  KGCommunitiesResponse,
  KGLabelsResponse,
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

    context: () => fetchJson<SummaryContextResponse>("/sessions/context"),

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

    rename: (id: number, name: string) =>
      fetchJson<{ name: string }>(`/agent/sessions/${id}/name`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
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
    state: () => fetchJson<EmotionStateResponse>("/emotion/state"),

    summary: () => fetchJson<EmotionSummaryResponse>("/emotion/summary"),

    history: (limit?: number) => {
      const params = limit ? `?limit=${limit}` : "";
      return fetchJson<EmotionHistoryResponse>(`/emotion/history${params}`);
    },

    historyDB: (startTime?: number, endTime?: number, limit?: number) => {
      const params = new URLSearchParams();
      if (startTime) params.set("start_time", startTime.toString());
      if (endTime) params.set("end_time", endTime.toString());
      if (limit) params.set("limit", limit.toString());
      const queryString = params.toString();
      return fetchJson<EmotionHistoryDBResponse>(
        `/emotion/history/db${queryString ? `?${queryString}` : ""}`
      );
    },

    profile: () => fetchJson<EmotionProfileResponse>("/emotion/profile"),
  },

  user: {
    info: () => fetchJson<{ name: string }>("/user/info"),
  },

  config: {
    get: () => fetchJson<DereConfig>("/config"),
    update: (updates: Partial<DereConfig>) =>
      fetchJson<DereConfig>("/config", {
        method: "PUT",
        body: JSON.stringify(updates),
      }),
    schema: () => fetchJson<ConfigSchema>("/config/schema"),
  },

  taskwarrior: {
    tasks: (params?: { status?: string; project?: string; include_completed?: boolean }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set("status", params.status);
      if (params?.project) searchParams.set("project", params.project);
      if (params?.include_completed !== undefined)
        searchParams.set("include_completed", String(params.include_completed));
      const query = searchParams.toString();
      return fetchJson<TasksResponse>(`/taskwarrior/tasks${query ? `?${query}` : ""}`);
    },
  },

  missions: {
    list: (status?: string) => {
      const params = status ? `?status=${status}` : "";
      return fetchJson<Mission[]>(`/missions${params}`);
    },

    get: (id: number) => fetchJson<Mission>(`/missions/${id}`),

    create: (data: CreateMissionRequest) =>
      fetchJson<Mission>("/missions", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    update: (id: number, data: UpdateMissionRequest) =>
      fetchJson<Mission>(`/missions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    delete: (id: number) =>
      fetchJson<{ status: string; id: number }>(`/missions/${id}`, {
        method: "DELETE",
      }),

    pause: (id: number) =>
      fetchJson<Mission>(`/missions/${id}/pause`, { method: "POST" }),

    resume: (id: number) =>
      fetchJson<Mission>(`/missions/${id}/resume`, { method: "POST" }),

    execute: (id: number) =>
      fetchJson<{ status: string; mission_id: number }>(`/missions/${id}/execute`, {
        method: "POST",
      }),

    executions: (id: number, limit?: number) => {
      const params = limit ? `?limit=${limit}` : "";
      return fetchJson<MissionExecution[]>(`/missions/${id}/executions${params}`);
    },

    execution: (missionId: number, executionId: number) =>
      fetchJson<MissionExecution>(`/missions/${missionId}/executions/${executionId}`),
  },

  dashboard: {
    state: () => fetchJson<DashboardStateResponse>("/dashboard/state"),
  },

  knowledge: {
    entities: (params?: {
      labels?: string[];
      sort_by?: string;
      sort_order?: "asc" | "desc";
      limit?: number;
      offset?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.labels) params.labels.forEach((l) => searchParams.append("labels", l));
      if (params?.sort_by) searchParams.set("sort_by", params.sort_by);
      if (params?.sort_order) searchParams.set("sort_order", params.sort_order);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.offset) searchParams.set("offset", String(params.offset));
      const query = searchParams.toString();
      return fetchJson<KGEntityListResponse>(`/kg/entities${query ? `?${query}` : ""}`);
    },

    search: (params: {
      query: string;
      limit?: number;
      include_edges?: boolean;
      rerank_method?: string;
      labels?: string[];
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.set("query", params.query);
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.include_edges !== undefined)
        searchParams.set("include_edges", String(params.include_edges));
      if (params.rerank_method) searchParams.set("rerank_method", params.rerank_method);
      if (params.labels) params.labels.forEach((l) => searchParams.append("labels", l));
      return fetchJson<KGSearchResultsResponse>(`/kg/search?${searchParams.toString()}`);
    },

    factsTimeline: (params?: {
      start_date?: string;
      end_date?: string;
      entity_uuid?: string;
      limit?: number;
      offset?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.start_date) searchParams.set("start_date", params.start_date);
      if (params?.end_date) searchParams.set("end_date", params.end_date);
      if (params?.entity_uuid) searchParams.set("entity_uuid", params.entity_uuid);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.offset) searchParams.set("offset", String(params.offset));
      const query = searchParams.toString();
      return fetchJson<KGFactsTimelineResponse>(`/kg/facts/timeline${query ? `?${query}` : ""}`);
    },

    stats: () => fetchJson<KGStatsResponse>("/kg/stats"),

    communities: (limit?: number) => {
      const params = limit ? `?limit=${limit}` : "";
      return fetchJson<KGCommunitiesResponse>(`/kg/communities${params}`);
    },

    labels: () => fetchJson<KGLabelsResponse>("/kg/labels"),
  },
};
