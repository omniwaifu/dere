import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "./chat";

/**
 * Memoized selectors for optimized React re-renders.
 * Uses useShallow to perform shallow equality checks on object results,
 * preventing unnecessary re-renders when subscribed values haven't changed.
 */

export function useMessageListState() {
  return useChatStore(
    useShallow((s) => ({
      messages: s.messages,
      streamingMessage: s.streamingMessage,
      isQueryInProgress: s.isQueryInProgress,
      isLoadingMessages: s.isLoadingMessages,
      loadError: s.loadError,
    })),
  );
}

export function useChatInputState() {
  return useChatStore(
    useShallow((s) => ({
      status: s.status,
      sessionId: s.sessionId,
      isQueryInProgress: s.isQueryInProgress,
      isLocked: s.isLocked,
    })),
  );
}

export function useChatViewState() {
  return useChatStore(
    useShallow((s) => ({
      status: s.status,
      sessionId: s.sessionId,
      isCreatingNewSession: s.isCreatingNewSession,
      lastSeq: s.lastSeq,
    })),
  );
}

export function useChatHeaderState() {
  return useChatStore(
    useShallow((s) => ({
      sessionId: s.sessionId,
      sessionName: s.sessionName,
      sessionConfig: s.sessionConfig,
      isLocked: s.isLocked,
    })),
  );
}

export function useConnectionState() {
  return useChatStore(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      reconnectAttempts: s.reconnectAttempts,
      disconnectedAt: s.disconnectedAt,
    })),
  );
}

export function usePermissionState() {
  return useChatStore(
    useShallow((s) => ({
      pendingPermission: s.pendingPermission,
    })),
  );
}

// Actions don't change, so we can select them directly without useShallow
export function useChatActions() {
  return useChatStore(
    useShallow((s) => ({
      connect: s.connect,
      disconnect: s.disconnect,
      newSession: s.newSession,
      resumeSession: s.resumeSession,
      sendQuery: s.sendQuery,
      cancelQuery: s.cancelQuery,
      updateConfig: s.updateConfig,
      loadMessages: s.loadMessages,
      retryLoad: s.retryLoad,
      clearError: s.clearError,
      respondToPermission: s.respondToPermission,
    })),
  );
}
