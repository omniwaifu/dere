import type {
  SessionConfig,
  SessionResponse,
  SessionListResponse,
  MessageHistoryResponse,
  ConversationMetricsResponse,
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
  AmbientDashboardResponse,
  SummaryContextResponse,
  CoreMemoryBlock,
  CoreMemoryEditResponse,
  CoreMemoryHistoryEntry,
  CoreMemoryRollbackResponse,
  RecallSearchResponse,
  ArchivalFactInsertResponse,
  ConsolidationRunsResponse,
  KGEntityListResponse,
  KGFactSearchResponse,
  KGSearchResultsResponse,
  KGFactsTimelineResponse,
  KGStatsResponse,
  KGCommunitiesResponse,
  KGLabelsResponse,
  PersonalitiesEditorResponse,
  PersonalityDetailResponse,
  PersonalityData,
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
      fetchJson<{ status: string; session_id: number }>(`/agent/sessions/${id}`, {
        method: "DELETE",
      }),

    messages: (id: number, params?: { limit?: number; before_timestamp?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.before_timestamp)
        searchParams.set("before_timestamp", String(params.before_timestamp));
      const query = searchParams.toString();
      return fetchJson<MessageHistoryResponse>(
        `/agent/sessions/${id}/messages${query ? `?${query}` : ""}`,
      );
    },

    metrics: (id: number, params?: { limit?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.limit) searchParams.set("limit", String(params.limit));
      const query = searchParams.toString();
      return fetchJson<ConversationMetricsResponse>(
        `/agent/sessions/${id}/metrics${query ? `?${query}` : ""}`,
      );
    },

    generateName: (id: number) =>
      fetchJson<{ name: string; generated: boolean }>(`/agent/sessions/${id}/generate-name`, {
        method: "POST",
      }),

    rename: (id: number, name: string) =>
      fetchJson<{ name: string }>(`/agent/sessions/${id}/name`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
  },

  metadata: {
    outputStyles: () => fetchJson<AvailableOutputStylesResponse>("/agent/output-styles"),

    personalities: () => fetchJson<AvailablePersonalitiesResponse>("/agent/personalities"),

    models: () => fetchJson<AvailableModelsResponse>("/agent/models"),

    recentDirectories: () => fetchJson<RecentDirectoriesResponse>("/agent/recent-directories"),
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
        `/emotion/history/db${queryString ? `?${queryString}` : ""}`,
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

    pause: (id: number) => fetchJson<Mission>(`/missions/${id}/pause`, { method: "POST" }),

    resume: (id: number) => fetchJson<Mission>(`/missions/${id}/resume`, { method: "POST" }),

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

  ambient: {
    dashboard: () => fetchJson<AmbientDashboardResponse>("/ambient/dashboard"),
  },

  memory: {
    core: (params?: { session_id?: number; user_id?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.session_id) searchParams.set("session_id", String(params.session_id));
      if (params?.user_id) searchParams.set("user_id", params.user_id);
      const query = searchParams.toString();
      return fetchJson<CoreMemoryBlock[]>(`/memory/core${query ? `?${query}` : ""}`);
    },

    editCore: (payload: {
      block_type: "persona" | "human" | "task";
      content: string;
      reason?: string;
      scope?: "user" | "session";
      session_id?: number;
      user_id?: string;
      char_limit?: number;
    }) =>
      fetchJson<CoreMemoryEditResponse>("/memory/core/edit", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    history: (params: {
      block_type: "persona" | "human" | "task";
      limit?: number;
      scope?: "user" | "session";
      session_id?: number;
      user_id?: string;
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.set("block_type", params.block_type);
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.scope) searchParams.set("scope", params.scope);
      if (params.session_id) searchParams.set("session_id", String(params.session_id));
      if (params.user_id) searchParams.set("user_id", params.user_id);
      return fetchJson<CoreMemoryHistoryEntry[]>(`/memory/core/history?${searchParams.toString()}`);
    },

    rollback: (payload: {
      block_type: "persona" | "human" | "task";
      target_version: number;
      reason?: string;
      scope?: "user" | "session";
      session_id?: number;
      user_id?: string;
    }) =>
      fetchJson<CoreMemoryRollbackResponse>("/memory/core/rollback", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    consolidationRuns: (params?: {
      user_id?: string;
      status?: string;
      limit?: number;
      offset?: number;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.user_id) searchParams.set("user_id", params.user_id);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.offset) searchParams.set("offset", String(params.offset));
      const query = searchParams.toString();
      return fetchJson<ConsolidationRunsResponse>(
        `/memory/consolidation/runs${query ? `?${query}` : ""}`,
      );
    },
  },

  recall: {
    search: (params: {
      query: string;
      limit?: number;
      days_back?: number;
      session_id?: number;
      user_id?: string;
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.set("query", params.query);
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.days_back) searchParams.set("days_back", String(params.days_back));
      if (params.session_id) searchParams.set("session_id", String(params.session_id));
      if (params.user_id) searchParams.set("user_id", params.user_id);
      return fetchJson<RecallSearchResponse>(`/recall/search?${searchParams.toString()}`);
    },
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
      include_facts?: boolean;
      include_fact_roles?: boolean;
      rerank_method?: string;
      labels?: string[];
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.set("query", params.query);
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.include_edges !== undefined)
        searchParams.set("include_edges", String(params.include_edges));
      if (params.include_facts !== undefined)
        searchParams.set("include_facts", String(params.include_facts));
      if (params.include_fact_roles !== undefined)
        searchParams.set("include_fact_roles", String(params.include_fact_roles));
      if (params.rerank_method) searchParams.set("rerank_method", params.rerank_method);
      if (params.labels) params.labels.forEach((l) => searchParams.append("labels", l));
      return fetchJson<KGSearchResultsResponse>(`/kg/search?${searchParams.toString()}`);
    },

    factSearch: (params: {
      query: string;
      limit?: number;
      include_roles?: boolean;
      include_expired?: boolean;
      start_date?: string;
      end_date?: string;
      archival_only?: boolean;
      user_id?: string;
    }) => {
      const searchParams = new URLSearchParams();
      searchParams.set("query", params.query);
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.include_roles !== undefined)
        searchParams.set("include_roles", String(params.include_roles));
      if (params.include_expired !== undefined)
        searchParams.set("include_expired", String(params.include_expired));
      if (params.start_date) searchParams.set("start_date", params.start_date);
      if (params.end_date) searchParams.set("end_date", params.end_date);
      if (params.archival_only !== undefined)
        searchParams.set("archival_only", String(params.archival_only));
      if (params.user_id) searchParams.set("user_id", params.user_id);
      return fetchJson<KGFactSearchResponse>(`/kg/facts/search?${searchParams.toString()}`);
    },

    archivalInsert: (payload: {
      fact: string;
      source?: string;
      tags?: string[];
      valid_at?: string;
      invalid_at?: string;
      user_id?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (payload.user_id) searchParams.set("user_id", payload.user_id);
      const query = searchParams.toString();
      const { user_id: _user_id, ...body } = payload;
      return fetchJson<ArchivalFactInsertResponse>(
        `/kg/facts/archival${query ? `?${query}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
    },

    factsAtTime: (params: { timestamp: string; limit?: number; include_roles?: boolean }) => {
      const searchParams = new URLSearchParams();
      searchParams.set("timestamp", params.timestamp);
      if (params.limit) searchParams.set("limit", String(params.limit));
      if (params.include_roles !== undefined)
        searchParams.set("include_roles", String(params.include_roles));
      return fetchJson<KGFactSearchResponse>(`/kg/facts/at_time?${searchParams.toString()}`);
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

  personalities: {
    list: () => fetchJson<PersonalitiesEditorResponse>("/personalities"),

    get: (name: string) =>
      fetchJson<PersonalityDetailResponse>(`/personalities/${encodeURIComponent(name)}`),

    save: (name: string, data: PersonalityData) =>
      fetchJson<{ status: string; name: string }>(`/personalities/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    uploadAvatar: async (name: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API_BASE}/personalities/${encodeURIComponent(name)}/avatar`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error ${response.status}: ${error}`);
      }
      return response.json() as Promise<{ status: string; avatar: string }>;
    },

    delete: (name: string) =>
      fetchJson<{ status: string; name: string; has_embedded: boolean }>(
        `/personalities/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      ),
  },
};
