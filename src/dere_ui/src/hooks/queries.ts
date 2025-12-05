import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SessionConfig, DereConfig } from "@/types/api";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: number) => ["sessions", id] as const,
  sessionMessages: (id: number) => ["sessions", id, "messages"] as const,
  outputStyles: ["outputStyles"] as const,
  personalities: ["personalities"] as const,
  models: ["models"] as const,
  recentDirectories: ["recentDirectories"] as const,
  emotionState: ["emotion", "state"] as const,
  emotionSummary: ["emotion", "summary"] as const,
  emotionHistory: ["emotion", "history"] as const,
  emotionProfile: ["emotion", "profile"] as const,
  userInfo: ["userInfo"] as const,
  tasks: (params?: { status?: string; project?: string }) =>
    ["tasks", params] as const,
  config: ["config"] as const,
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
