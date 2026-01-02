const DEFAULT_WS_URL =
  process.env.DERE_DAEMON_WS_URL ??
  (process.env.DERE_DAEMON_URL
    ? process.env.DERE_DAEMON_URL.replace(/^http/, "ws")
    : "ws://localhost:8787");

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

export type SessionConfig = {
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
  config?: SessionConfig;
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

export class DaemonAgentClient {
  private readonly baseUrl: string;
  private ws: WebSocket | null = null;
  private currentSessionId: number | null = null;
  private connectLock: Promise<void> | null = null;

  constructor(baseUrl: string = DEFAULT_WS_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  get sessionId(): number | null {
    return this.currentSessionId;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.connectLock) {
      this.connectLock = (async () => {
        if (this.connected) {
          return;
        }
        const wsUrl = `${this.baseUrl}/agent/ws`;
        const ws = new WebSocket(wsUrl);
        await waitForOpen(ws);
        this.ws = ws;
        console.info(`Connected to daemon agent WebSocket at ${wsUrl}`);
      })();
    }

    try {
      await this.connectLock;
    } finally {
      this.connectLock = null;
    }
  }

  async close(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } finally {
        this.ws = null;
        this.currentSessionId = null;
      }
    }
  }

  private async send(data: ClientMessage): Promise<void> {
    if (!this.ws) {
      throw new Error("Not connected to daemon");
    }
    this.ws.send(JSON.stringify(data));
  }

  private async receive(): Promise<StreamEvent> {
    if (!this.ws) {
      throw new Error("Not connected to daemon");
    }
    return waitForMessage(this.ws);
  }

  async newSession(config: SessionConfig): Promise<number> {
    await this.connect();
    await this.send({ type: "new_session", config });
    const event = await this.receive();
    if (event.type === "session_ready") {
      const sessionId = Number(event.data.session_id);
      if (!Number.isFinite(sessionId)) {
        throw new Error(`Invalid session id: ${String(event.data.session_id)}`);
      }
      this.currentSessionId = sessionId;
      return sessionId;
    }
    if (event.type === "error") {
      throw new Error(`Failed to create session: ${String(event.data.message ?? "")}`);
    }
    throw new Error(`Unexpected response: ${event.type}`);
  }

  async resumeSession(sessionId: number): Promise<boolean> {
    await this.connect();
    await this.send({ type: "resume_session", session_id: sessionId });
    const event = await this.receive();
    if (event.type === "session_ready") {
      const id = Number(event.data.session_id);
      this.currentSessionId = Number.isFinite(id) ? id : sessionId;
      return true;
    }
    if (event.type === "error") {
      console.warn(`Failed to resume session ${sessionId}: ${String(event.data.message ?? "")}`);
      return false;
    }
    throw new Error(`Unexpected response: ${event.type}`);
  }

  async updateConfig(config: SessionConfig): Promise<boolean> {
    if (!this.currentSessionId) {
      throw new Error("No active session to update");
    }
    await this.send({ type: "update_config", config });
    const event = await this.receive();
    if (event.type === "session_ready") {
      return true;
    }
    if (event.type === "error") {
      console.warn(`Failed to update config: ${String(event.data.message ?? "")}`);
      return false;
    }
    throw new Error(`Unexpected response: ${event.type}`);
  }

  async *query(prompt: string): AsyncIterable<StreamEvent> {
    if (!this.currentSessionId) {
      throw new Error("No active session. Call newSession or resumeSession first.");
    }
    await this.send({ type: "query", prompt });
    while (true) {
      const event = await this.receive();
      yield event;
      if (event.type === "error" && event.data.recoverable === false) {
        break;
      }
      if (event.type === "done") {
        break;
      }
    }
  }

  async ensureSession(config: SessionConfig, sessionId?: number | null): Promise<number> {
    await this.connect();
    if (sessionId) {
      const resumed = await this.resumeSession(sessionId);
      if (resumed && this.currentSessionId) {
        return this.currentSessionId;
      }
    }
    return this.newSession(config);
  }
}
