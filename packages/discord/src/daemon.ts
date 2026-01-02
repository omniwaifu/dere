const DEFAULT_DAEMON_URL = process.env.DERE_DAEMON_URL ?? "http://localhost:8787";

export class DaemonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonError";
  }
}

export type ConversationCapturePayload = {
  session_id: number;
  personality: string;
  project_path: string;
  prompt: string;
  message_type: "user" | "assistant" | "system";
  command_name?: string | null;
  command_args?: string | null;
  exit_code: number;
  is_command: boolean;
  medium: string;
  user_id?: string | null;
};

export type SessionEndPayload = {
  session_id: number;
  exit_reason?: string;
  duration_seconds?: number;
};

type JsonRecord = Record<string, unknown>;

export class DaemonClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string = DEFAULT_DAEMON_URL, timeoutSeconds = 10) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = Math.max(0, timeoutSeconds * 1000);
  }

  async close(): Promise<void> {
    // no persistent client to close
  }

  private async request<T = JsonRecord>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new DaemonError(`Daemon request failed (${resp.status}): ${text}`);
      }
      if (resp.status === 204) {
        return {} as T;
      }
      return (await resp.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<JsonRecord> {
    return this.request("/health");
  }

  async registerPresence(userId: string, availableChannels: JsonRecord[]): Promise<void> {
    await this.request("/presence/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        medium: "discord",
        user_id: userId,
        available_channels: availableChannels,
      }),
    });
  }

  async heartbeatPresence(userId: string): Promise<void> {
    await this.request("/presence/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ medium: "discord", user_id: userId }),
    });
  }

  async unregisterPresence(userId: string): Promise<void> {
    await this.request("/presence/unregister", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ medium: "discord", user_id: userId }),
    });
  }

  async getPendingNotifications(): Promise<JsonRecord[]> {
    const data = await this.request<{ notifications?: JsonRecord[] }>(
      "/notifications/pending?medium=discord",
    );
    return data.notifications ?? [];
  }

  async markNotificationDelivered(notificationId: number): Promise<void> {
    await this.request(`/notifications/${notificationId}/delivered`, { method: "POST" });
  }

  async markNotificationAcknowledged(notificationId: number): Promise<void> {
    await this.request(`/notifications/${notificationId}/acknowledge`, { method: "POST" });
  }

  async markNotificationFailed(notificationId: number, error: string): Promise<void> {
    await this.request(`/notifications/${notificationId}/failed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notification_id: notificationId, error_message: error }),
    });
  }

  async createSession(workingDir: string, personality: string): Promise<number> {
    const data = await this.request<JsonRecord>("/sessions/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ working_dir: workingDir, personality, medium: "discord" }),
    });
    const sessionId = Number(data.session_id);
    if (!Number.isFinite(sessionId)) {
      throw new DaemonError(`Invalid session response: ${JSON.stringify(data)}`);
    }
    return sessionId;
  }

  async findOrCreateSession(args: {
    workingDir: string;
    personality: string;
    maxAgeHours?: number | null;
    userId?: string | null;
  }): Promise<{ sessionId: number; resumed: boolean; claudeSessionId: string | null }> {
    const payload = {
      working_dir: args.workingDir,
      personality: args.personality,
      medium: "discord",
      max_age_hours: args.maxAgeHours ?? null,
      user_id: args.userId ?? null,
    };
    const data = await this.request<JsonRecord>("/sessions/find_or_create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const sessionId = Number(data.session_id);
    if (!Number.isFinite(sessionId)) {
      throw new DaemonError(`Invalid session response: ${JSON.stringify(data)}`);
    }

    return {
      sessionId,
      resumed: Boolean(data.resumed),
      claudeSessionId: typeof data.claude_session_id === "string" ? data.claude_session_id : null,
    };
  }

  async updateClaudeSessionId(sessionId: number, claudeSessionId: string): Promise<void> {
    await this.request(`/sessions/${sessionId}/claude_session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(claudeSessionId),
    });
  }

  async captureMessage(payload: ConversationCapturePayload): Promise<void> {
    await this.request("/conversation/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async endSession(payload: SessionEndPayload): Promise<JsonRecord> {
    return this.request("/sessions/end", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async queueSummary(sessionId: number): Promise<JsonRecord> {
    return this.endSession({ session_id: sessionId });
  }

  async getEmotionSummary(sessionId: number): Promise<string> {
    const data = await this.request<JsonRecord>(`/emotion/summary/${sessionId}`);
    const summary = data.summary;
    return typeof summary === "string" && summary.trim()
      ? summary
      : "Currently in a neutral emotional state.";
  }
}
