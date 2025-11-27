import { create } from "zustand";
import type {
  SessionConfig,
  ChatMessage,
  ToolUse,
  ToolResult,
  StreamEvent,
} from "@/types/api";

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

  // Text buffering for streaming
  textBuffer: string;
  flushTimeout: number | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  newSession: (config: SessionConfig) => void;
  resumeSession: (id: number, lastSeq?: number) => void;
  sendQuery: (prompt: string) => void;
  cancelQuery: () => void;
  updateConfig: (config: SessionConfig) => void;
  clearMessages: () => void;
  addUserMessage: (content: string) => void;
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
  textBuffer: "",
  flushTimeout: null,

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

  newSession: (config) => {
    const { socket, status } = get();
    if (!socket || status !== "connected") {
      set({ error: "Not connected" });
      return;
    }

    socket.send(JSON.stringify({ type: "new_session", config }));
    set({ messages: [], streamingMessage: null, isQueryInProgress: false });
  },

  resumeSession: (id, lastSeq) => {
    const { socket, status } = get();
    if (!socket || status !== "connected") {
      set({ error: "Not connected" });
      return;
    }

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
  },

  clearMessages: () => {
    set({ messages: [], streamingMessage: null });
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
  const state = useChatStore.getState();

  if (event.seq !== undefined) {
    useChatStore.setState({ lastSeq: event.seq });
  }

  switch (event.type) {
    case "session_ready": {
      const data = event.data as {
        session_id: number;
        config: SessionConfig;
      };
      useChatStore.setState({
        sessionId: data.session_id,
        sessionConfig: data.config,
      });
      break;
    }

    case "text": {
      const data = event.data as { text: string };

      if (!state.streamingMessage) {
        const newMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: "",
          toolUses: [],
          toolResults: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        useChatStore.setState({ streamingMessage: newMessage });
      }

      bufferText(data.text);
      break;
    }

    case "thinking": {
      const data = event.data as { text: string };

      useChatStore.setState((s) => {
        if (!s.streamingMessage) {
          return {
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
      useChatStore.setState((s) => {
        if (!s.streamingMessage) return { isQueryInProgress: false };

        const finalMessage: ChatMessage = {
          ...s.streamingMessage,
          isStreaming: false,
        };

        return {
          messages: [...s.messages, finalMessage],
          streamingMessage: null,
          isQueryInProgress: false,
        };
      });
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
  }
}
