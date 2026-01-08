/**
 * WebSocket client for daemon agent streaming.
 *
 * Used by mediums (Discord, Matrix, etc.) to stream queries to the daemon.
 * Provides session management and query streaming over WebSocket.
 */

export type StreamEventType =
  | "session_ready"
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "error"
  | "done"
  | "cancelled"
  | "permission_request";

export type StreamEvent = {
  type: StreamEventType;
  data: Record<string, unknown>;
  timestamp?: number;
  seq?: number;
};

export type AgentSessionConfig = {
  working_dir: string;
  output_style?: string;
  personality?: string | string[];
  model?: string | null;
  user_id?: string | null;
  allowed_tools?: string[] | null;
  include_context?: boolean;
  enable_streaming?: boolean;
  thinking_budget?: number | null;
  sandbox_mode?: boolean;
  sandbox_mount_type?: "direct" | "copy" | "none";
  sandbox_settings?: Record<string, unknown> | null;
  sandbox_network_mode?: "bridge" | "host";
  mission_id?: number | null;
  session_name?: string | null;
  auto_approve?: boolean;
  lean_mode?: boolean;
  swarm_agent_id?: number | null;
  plugins?: string[] | null;
  env?: Record<string, string> | null;
  output_format?: Record<string, unknown> | null;
};

type ClientMessageType =
  | "new_session"
  | "resume_session"
  | "query"
  | "update_config"
  | "ping"
  | "close";

type ClientMessage = {
  type: ClientMessageType;
  config?: AgentSessionConfig;
  session_id?: number;
  prompt?: string;
  last_seq?: number;
};

function parseStreamEvent(raw: string): StreamEvent {
  const parsed = JSON.parse(raw) as StreamEvent;
  return {
    type: parsed.type,
    data: parsed.data ?? {},
    timestamp: parsed.timestamp ?? Date.now() / 1000,
    seq: parsed.seq ?? 0,
  };
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket connection failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before opening"));
    };
    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

function waitForMessage(ws: WebSocket): Promise<StreamEvent> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup();
      try {
        const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
        resolve(parseStreamEvent(raw));
      } catch (error) {
        reject(error);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket error"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed"));
    };
    const cleanup = () => {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

export interface AgentClientOptions {
  baseUrl: string;
}

/**
 * Create a WebSocket client for daemon agent streaming.
 */
export function createAgentClient(options: AgentClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  let ws: WebSocket | null = null;
  let currentSessionId: number | null = null;
  let connectLock: Promise<void> | null = null;

  async function connect(): Promise<void> {
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (!connectLock) {
      connectLock = (async () => {
        if (ws !== null && ws.readyState === WebSocket.OPEN) {
          return;
        }
        const wsUrl = `${baseUrl}/agent/ws`;
        const socket = new WebSocket(wsUrl);
        await waitForOpen(socket);
        ws = socket;
      })();
    }

    try {
      await connectLock;
    } finally {
      connectLock = null;
    }
  }

  async function send(data: ClientMessage): Promise<void> {
    if (!ws) {
      throw new Error("Not connected to daemon");
    }
    ws.send(JSON.stringify(data));
  }

  async function receive(): Promise<StreamEvent> {
    if (!ws) {
      throw new Error("Not connected to daemon");
    }
    return waitForMessage(ws);
  }

  return {
    get sessionId(): number | null {
      return currentSessionId;
    },

    get connected(): boolean {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    },

    connect,

    async close(): Promise<void> {
      if (ws) {
        try {
          ws.close();
        } finally {
          ws = null;
          currentSessionId = null;
        }
      }
    },

    async newSession(config: AgentSessionConfig): Promise<number> {
      await connect();
      await send({ type: "new_session", config });
      const event = await receive();
      if (event.type === "session_ready") {
        const sessionId = Number(event.data.session_id);
        if (!Number.isFinite(sessionId)) {
          throw new Error(`Invalid session id: ${String(event.data.session_id)}`);
        }
        currentSessionId = sessionId;
        return sessionId;
      }
      if (event.type === "error") {
        throw new Error(`Failed to create session: ${String(event.data.message ?? "")}`);
      }
      throw new Error(`Unexpected response: ${event.type}`);
    },

    async resumeSession(sessionId: number, userId?: string | null): Promise<boolean> {
      await connect();
      await send({ type: "resume_session", session_id: sessionId, user_id: userId ?? undefined });
      const event = await receive();
      if (event.type === "session_ready") {
        const id = Number(event.data.session_id);
        currentSessionId = Number.isFinite(id) ? id : sessionId;
        return true;
      }
      if (event.type === "error") {
        console.warn(`Failed to resume session ${sessionId}: ${String(event.data.message ?? "")}`);
        return false;
      }
      throw new Error(`Unexpected response: ${event.type}`);
    },

    async updateConfig(config: AgentSessionConfig): Promise<boolean> {
      if (!currentSessionId) {
        throw new Error("No active session to update");
      }
      await send({ type: "update_config", config });
      const event = await receive();
      if (event.type === "session_ready") {
        return true;
      }
      if (event.type === "error") {
        console.warn(`Failed to update config: ${String(event.data.message ?? "")}`);
        return false;
      }
      throw new Error(`Unexpected response: ${event.type}`);
    },

    async *query(prompt: string): AsyncIterable<StreamEvent> {
      if (!currentSessionId) {
        throw new Error("No active session. Call newSession or resumeSession first.");
      }
      await send({ type: "query", prompt });
      while (true) {
        const event = await receive();
        yield event;
        if (event.type === "error" && event.data.recoverable === false) {
          break;
        }
        if (event.type === "done") {
          break;
        }
      }
    },

    async ensureSession(config: AgentSessionConfig, sessionId?: number | null): Promise<number> {
      await connect();
      if (sessionId) {
        const resumed = await this.resumeSession(sessionId, config.user_id);
        if (resumed && currentSessionId) {
          // Update config on resumed session to apply new settings
          await this.updateConfig(config);
          return currentSessionId;
        }
      }
      return this.newSession(config);
    },
  };
}

export type AgentClient = ReturnType<typeof createAgentClient>;
