import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SessionConfig, DereConfig, CreateMissionRequest, UpdateMissionRequest, PersonalityData } from "@/types/api";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: number) => ["sessions", id] as const,
  sessionMessages: (id: number) => ["sessions", id, "messages"] as const,
  summaryContext: ["summaryContext"] as const,
  outputStyles: ["outputStyles"] as const,
  personalities: ["personalities"] as const,
  models: ["models"] as const,
  recentDirectories: ["recentDirectories"] as const,
  emotionState: ["emotion", "state"] as const,
  emotionSummary: ["emotion", "summary"] as const,
  emotionHistory: ["emotion", "history"] as const,
  emotionHistoryDB: (startTime?: number, endTime?: number) =>
    ["emotion", "history", "db", startTime, endTime] as const,
  emotionProfile: ["emotion", "profile"] as const,
  userInfo: ["userInfo"] as const,
  tasks: (params?: { status?: string; project?: string }) =>
    ["tasks", params] as const,
  config: ["config"] as const,
  configSchema: ["configSchema"] as const,
  missions: ["missions"] as const,
  mission: (id: number) => ["missions", id] as const,
  missionExecutions: (id: number) => ["missions", id, "executions"] as const,
  coreMemory: (params?: { user_id?: string; session_id?: number }) =>
    ["memory", "core", params] as const,
  coreMemoryHistory: (params?: object) => ["memory", "core", "history", params] as const,
  recallSearch: (query: string, params?: object) => ["memory", "recall", query, params] as const,
  consolidationRuns: (params?: object) => ["memory", "consolidation", "runs", params] as const,
  // Knowledge Graph
  kgEntities: (params?: { labels?: string[]; sort_by?: string; offset?: number }) =>
    ["kg", "entities", params] as const,
  kgSearch: (query: string, params?: object) => ["kg", "search", query, params] as const,
  kgFactSearch: (query: string, params?: object) =>
    ["kg", "facts", "search", query, params] as const,
  kgFactsAtTime: (timestamp?: string, params?: object) =>
    ["kg", "facts", "at_time", timestamp, params] as const,
  kgFactsTimeline: (params?: object) => ["kg", "facts", "timeline", params] as const,
  kgStats: ["kg", "stats"] as const,
  kgCommunities: ["kg", "communities"] as const,
  kgLabels: ["kg", "labels"] as const,
  ambientDashboard: ["ambient", "dashboard"] as const,
  // Personality Editor
  personalitiesEditor: ["personalities", "editor"] as const,
  personalityEditor: (name: string) => ["personalities", "editor", name] as const,
};

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api.sessions.list(),
  });
}

export function useSession(id: number) {
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.sessions.get(id),
    enabled: id > 0,
  });
}

export function useSessionMessages(
  id: number,
  params?: { limit?: number; before_timestamp?: number }
) {
  return useQuery({
    queryKey: queryKeys.sessionMessages(id),
    queryFn: () => api.sessions.messages(id, params),
    enabled: id > 0,
  });
}

export function useSummaryContext() {
  return useQuery({
    queryKey: queryKeys.summaryContext,
    queryFn: () => api.sessions.context(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 1000 * 60 * 5, // refresh every 5 minutes
  });
}

export function useAmbientDashboard() {
  return useQuery({
    queryKey: queryKeys.ambientDashboard,
    queryFn: () => api.ambient.dashboard(),
    refetchInterval: 30000,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: SessionConfig) => api.sessions.create(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: number; config: SessionConfig }) =>
      api.sessions.update(id, config),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.sessions.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useGenerateSessionName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.sessions.generateName(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.sessions.rename(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useOutputStyles() {
  return useQuery({
    queryKey: queryKeys.outputStyles,
    queryFn: () => api.metadata.outputStyles(),
    staleTime: 1000 * 60 * 60,
  });
}

export function usePersonalities() {
  return useQuery({
    queryKey: queryKeys.personalities,
    queryFn: () => api.metadata.personalities(),
    staleTime: 1000 * 60 * 60,
  });
}

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => api.metadata.models(),
    staleTime: 1000 * 60 * 60,
  });
}

export function useRecentDirectories() {
  return useQuery({
    queryKey: queryKeys.recentDirectories,
    queryFn: () => api.metadata.recentDirectories(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useEmotionState() {
  return useQuery({
    queryKey: queryKeys.emotionState,
    queryFn: () => api.emotion.state(),
    refetchInterval: 30000,
  });
}

export function useEmotionSummary() {
  return useQuery({
    queryKey: queryKeys.emotionSummary,
    queryFn: () => api.emotion.summary(),
  });
}

export function useEmotionHistory(limit?: number) {
  return useQuery({
    queryKey: queryKeys.emotionHistory,
    queryFn: () => api.emotion.history(limit),
    refetchInterval: 30000,
  });
}

export function useEmotionHistoryDB(
  startTime?: number,
  endTime?: number,
  limit?: number
) {
  return useQuery({
    queryKey: queryKeys.emotionHistoryDB(startTime, endTime),
    queryFn: () => api.emotion.historyDB(startTime, endTime, limit),
    refetchInterval: 60000,
  });
}

export function useEmotionProfile() {
  return useQuery({
    queryKey: queryKeys.emotionProfile,
    queryFn: () => api.emotion.profile(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useUserInfo() {
  return useQuery({
    queryKey: queryKeys.userInfo,
    queryFn: () => api.user.info(),
    staleTime: Infinity,
  });
}

export function useTasks(params?: { status?: string; project?: string; include_completed?: boolean }) {
  return useQuery({
    queryKey: queryKeys.tasks(params),
    queryFn: () => api.taskwarrior.tasks(params),
    refetchInterval: 30_000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api.config.get(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<DereConfig>) => api.config.update(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
      queryClient.invalidateQueries({ queryKey: queryKeys.userInfo });
    },
  });
}

export function useConfigSchema() {
  return useQuery({
    queryKey: queryKeys.configSchema,
    queryFn: () => api.config.schema(),
    staleTime: Infinity, // Schema doesn't change at runtime
  });
}

// Memory
export function useCoreMemoryBlocks(
  params?: { user_id?: string; session_id?: number },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.coreMemory(params),
    queryFn: () => api.memory.core(params),
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateCoreMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      block_type: "persona" | "human" | "task";
      content: string;
      reason?: string;
      scope?: "user" | "session";
      session_id?: number;
      user_id?: string;
      char_limit?: number;
    }) => api.memory.editCore(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "core"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "core", "history"] });
    },
  });
}

export function useCoreMemoryHistory(
  params: {
    block_type: "persona" | "human" | "task";
    limit?: number;
    scope?: "user" | "session";
    session_id?: number;
    user_id?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.coreMemoryHistory(params),
    queryFn: () => api.memory.history(params),
    enabled: options?.enabled ?? true,
  });
}

export function useRollbackCoreMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      block_type: "persona" | "human" | "task";
      target_version: number;
      reason?: string;
      scope?: "user" | "session";
      session_id?: number;
      user_id?: string;
    }) => api.memory.rollback(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", "core"] });
      queryClient.invalidateQueries({ queryKey: ["memory", "core", "history"] });
    },
  });
}

export function useRecallSearch(
  query: string,
  params?: {
    limit?: number;
    days_back?: number;
    session_id?: number;
    user_id?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.recallSearch(query, params),
    queryFn: () => api.recall.search({ query, ...params }),
    enabled: options?.enabled ?? query.length > 0,
  });
}

export function useConsolidationRuns(params?: {
  user_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: queryKeys.consolidationRuns(params),
    queryFn: () => api.memory.consolidationRuns(params),
  });
}

// Missions
export function useMissions(status?: string) {
  return useQuery({
    queryKey: queryKeys.missions,
    queryFn: () => api.missions.list(status),
  });
}

export function useMission(id: number) {
  return useQuery({
    queryKey: queryKeys.mission(id),
    queryFn: () => api.missions.get(id),
    enabled: id > 0,
  });
}

export function useMissionExecutions(id: number, limit?: number) {
  return useQuery({
    queryKey: queryKeys.missionExecutions(id),
    queryFn: () => api.missions.executions(id, limit),
    enabled: id > 0,
    refetchInterval: 10000,
  });
}

export function useCreateMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMissionRequest) => api.missions.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    },
  });
}

export function useUpdateMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateMissionRequest }) =>
      api.missions.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mission(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    },
  });
}

export function useDeleteMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.missions.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    },
  });
}

export function usePauseMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.missions.pause(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mission(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    },
  });
}

export function useResumeMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.missions.resume(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mission(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    },
  });
}

export function useExecuteMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.missions.execute(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missionExecutions(id) });
    },
  });
}

// Knowledge Graph
export function useKGStats() {
  return useQuery({
    queryKey: queryKeys.kgStats,
    queryFn: () => api.knowledge.stats(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useKGLabels() {
  return useQuery({
    queryKey: queryKeys.kgLabels,
    queryFn: () => api.knowledge.labels(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useKGEntities(params?: {
  labels?: string[];
  sort_by?: string;
  sort_order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: queryKeys.kgEntities(params),
    queryFn: () => api.knowledge.entities(params),
  });
}

export function useKGSearch(
  query: string,
  params?: {
    limit?: number;
    include_edges?: boolean;
    include_facts?: boolean;
    include_fact_roles?: boolean;
    rerank_method?: string;
    labels?: string[];
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.kgSearch(query, params),
    queryFn: () => api.knowledge.search({ query, ...params }),
    enabled: options?.enabled ?? query.length > 0,
  });
}

export function useKGFactSearch(
  query: string,
  params?: {
    limit?: number;
    include_roles?: boolean;
    include_expired?: boolean;
    start_date?: string;
    end_date?: string;
    archival_only?: boolean;
    user_id?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.kgFactSearch(query, params),
    queryFn: () => api.knowledge.factSearch({ query, ...params }),
    enabled: options?.enabled ?? query.length > 0,
  });
}

export function useArchivalFactInsert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      fact: string;
      source?: string;
      tags?: string[];
      valid_at?: string;
      invalid_at?: string;
      user_id?: string;
    }) => api.knowledge.archivalInsert(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kg", "facts", "search"] });
    },
  });
}

export function useKGFactsAtTime(
  timestamp: string,
  params?: {
    limit?: number;
    include_roles?: boolean;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.kgFactsAtTime(timestamp, params),
    queryFn: () => api.knowledge.factsAtTime({ timestamp, ...params }),
    enabled: options?.enabled ?? timestamp.length > 0,
  });
}

export function useKGFactsTimeline(params?: {
  start_date?: string;
  end_date?: string;
  entity_uuid?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: queryKeys.kgFactsTimeline(params),
    queryFn: () => api.knowledge.factsTimeline(params),
  });
}

export function useKGCommunities(limit?: number) {
  return useQuery({
    queryKey: queryKeys.kgCommunities,
    queryFn: () => api.knowledge.communities(limit),
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

// Personality Editor
export function usePersonalitiesEditor() {
  return useQuery({
    queryKey: queryKeys.personalitiesEditor,
    queryFn: () => api.personalities.list(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function usePersonalityEditor(name: string) {
  return useQuery({
    queryKey: queryKeys.personalityEditor(name),
    queryFn: () => api.personalities.get(name),
    enabled: !!name,
    refetchOnWindowFocus: false,
  });
}

export function useSavePersonality() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: PersonalityData }) =>
      api.personalities.save(name, data),
    onSuccess: (_, { name }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.personalitiesEditor });
      queryClient.invalidateQueries({ queryKey: queryKeys.personalityEditor(name) });
    },
  });
}

export function useDeletePersonality() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.personalities.delete(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.personalitiesEditor });
    },
  });
}

export function useUploadPersonalityAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, file }: { name: string; file: File }) =>
      api.personalities.uploadAvatar(name, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.personalitiesEditor });
    },
  });
}
