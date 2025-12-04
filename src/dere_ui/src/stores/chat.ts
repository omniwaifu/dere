import { create } from "zustand";
import type {
  SessionConfig,
  ChatMessage,
  ToolUse,
  ToolResult,
  StreamEvent,
  PermissionRequest,
} from "@/types/api";
import { api } from "@/lib/api";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ChatStore {
  // Connection
  status: ConnectionStatus;
  socket: WebSocket | null;
  lastSeq: number;
  error: string | null;

  // Session
  sessionId: number | null;
  sessionConfig: SessionConfig | null;

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

  // Callbacks
  onSessionCreated: ((sessionId: number) => void) | null;
  onFirstResponse: ((sessionId: number) => void) | null;

  // Pending initial message (sent after session_ready)
  pendingInitialMessage: string | null;

  // Permission requests
  pendingPermission: PermissionRequest | null;

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
  setOnSessionCreated: (cb: ((sessionId: number) => void) | null) => void;
  setOnFirstResponse: (cb: ((sessionId: number) => void) | null) => void;
  respondToPermission: (allowed: boolean, denyMessage?: string) => void;
}

const WS_URL = `ws://${window.location.hostname}:8787/agent/ws`;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  status: "disconnected",
  socket: null,
  lastSeq: 0,
  error: null,
  sessionId: null,
  sessionConfig: null,
  messages: [],
  streamingMessage: null,
  isQueryInProgress: false,
  isLoadingMessages: false,
  textBuffer: "",
  flushTimeout: null,
  thinkingStartTime: null,
  onSessionCreated: null,
  onFirstResponse: null,
  pendingInitialMessage: null,
  pendingPermission: null,

  connect: () => {
    const { socket, status } = get();
    if (socket || status === "connecting") return;

    set({ status: "connecting", error: null });

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      set({ status: "connected", socket: ws });
    };

    ws.onclose = () => {
      set({ status: "disconnected", socket: null });
    };

    ws.onerror = () => {
      set({ status: "error", error: "WebSocket connection failed" });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        handleStreamEvent(data);
      } catch {
        console.error("Failed to parse WebSocket message:", event.data);
      }
    };
  },

  disconnect: () => {
    const { socket, flushTimeout } = get();
    if (flushTimeout) {
      clearTimeout(flushTimeout);
    }
    if (socket) {
      socket.close();
    }
    set({
      status: "disconnected",
      socket: null,
      sessionId: null,
      sessionConfig: null,
      flushTimeout: null,
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
    });
  },

  resumeSession: (id, lastSeq) => {
    const { socket, status } = get();
    if (!socket || status !== "connected") {
      set({ error: "Not connected" });
      return;
    }

    // Immediately show loading state and clear old messages
    set({
      messages: [],
      streamingMessage: null,
      isLoadingMessages: true,
    });

    socket.send(
      JSON.stringify({
        type: "resume_session",
        session_id: id,
        last_seq: lastSeq,
      })
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
    const { socket, status } = get();
    if (!socket || status !== "connected") return;

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
      messages: [],
      streamingMessage: null,
      isQueryInProgress: false,
    });
  },

  addUserMessage: (content) => {
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content,
      toolUses: [],
      toolResults: [],
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, userMessage] }));
  },

  setOnSessionCreated: (cb) => {
    set({ onSessionCreated: cb });
  },

  setOnFirstResponse: (cb) => {
    set({ onFirstResponse: cb });
  },

  respondToPermission: (allowed, denyMessage) => {
    const { socket, status, pendingPermission } = get();
    if (!socket || status !== "connected" || !pendingPermission) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "permission_response",
        request_id: pendingPermission.requestId,
        allowed,
        deny_message: denyMessage,
      })
    );
    set({ pendingPermission: null });
  },

  loadMessages: async (sessionId: number) => {
    set({ isLoadingMessages: true });
    try {
      const response = await api.sessions.messages(sessionId, { limit: 100 });
      const chatMessages: ChatMessage[] = response.messages.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        thinking: msg.thinking ?? undefined,
        toolUses: msg.tool_uses?.map((tu) => ({
          id: tu.id,
          name: tu.name,
          input: tu.input,
          status: "success" as const,
        })) || [],
        toolResults: msg.tool_results?.map((tr) => ({
          toolUseId: tr.tool_use_id,
          name: tr.name,
          output: tr.output,
          isError: tr.is_error,
        })) || [],
        timestamp: new Date(msg.timestamp).getTime(),
      }));
      set({ messages: chatMessages, isLoadingMessages: false });
    } catch (error) {
      console.error("Failed to load messages:", error);
      set({ isLoadingMessages: false });
    }
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
      };
      const currentState = useChatStore.getState();
      const isSessionChange = currentState.sessionId !== data.session_id;
      const isNewSession = currentState.sessionId === null;
      const pendingMessage = currentState.pendingInitialMessage;

      useChatStore.setState({
        sessionId: data.session_id,
        sessionConfig: data.config,
        pendingInitialMessage: null,
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

      // Notify listeners (e.g., to invalidate TanStack Query cache)
      const { onSessionCreated } = useChatStore.getState();
      if (onSessionCreated) {
        onSessionCreated(data.session_id);
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
              toolUses: [],
              toolResults: [],
              timestamp: Date.now(),
              isStreaming: true,
            },
          };
        }

        // Calculate thinking duration when first text arrives (if thinking happened)
        if (s.thinkingStartTime && !s.streamingMessage.thinkingDuration) {
          const duration = (Date.now() - s.thinkingStartTime) / 1000;
          return {
            thinkingStartTime: null,
            streamingMessage: {
              ...s.streamingMessage,
              thinkingDuration: duration,
            },
          };
        }

        return {};
      });

      bufferText(data.text);
      break;
    }

    case "thinking": {
      const data = event.data as { text: string };

      useChatStore.setState((s) => {
        const isFirstThinking = !s.streamingMessage?.thinking;
        if (!s.streamingMessage) {
          return {
            thinkingStartTime: Date.now(),
            streamingMessage: {
              id: generateId(),
              role: "assistant",
              content: "",
              thinking: data.text,
              toolUses: [],
              toolResults: [],
              timestamp: Date.now(),
              isStreaming: true,
            },
          };
        }
        return {
          thinkingStartTime: isFirstThinking ? Date.now() : s.thinkingStartTime,
          streamingMessage: {
            ...s.streamingMessage,
            thinking: (s.streamingMessage.thinking || "") + data.text,
          },
        };
      });
      break;
    }

    case "tool_use": {
      flushTextBuffer();
      const data = event.data as { name: string; input: Record<string, unknown> };
      const toolUse: ToolUse = {
        id: generateId(),
        name: data.name,
        input: data.input,
        status: "pending",
      };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) {
          return {
            streamingMessage: {
              id: generateId(),
              role: "assistant",
              content: "",
              toolUses: [toolUse],
              toolResults: [],
              timestamp: Date.now(),
              isStreaming: true,
            },
          };
        }
        return {
          streamingMessage: {
            ...s.streamingMessage,
            toolUses: [...s.streamingMessage.toolUses, toolUse],
          },
        };
      });
      break;
    }

    case "tool_result": {
      flushTextBuffer();
      const data = event.data as {
        name: string;
        output: string;
        is_error: boolean;
      };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) return {};

        const toolUses = s.streamingMessage.toolUses.map((tu) => {
          if (tu.name === data.name && tu.status === "pending") {
            return { ...tu, status: data.is_error ? "error" : "success" } as ToolUse;
          }
          return tu;
        });

        const lastPendingTool = s.streamingMessage.toolUses.find(
          (tu) => tu.name === data.name && tu.status === "pending"
        );

        const toolResult: ToolResult = {
          toolUseId: lastPendingTool?.id || generateId(),
          name: data.name,
          output: data.output,
          isError: data.is_error,
        };

        return {
          streamingMessage: {
            ...s.streamingMessage,
            toolUses,
            toolResults: [...s.streamingMessage.toolResults, toolResult],
          },
        };
      });
      break;
    }

    case "done": {
      flushTextBuffer();
      const currentState = useChatStore.getState();
      const isFirstResponse = currentState.messages.length === 1; // Only user message so far

      useChatStore.setState((s) => {
        if (!s.streamingMessage) return { isQueryInProgress: false, thinkingStartTime: null };

        // Calculate thinking duration if not already set
        let thinkingDuration = s.streamingMessage.thinkingDuration;
        if (s.thinkingStartTime && !thinkingDuration) {
          thinkingDuration = (Date.now() - s.thinkingStartTime) / 1000;
        }

        const finalMessage: ChatMessage = {
          ...s.streamingMessage,
          isStreaming: false,
          thinkingDuration,
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
        const { onFirstResponse, sessionId } = useChatStore.getState();
        if (onFirstResponse && sessionId) {
          onFirstResponse(sessionId);
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
      useChatStore.setState({
        pendingPermission: {
          requestId: data.request_id,
          toolName: data.tool_name,
          toolInput: data.tool_input,
        },
      });
      break;
    }
  }
}
