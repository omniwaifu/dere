import { create } from "zustand";
import type {
  SessionConfig,
  ChatMessage,
  ToolUse,
  ToolResult,
  StreamEvent,
  PermissionRequest,
  ConversationBlock,
} from "@/types/api";
import { api } from "@/lib/api";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// Timeout constants
const SESSION_READY_TIMEOUT_MS = 10000;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 10000;

interface ChatStore {
  // Connection
  status: ConnectionStatus;
  socket: WebSocket | null;
  lastSeq: number;
  error: string | null;

  // Session
  sessionId: number | null;
  sessionConfig: SessionConfig | null;
  sessionName: string | null;
  isLocked: boolean;

  // Chat
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null;
  isQueryInProgress: boolean;
  isLoadingMessages: boolean;

  // Text buffering for streaming
  textBuffer: string;
  flushTimeout: number | null;

  // Thinking timing
  thinkingStartTime: number | null;

  // Callbacks (arrays to allow multiple listeners)
  onSessionCreatedCallbacks: Set<(sessionId: number) => void>;
  onFirstResponseCallbacks: Set<(sessionId: number) => void>;

  // Pending initial message (sent after session_ready)
  pendingInitialMessage: string | null;

  // Track if we're waiting for a new session to be created (vs resuming)
  isCreatingNewSession: boolean;

  // Permission requests
  pendingPermissionQueue: PermissionRequest[];
  permissionDecisions: Record<string, { allowed: boolean; denyMessage?: string }>;
  permissionSendError: string | null;

  // Loading error state
  loadError: string | null;
  loadingTimeoutId: number | null;
  expectedSessionId: number | null;

  // Reconnection state
  reconnectAttempts: number;
  reconnectTimeoutId: number | null;
  shouldReconnect: boolean;

  // Heartbeat state
  heartbeatIntervalId: number | null;
  lastActivityTime: number;

  // Connection timing (for delayed UI)
  disconnectedAt: number | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  newSession: (config: SessionConfig, initialMessage?: string) => void;
  resumeSession: (id: number, lastSeq?: number) => void;
  sendQuery: (prompt: string) => void;
  cancelQuery: () => void;
  updateConfig: (config: SessionConfig) => void;
  clearMessages: () => void;
  clearSession: () => void;
  addUserMessage: (content: string) => void;
  loadMessages: (sessionId: number) => Promise<void>;
  addOnSessionCreated: (cb: (sessionId: number) => void) => () => void;
  addOnFirstResponse: (cb: (sessionId: number) => void) => () => void;
  respondToPermission: (allowed: boolean, denyMessage?: string) => void;
  retryLoad: () => void;
  clearError: () => void;
}

const WS_URL = `ws://${window.location.hostname}:8787/agent/ws`;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentPersonalityKey(): string | undefined {
  const cfg = useChatStore.getState().sessionConfig;
  if (!cfg) return undefined;
  const p = cfg.personality;
  if (Array.isArray(p)) return p[0] || undefined;
  return p || undefined;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  status: "disconnected",
  socket: null,
  lastSeq: 0,
  error: null,
  sessionId: null,
  sessionConfig: null,
  sessionName: null,
  isLocked: false,
  messages: [],
  streamingMessage: null,
  isQueryInProgress: false,
  isLoadingMessages: false,
  textBuffer: "",
  flushTimeout: null,
  thinkingStartTime: null,
  onSessionCreatedCallbacks: new Set(),
  onFirstResponseCallbacks: new Set(),
  pendingInitialMessage: null,
  isCreatingNewSession: false,
  pendingPermissionQueue: [],
  permissionDecisions: {},
  permissionSendError: null,
  // Loading error state
  loadError: null,
  loadingTimeoutId: null,
  expectedSessionId: null,
  // Reconnection state
  reconnectAttempts: 0,
  reconnectTimeoutId: null,
  shouldReconnect: true,
  // Heartbeat state
  heartbeatIntervalId: null,
  lastActivityTime: Date.now(),
  // Connection timing
  disconnectedAt: null,

  connect: () => {
    const { socket, status } = get();
    if (socket || status === "connecting") return;

    set({ status: "connecting", error: null, loadError: null });

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      set({
        status: "connected",
        socket: ws,
        reconnectAttempts: 0,
        error: null,
        disconnectedAt: null,
      });
      startHeartbeat(ws);

      // If user already responded to permission requests while disconnected,
      // send queued decisions as soon as we reconnect (in order).
      const state = get();
      if (ws.readyState === WebSocket.OPEN) {
        let queue = [...state.pendingPermissionQueue];
        const decisions = { ...state.permissionDecisions };
        let sentAny = false;

        while (queue.length > 0) {
          const current = queue[0];
          const decision = decisions[current.requestId];
          if (!decision) break;
          ws.send(
            JSON.stringify({
              type: "permission_response",
              request_id: current.requestId,
              allowed: decision.allowed,
              deny_message: decision.denyMessage,
            }),
          );
          delete decisions[current.requestId];
          queue = queue.slice(1);
          sentAny = true;
        }

        if (sentAny) {
          set({
            pendingPermissionQueue: queue,
            permissionDecisions: decisions,
            permissionSendError: null,
          });
        }
      }
    };

    ws.onclose = (event) => {
      stopHeartbeat();
      const state = get();
      set({
        status: "disconnected",
        socket: null,
        disconnectedAt: state.disconnectedAt ?? Date.now(),
      });

      // Auto-reconnect if not an intentional close
      if (state.shouldReconnect && !event.wasClean) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      set({ status: "error", error: "WebSocket connection failed" });
    };

    ws.onmessage = (event) => {
      // Update activity time for heartbeat monitoring
      set({ lastActivityTime: Date.now() });
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        handleStreamEvent(data);
      } catch {
        console.error("Failed to parse WebSocket message:", event.data);
      }
    };
  },

  disconnect: () => {
    const { socket, flushTimeout, reconnectTimeoutId, loadingTimeoutId } = get();

    // Clear all timeouts
    if (flushTimeout) clearTimeout(flushTimeout);
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
    if (loadingTimeoutId) clearTimeout(loadingTimeoutId);
    stopHeartbeat();

    if (socket) {
      socket.close(1000, "User disconnect");
    }
    set({
      status: "disconnected",
      socket: null,
      sessionId: null,
      sessionConfig: null,
      sessionName: null,
      isLocked: false,
      flushTimeout: null,
      shouldReconnect: false,
      reconnectTimeoutId: null,
      loadingTimeoutId: null,
      expectedSessionId: null,
    });
  },

  newSession: (config, initialMessage) => {
    const { socket, status } = get();
    if (!socket || status !== "connected") {
      set({ error: "Not connected" });
      return;
    }

    socket.send(JSON.stringify({ type: "new_session", config }));
    set({
      messages: [],
      streamingMessage: null,
      isQueryInProgress: false,
      pendingInitialMessage: initialMessage || null,
      isCreatingNewSession: true,
    });
  },

  resumeSession: (id, lastSeq) => {
    const { socket, status, loadingTimeoutId } = get();
    if (!socket || status !== "connected") {
      set({ loadError: "Not connected to daemon" });
      return;
    }

    // Clear any existing timeout
    if (loadingTimeoutId) {
      clearTimeout(loadingTimeoutId);
    }

    // Start loading timeout
    const timeoutId = window.setTimeout(() => {
      const state = useChatStore.getState();
      if (state.isLoadingMessages && state.expectedSessionId === id) {
        set({
          isLoadingMessages: false,
          loadError: "Session loading timed out. Please try again.",
          loadingTimeoutId: null,
          // Keep expectedSessionId so retry button knows which session to load
        });
      }
    }, SESSION_READY_TIMEOUT_MS);

    // Immediately show loading state and clear old messages
    set({
      messages: [],
      streamingMessage: null,
      isLoadingMessages: true,
      loadError: null,
      loadingTimeoutId: timeoutId,
      expectedSessionId: id,
      thinkingStartTime: null,
    });

    socket.send(
      JSON.stringify({
        type: "resume_session",
        session_id: id,
        last_seq: lastSeq,
      }),
    );
  },

  sendQuery: (prompt) => {
    const { socket, status, sessionId } = get();
    if (!socket || status !== "connected" || !sessionId) {
      set({ error: "Not connected or no active session" });
      return;
    }

    get().addUserMessage(prompt);
    socket.send(JSON.stringify({ type: "query", prompt }));
    set({ isQueryInProgress: true });
  },

  cancelQuery: () => {
    const { socket, status } = get();
    if (!socket || status !== "connected") return;

    socket.send(JSON.stringify({ type: "cancel" }));
  },

  updateConfig: (config) => {
    const { socket, status, isQueryInProgress } = get();
    if (!socket || status !== "connected") return;

    // Prevent config changes while query is in progress (race condition fix)
    if (isQueryInProgress) {
      set({ error: "Cannot change settings while a query is running" });
      return;
    }

    socket.send(JSON.stringify({ type: "update_config", config }));
    set({ sessionConfig: config });
  },

  clearMessages: () => {
    set({ messages: [], streamingMessage: null });
  },

  clearSession: () => {
    set({
      sessionId: null,
      sessionConfig: null,
      sessionName: null,
      isLocked: false,
      messages: [],
      streamingMessage: null,
      isQueryInProgress: false,
      thinkingStartTime: null,
      isCreatingNewSession: false,
    });
  },

  addUserMessage: (content) => {
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content,
      personality: getCurrentPersonalityKey(),
      toolUses: [],
      toolResults: [],
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, userMessage] }));
  },

  addOnSessionCreated: (cb) => {
    const { onSessionCreatedCallbacks } = get();
    onSessionCreatedCallbacks.add(cb);
    // Return cleanup function
    return () => {
      onSessionCreatedCallbacks.delete(cb);
    };
  },

  addOnFirstResponse: (cb) => {
    const { onFirstResponseCallbacks } = get();
    onFirstResponseCallbacks.add(cb);
    // Return cleanup function
    return () => {
      onFirstResponseCallbacks.delete(cb);
    };
  },

  respondToPermission: (allowed, denyMessage) => {
    const { socket, status, pendingPermissionQueue, permissionDecisions } = get();
    const current = pendingPermissionQueue[0];
    if (!current) return;

    const decision = { allowed, denyMessage };
    const nextDecisions = { ...permissionDecisions, [current.requestId]: decision };

    const payload = {
      type: "permission_response",
      request_id: current.requestId,
      allowed,
      deny_message: denyMessage,
    };

    if (socket && status === "connected" && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      const nextQueue = pendingPermissionQueue.slice(1);
      const rest = { ...nextDecisions };
      delete rest[current.requestId];
      set({
        pendingPermissionQueue: nextQueue,
        permissionDecisions: rest,
        permissionSendError: null,
      });
      return;
    }

    // If we can't send right now (brief websocket drop), remember the decision and retry on reconnect.
    set({
      permissionDecisions: nextDecisions,
      permissionSendError: "Disconnected from daemon; will send when reconnected.",
    });
  },

  loadMessages: async (sessionId: number) => {
    set({ isLoadingMessages: true, loadError: null });
    try {
      const [response, metrics] = await Promise.all([
        api.sessions.messages(sessionId, { limit: 100 }),
        api.sessions.metrics(sessionId, { limit: 300 }).catch(() => ({ messages: [] })),
      ]);

      const metricsMessages = metrics.messages ?? [];
      const userMetrics = metricsMessages.filter((m) => m.message_type === "user");
      const assistantMetrics = metricsMessages.filter((m) => m.message_type === "assistant");
      let userIdx = 0;
      let assistantIdx = 0;

      const chatMessages: ChatMessage[] = response.messages.map((msg) => {
        const isUser = msg.role === "user";
        const metric = isUser ? userMetrics[userIdx++] : assistantMetrics[assistantIdx++];
        const blocks = msg.blocks ?? undefined;
        const mergedText =
          blocks
            ?.filter((b) => b.type === "text")
            .map((b) => b.text)
            .filter(Boolean)
            .join("\n\n") || msg.content;
        return {
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: mergedText,
          personality: metric?.personality ?? undefined,
          thinking: msg.thinking ?? undefined,
          thinkingDuration:
            !isUser && metric?.thinking_ms != null
              ? (metric.thinking_ms as number) / 1000
              : undefined,
          blocks,
          toolUses:
            msg.tool_uses?.map((tu) => ({
              id: tu.id,
              name: tu.name,
              input: tu.input,
              status: "success" as const,
            })) || [],
          toolResults:
            msg.tool_results?.map((tr) => ({
              toolUseId: tr.tool_use_id,
              name: tr.name,
              output: tr.output,
              isError: tr.is_error,
            })) || [],
          timestamp: new Date(msg.timestamp).getTime(),
          timings:
            !isUser && metric?.ttft_ms != null
              ? {
                  time_to_first_token: metric.ttft_ms as number,
                  ...(metric?.response_ms != null
                    ? { response_time: metric.response_ms as number }
                    : {}),
                }
              : undefined,
        };
      });
      set({ messages: chatMessages, isLoadingMessages: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load messages";
      console.error("Failed to load messages:", error);
      set({ isLoadingMessages: false, loadError: message });
    }
  },

  retryLoad: () => {
    const { sessionId, expectedSessionId } = get();
    const idToLoad = sessionId ?? expectedSessionId;
    if (idToLoad) {
      set({ loadError: null });
      useChatStore.getState().resumeSession(idToLoad);
    }
  },

  clearError: () => {
    set({ loadError: null, error: null });
  },
}));

function flushTextBuffer() {
  const state = useChatStore.getState();
  if (state.textBuffer) {
    useChatStore.setState((s) => ({
      streamingMessage: s.streamingMessage
        ? { ...s.streamingMessage, content: s.streamingMessage.content + s.textBuffer }
        : null,
      textBuffer: "",
      flushTimeout: null,
    }));
  }
}

function bufferText(text: string) {
  const state = useChatStore.getState();
  useChatStore.setState({ textBuffer: state.textBuffer + text });

  if (!state.flushTimeout) {
    const timeout = window.setTimeout(flushTextBuffer, 16);
    useChatStore.setState({ flushTimeout: timeout });
  }
}

function handleStreamEvent(event: StreamEvent) {
  if (event.seq !== undefined) {
    useChatStore.setState({ lastSeq: event.seq });
  }

  switch (event.type) {
    case "session_ready": {
      const data = event.data as {
        session_id: number;
        config: SessionConfig;
        is_locked?: boolean;
        name?: string | null;
      };
      const currentState = useChatStore.getState();

      // Ignore stale session_ready events (from a different session than expected)
      if (
        currentState.expectedSessionId !== null &&
        data.session_id !== currentState.expectedSessionId
      ) {
        return;
      }

      // Clear loading timeout
      if (currentState.loadingTimeoutId) {
        clearTimeout(currentState.loadingTimeoutId);
      }

      const isSessionChange = currentState.sessionId !== data.session_id;
      const isNewSession = currentState.sessionId === null;
      const pendingMessage = currentState.pendingInitialMessage;

      useChatStore.setState({
        sessionId: data.session_id,
        sessionConfig: data.config,
        sessionName: data.name ?? null,
        isLocked: data.is_locked ?? false,
        pendingInitialMessage: null,
        // NOTE: Don't clear isCreatingNewSession here - ChatView clears it after navigation
        // Always reset loading state when session is ready
        isLoadingMessages: false,
        loadError: null,
        loadingTimeoutId: null,
        expectedSessionId: null,
        // Clear messages when switching to a different session
        ...(isSessionChange && { messages: [], streamingMessage: null }),
      });

      // Load historical messages when switching sessions (but not for newly created sessions)
      if (isSessionChange && !pendingMessage) {
        useChatStore.getState().loadMessages(data.session_id);
      }

      // Send pending initial message if this is a new session
      if (isNewSession && pendingMessage) {
        useChatStore.getState().sendQuery(pendingMessage);
      }

      // Notify all listeners (e.g., to invalidate TanStack Query cache, navigate)
      const { onSessionCreatedCallbacks } = useChatStore.getState();
      for (const cb of onSessionCreatedCallbacks) {
        try {
          cb(data.session_id);
        } catch (e) {
          console.error("onSessionCreated callback error:", e);
        }
      }
      break;
    }

    case "text": {
      const data = event.data as { text: string };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) {
          return {
            streamingMessage: {
              id: generateId(),
              role: "assistant",
              content: "",
              personality: getCurrentPersonalityKey(),
              blocks: [{ type: "text", text: data.text }] satisfies ConversationBlock[],
              toolUses: [],
              toolResults: [],
              timestamp: Date.now(),
              isStreaming: true,
            },
          };
        }

        const blocks = s.streamingMessage.blocks ? [...s.streamingMessage.blocks] : [];
        const last = blocks[blocks.length - 1];
        if (last?.type === "text") {
          last.text = (last.text || "") + data.text;
        } else {
          blocks.push({ type: "text", text: data.text });
        }

        // Close any active thinking window when text arrives
        let thinkingDuration = s.streamingMessage.thinkingDuration;
        if (s.thinkingStartTime) {
          const elapsed = (Date.now() - s.thinkingStartTime) / 1000;
          thinkingDuration = (thinkingDuration ?? 0) + elapsed;
          return {
            thinkingStartTime: null,
            streamingMessage: {
              ...s.streamingMessage,
              thinkingDuration,
              blocks,
            },
          };
        }

        return {
          streamingMessage: {
            ...s.streamingMessage,
            blocks,
          },
        };
      });

      bufferText(data.text);
      break;
    }

    case "thinking": {
      const data = event.data as { text: string };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) {
          return {
            thinkingStartTime: Date.now(),
            streamingMessage: {
              id: generateId(),
              role: "assistant",
              content: "",
              personality: getCurrentPersonalityKey(),
              thinking: data.text,
              blocks: [{ type: "thinking", text: data.text }] satisfies ConversationBlock[],
              toolUses: [],
              toolResults: [],
              timestamp: Date.now(),
              isStreaming: true,
            },
          };
        }

        const blocks = s.streamingMessage.blocks ? [...s.streamingMessage.blocks] : [];
        const last = blocks[blocks.length - 1];
        if (last?.type === "thinking") {
          last.text = (last.text || "") + data.text;
        } else {
          blocks.push({ type: "thinking", text: data.text });
        }

        // Start a new thinking window if not already tracking one
        const needsStartTime = !s.thinkingStartTime;
        return {
          thinkingStartTime: needsStartTime ? Date.now() : s.thinkingStartTime,
          streamingMessage: {
            ...s.streamingMessage,
            thinking: (s.streamingMessage.thinking || "") + data.text,
            blocks,
          },
        };
      });
      break;
    }

    case "tool_use": {
      flushTextBuffer();
      const data = event.data as { id?: string; name: string; input: Record<string, unknown> };
      const toolId = data.id || generateId();
      const toolUse: ToolUse = {
        id: toolId,
        name: data.name,
        input: data.input,
        status: "pending",
      };

      useChatStore.setState((s) => {
        // Close any active thinking window when tool starts
        let thinkingDuration = s.streamingMessage?.thinkingDuration;
        if (s.thinkingStartTime) {
          const elapsed = (Date.now() - s.thinkingStartTime) / 1000;
          thinkingDuration = (thinkingDuration ?? 0) + elapsed;
        }

        if (!s.streamingMessage) {
          return {
            thinkingStartTime: null,
            streamingMessage: {
              id: generateId(),
              role: "assistant",
              content: "",
              personality: getCurrentPersonalityKey(),
              blocks: [
                { type: "tool_use", id: toolId, name: data.name, input: data.input },
              ] satisfies ConversationBlock[],
              toolUses: [toolUse],
              toolResults: [],
              timestamp: Date.now(),
              isStreaming: true,
              thinkingDuration,
            },
          };
        }

        const blocks = s.streamingMessage.blocks ? [...s.streamingMessage.blocks] : [];
        blocks.push({ type: "tool_use", id: toolId, name: data.name, input: data.input });
        return {
          thinkingStartTime: null,
          streamingMessage: {
            ...s.streamingMessage,
            toolUses: [...s.streamingMessage.toolUses, toolUse],
            blocks,
            thinkingDuration,
          },
        };
      });
      break;
    }

    case "tool_result": {
      flushTextBuffer();
      const data = event.data as {
        tool_use_id?: string;
        name: string;
        output: string;
        is_error: boolean;
      };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) return {};

        const toolUseId = data.tool_use_id;
        const toolUses = s.streamingMessage.toolUses.map((tu) => {
          const matches =
            (toolUseId && tu.id === toolUseId) ||
            (!toolUseId && tu.name === data.name && tu.status === "pending");
          if (matches) {
            return { ...tu, status: data.is_error ? "error" : "success" } as ToolUse;
          }
          return tu;
        });

        const lastPendingTool = toolUseId
          ? s.streamingMessage.toolUses.find((tu) => tu.id === toolUseId)
          : s.streamingMessage.toolUses.find(
              (tu) => tu.name === data.name && tu.status === "pending",
            );

        const toolResult: ToolResult = {
          toolUseId: lastPendingTool?.id || toolUseId || generateId(),
          name: data.name,
          output: data.output,
          isError: data.is_error,
        };

        const blocks = s.streamingMessage.blocks ? [...s.streamingMessage.blocks] : [];
        blocks.push({
          type: "tool_result",
          tool_use_id: toolResult.toolUseId,
          name: data.name,
          output: data.output,
          is_error: data.is_error,
        });

        return {
          streamingMessage: {
            ...s.streamingMessage,
            toolUses,
            toolResults: [...s.streamingMessage.toolResults, toolResult],
            blocks,
          },
        };
      });
      break;
    }

    case "done": {
      flushTextBuffer();
      const currentState = useChatStore.getState();
      const isFirstResponse = currentState.messages.length === 1; // Only user message so far
      const data = event.data as {
        response_text: string;
        tool_count: number;
        timings?: { time_to_first_token: number; response_time: number };
      };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) return { isQueryInProgress: false, thinkingStartTime: null };

        // Close any active thinking window on done
        let thinkingDuration = s.streamingMessage.thinkingDuration ?? 0;
        if (s.thinkingStartTime) {
          thinkingDuration += (Date.now() - s.thinkingStartTime) / 1000;
        }
        if (!s.streamingMessage.thinking && thinkingDuration === 0) {
          thinkingDuration = undefined;
        }

        const blocks = s.streamingMessage.blocks;
        const mergedText =
          blocks
            ?.filter((b) => b.type === "text")
            .map((b) => b.text)
            .filter(Boolean)
            .join("\n\n") || s.streamingMessage.content;

        const finalMessage: ChatMessage = {
          ...s.streamingMessage,
          isStreaming: false,
          thinkingDuration,
          timings: data.timings,
          content: mergedText,
        };

        return {
          messages: [...s.messages, finalMessage],
          streamingMessage: null,
          isQueryInProgress: false,
          thinkingStartTime: null,
        };
      });

      // Trigger name generation after first response
      if (isFirstResponse) {
        const { onFirstResponseCallbacks, sessionId } = useChatStore.getState();
        if (sessionId) {
          for (const cb of onFirstResponseCallbacks) {
            try {
              cb(sessionId);
            } catch (e) {
              console.error("onFirstResponse callback error:", e);
            }
          }
        }
      }
      break;
    }

    case "cancelled": {
      flushTextBuffer();
      useChatStore.setState((s) => {
        if (!s.streamingMessage) return { isQueryInProgress: false };

        const cancelledMessage: ChatMessage = {
          ...s.streamingMessage,
          content: s.streamingMessage.content + "\n\n*[Cancelled]*",
          isStreaming: false,
        };

        return {
          messages: [...s.messages, cancelledMessage],
          streamingMessage: null,
          isQueryInProgress: false,
        };
      });
      break;
    }

    case "error": {
      flushTextBuffer();
      const data = event.data as { message: string; recoverable: boolean };
      useChatStore.setState({
        error: data.message,
        isQueryInProgress: false,
      });
      break;
    }

    case "permission_request": {
      const data = event.data as {
        request_id: string;
        tool_name: string;
        tool_input: Record<string, unknown>;
      };
      useChatStore.setState((s) => {
        if (s.pendingPermissionQueue.some((p) => p.requestId === data.request_id)) {
          return {};
        }
        return {
          pendingPermissionQueue: [
            ...s.pendingPermissionQueue,
            {
              requestId: data.request_id,
              toolName: data.tool_name,
              toolInput: data.tool_input,
            },
          ],
        };
      });
      break;
    }

    case "pong": {
      // Heartbeat response - activity time already updated in onmessage handler
      break;
    }
  }
}

// Reconnection with exponential backoff
function scheduleReconnect() {
  const state = useChatStore.getState();

  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    useChatStore.setState({
      error: "Failed to reconnect after multiple attempts. Please refresh the page.",
    });
    return;
  }

  // Exponential backoff with jitter
  const baseDelay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(2, state.reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  const jitter = Math.random() * 1000;
  const delay = baseDelay + jitter;

  const timeoutId = window.setTimeout(() => {
    useChatStore.setState((s) => ({
      reconnectAttempts: s.reconnectAttempts + 1,
      reconnectTimeoutId: null,
      shouldReconnect: true,
    }));
    useChatStore.getState().connect();
  }, delay);

  useChatStore.setState({ reconnectTimeoutId: timeoutId });
}

// Heartbeat/keepalive mechanism
function startHeartbeat(ws: WebSocket) {
  const intervalId = window.setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }

    const state = useChatStore.getState();
    const timeSinceLastActivity = Date.now() - state.lastActivityTime;

    // If no activity for too long, connection might be dead.
    // Use a 2-interval grace period to avoid spurious reconnects on transient hiccups.
    if (timeSinceLastActivity > HEARTBEAT_INTERVAL_MS * 2 + HEARTBEAT_TIMEOUT_MS) {
      // Force reconnect
      ws.close();
      useChatStore.setState({
        status: "disconnected",
        error: "Connection timed out",
      });
      scheduleReconnect();
      return;
    }

    // Send ping to keep connection alive and detect broken connections
    try {
      // Treat outgoing heartbeat as activity so brief pong drops don't trigger reconnect.
      useChatStore.setState({ lastActivityTime: Date.now() });
      ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      // Connection is broken, will be handled by onclose
    }
  }, HEARTBEAT_INTERVAL_MS);

  useChatStore.setState({ heartbeatIntervalId: intervalId });
}

function stopHeartbeat() {
  const { heartbeatIntervalId } = useChatStore.getState();
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    useChatStore.setState({ heartbeatIntervalId: null });
  }
}
