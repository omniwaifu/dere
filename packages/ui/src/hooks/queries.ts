import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { trpc } from "@/lib/trpc";

export function useSessions() {
  return trpc.agent.list.useQuery();
}

export function useSession(id: number) {
  return trpc.agent.get.useQuery({ session_id: id }, { enabled: id > 0 });
}

export function useSessionMessages(
  id: number,
  params?: { limit?: number; before_timestamp?: number },
) {
  return trpc.agent.messages.useQuery(
    { session_id: id, ...params },
    { enabled: id > 0 },
  );
}

export function useSummaryContext() {
  return trpc.sessions.context.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchInterval: 1000 * 60 * 5, // refresh every 5 minutes
  });
}

export function useAmbientDashboard() {
  return trpc.ambient.dashboard.useQuery(undefined, {
    refetchInterval: 30000,
  });
}

export function useCreateSession() {
  const utils = trpc.useUtils();
  return trpc.agent.create.useMutation({
    onSuccess: () => {
      utils.agent.list.invalidate();
    },
  });
}

export function useUpdateSession() {
  const utils = trpc.useUtils();
  return trpc.agent.update.useMutation({
    onSuccess: (_, { session_id }) => {
      utils.agent.get.invalidate({ session_id });
      utils.agent.list.invalidate();
    },
  });
}

export function useDeleteSession() {
  const utils = trpc.useUtils();
  return trpc.agent.delete.useMutation({
    onSuccess: () => {
      utils.agent.list.invalidate();
    },
  });
}

export function useGenerateSessionName() {
  const utils = trpc.useUtils();
  return trpc.agent.generateName.useMutation({
    onSuccess: () => {
      utils.agent.list.invalidate();
    },
  });
}

export function useRenameSession() {
  const utils = trpc.useUtils();
  return trpc.agent.rename.useMutation({
    onSuccess: () => {
      utils.agent.list.invalidate();
    },
  });
}

export function useOutputStyles() {
  return trpc.metadata.outputStyles.useQuery(undefined, {
    staleTime: 1000 * 60 * 60,
  });
}

export function usePersonalities() {
  return trpc.metadata.personalities.useQuery(undefined, {
    staleTime: 1000 * 60 * 60,
  });
}

export function useModels() {
  return trpc.metadata.models.useQuery(undefined, {
    staleTime: 1000 * 60 * 60,
  });
}

export function useRecentDirectories() {
  return trpc.agent.recentDirectories.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useEmotionState() {
  return trpc.emotions.state.useQuery(undefined, {
    refetchInterval: 30000,
  });
}

export function useEmotionSummary(sessionId?: number) {
  return trpc.emotions.summary.useQuery(
    sessionId !== undefined ? { sessionId } : undefined,
  );
}

export function useEmotionHistory(limit?: number) {
  return trpc.emotions.history.useQuery(
    limit !== undefined ? { limit } : undefined,
    { refetchInterval: 30000 },
  );
}

export function useEmotionHistoryDB(startTime?: number, endTime?: number, limit?: number) {
  return trpc.emotions.historyDb.useQuery(
    { start_time: startTime, end_time: endTime, limit },
    { refetchInterval: 60000 },
  );
}

export function useEmotionProfile() {
  return trpc.emotions.profile.useQuery(undefined, {
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useUserInfo() {
  return trpc.metadata.userInfo.useQuery(undefined, {
    staleTime: Infinity,
  });
}

export function useTasks(params?: {
  status?: string;
  project?: string;
  include_completed?: boolean;
}) {
  return trpc.taskwarrior.tasks.useQuery(params, {
    refetchInterval: 30_000,
  });
}

export function useConfig() {
  return trpc.config.get.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useUpdateConfig() {
  const utils = trpc.useUtils();
  return trpc.config.update.useMutation({
    onSuccess: () => {
      utils.config.get.invalidate();
    },
  });
}

export function useConfigSchema() {
  return trpc.config.schema.useQuery(undefined, {
    staleTime: Infinity, // Schema doesn't change at runtime
  });
}

// Memory
export function useCoreMemoryBlocks(
  params?: { user_id?: string; session_id?: number },
  options?: { enabled?: boolean },
) {
  return trpc.memory.core.useQuery(params, {
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateCoreMemory() {
  const utils = trpc.useUtils();
  return trpc.memory.editCore.useMutation({
    onSuccess: () => {
      utils.memory.core.invalidate();
      utils.memory.history.invalidate();
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
  options?: { enabled?: boolean },
) {
  return trpc.memory.history.useQuery(params, {
    enabled: options?.enabled ?? true,
  });
}

export function useRollbackCoreMemory() {
  const utils = trpc.useUtils();
  return trpc.memory.rollback.useMutation({
    onSuccess: () => {
      utils.memory.core.invalidate();
      utils.memory.history.invalidate();
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
  options?: { enabled?: boolean },
) {
  return trpc.recall.search.useQuery(
    { query, ...params },
    { enabled: options?.enabled ?? query.length > 0 },
  );
}

export function useConsolidationRuns(params?: {
  user_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  return trpc.memory.consolidationRuns.useQuery(params);
}

// Missions
export function useMissions(status?: string) {
  return trpc.missions.list.useQuery({ status });
}

export function useMission(id: number) {
  return trpc.missions.get.useQuery({ mission_id: id }, { enabled: id > 0 });
}

export function useMissionExecutions(id: number, limit?: number) {
  return trpc.missions.executions.useQuery(
    { mission_id: id, limit },
    { enabled: id > 0, refetchInterval: 10000 },
  );
}

export function useCreateMission() {
  const utils = trpc.useUtils();
  return trpc.missions.create.useMutation({
    onSuccess: () => {
      utils.missions.list.invalidate();
    },
  });
}

export function useUpdateMission() {
  const utils = trpc.useUtils();
  return trpc.missions.update.useMutation({
    onSuccess: (_, { mission_id }) => {
      utils.missions.get.invalidate({ mission_id });
      utils.missions.list.invalidate();
    },
  });
}

export function useDeleteMission() {
  const utils = trpc.useUtils();
  return trpc.missions.delete.useMutation({
    onSuccess: () => {
      utils.missions.list.invalidate();
    },
  });
}

export function usePauseMission() {
  const utils = trpc.useUtils();
  return trpc.missions.pause.useMutation({
    onSuccess: (_, { mission_id }) => {
      utils.missions.get.invalidate({ mission_id });
      utils.missions.list.invalidate();
    },
  });
}

export function useResumeMission() {
  const utils = trpc.useUtils();
  return trpc.missions.resume.useMutation({
    onSuccess: (_, { mission_id }) => {
      utils.missions.get.invalidate({ mission_id });
      utils.missions.list.invalidate();
    },
  });
}

export function useExecuteMission() {
  const utils = trpc.useUtils();
  return trpc.missions.execute.useMutation({
    onSuccess: (_, { mission_id }) => {
      utils.missions.executions.invalidate({ mission_id });
    },
  });
}

// Knowledge Graph
export function useKGStats() {
  return trpc.knowledgeGraph.stats.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useKGLabels() {
  return trpc.knowledgeGraph.labels.useQuery(undefined, {
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
  return trpc.knowledgeGraph.entities.useQuery(params ?? {});
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
  options?: { enabled?: boolean },
) {
  return trpc.knowledgeGraph.search.useQuery(
    { query, ...params },
    { enabled: options?.enabled ?? query.length > 0 },
  );
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
  options?: { enabled?: boolean },
) {
  return trpc.knowledgeGraph.factsSearch.useQuery(
    { query, ...params },
    { enabled: options?.enabled ?? query.length > 0 },
  );
}

export function useArchivalFactInsert() {
  const utils = trpc.useUtils();
  return trpc.knowledgeGraph.factsArchival.useMutation({
    onSuccess: () => {
      utils.knowledgeGraph.factsSearch.invalidate();
    },
  });
}

export function useKGFactsAtTime(
  timestamp: string,
  params?: {
    limit?: number;
    include_roles?: boolean;
  },
  options?: { enabled?: boolean },
) {
  return trpc.knowledgeGraph.factsAtTime.useQuery(
    { timestamp, ...params },
    { enabled: options?.enabled ?? timestamp.length > 0 },
  );
}

export function useKGFactsTimeline(params?: {
  start_date?: string;
  end_date?: string;
  entity_uuid?: string;
  limit?: number;
  offset?: number;
}) {
  return trpc.knowledgeGraph.factsTimeline.useQuery(params ?? {});
}

export function useKGCommunities(limit?: number) {
  return trpc.knowledgeGraph.communities.useQuery(
    { limit },
    { staleTime: 1000 * 60 * 10 }, // 10 minutes
  );
}

// Personality Editor
export function usePersonalitiesEditor() {
  return trpc.personalities.list.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function usePersonalityEditor(name: string) {
  return trpc.personalities.get.useQuery(
    { name },
    { enabled: !!name, refetchOnWindowFocus: false },
  );
}

export function useSavePersonality() {
  const utils = trpc.useUtils();
  return trpc.personalities.save.useMutation({
    onSuccess: (_, { name }) => {
      utils.personalities.list.invalidate();
      utils.personalities.get.invalidate({ name });
    },
  });
}

export function useDeletePersonality() {
  const utils = trpc.useUtils();
  return trpc.personalities.delete.useMutation({
    onSuccess: () => {
      utils.personalities.list.invalidate();
    },
  });
}

export function useUploadPersonalityAvatar() {
  const utils = trpc.useUtils();
  return useMutation({
    mutationFn: ({ name, file }: { name: string; file: File }) =>
      api.personalities.uploadAvatar(name, file),
    onSuccess: () => {
      utils.personalities.list.invalidate();
    },
  });
}
