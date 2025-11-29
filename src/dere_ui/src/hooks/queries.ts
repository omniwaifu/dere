import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SessionConfig } from "@/types/api";

export const queryKeys = {
  sessions: ["sessions"] as const,
  session: (id: number) => ["sessions", id] as const,
  sessionMessages: (id: number) => ["sessions", id, "messages"] as const,
  outputStyles: ["outputStyles"] as const,
  personalities: ["personalities"] as const,
  models: ["models"] as const,
  recentDirectories: ["recentDirectories"] as const,
  emotionState: (sessionId: number) => ["emotion", sessionId, "state"] as const,
  emotionSummary: (sessionId: number) =>
    ["emotion", sessionId, "summary"] as const,
  userInfo: ["userInfo"] as const,
  tasks: (params?: { status?: string; project?: string }) =>
    ["tasks", params] as const,
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

export function useEmotionState(sessionId: number) {
  return useQuery({
    queryKey: queryKeys.emotionState(sessionId),
    queryFn: () => api.emotion.state(sessionId),
    enabled: sessionId > 0,
    refetchInterval: 30000,
  });
}

export function useEmotionSummary(sessionId: number) {
  return useQuery({
    queryKey: queryKeys.emotionSummary(sessionId),
    queryFn: () => api.emotion.summary(sessionId),
    enabled: sessionId > 0,
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
