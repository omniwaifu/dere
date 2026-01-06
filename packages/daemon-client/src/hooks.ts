/**
 * Typed client for Hook Protocol endpoints.
 *
 * Use this from mediums that CAN import workspace packages (matrix bot in monorepo, etc.)
 * For standalone scripts (Claude Code plugins), use raw fetch with the documented endpoints.
 */

import type {
  CreateSessionRequest,
  CreateSessionResponse,
  FindOrCreateSessionRequest,
  FindOrCreateSessionResponse,
  GetSessionContextRequest,
  GetSessionContextResponse,
  EndSessionRequest,
  EndSessionResponse,
  CaptureConversationRequest,
  CaptureConversationResponse,
  RegisterPresenceRequest,
  RegisterPresenceResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  UnregisterPresenceRequest,
  UnregisterPresenceResponse,
  GetAvailablePresenceResponse,
  GetPendingNotificationsResponse,
  MarkNotificationDeliveredResponse,
  MarkNotificationAcknowledgedResponse,
  MarkNotificationFailedResponse,
  GetStatusRequest,
  GetStatusResponse,
} from "./hook-protocol.js";

export interface HookClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

async function post<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function get<T>(
  baseUrl: string,
  path: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function createHookClient(options: HookClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    // -------------------------------------------------------------------------
    // Session lifecycle
    // -------------------------------------------------------------------------

    /**
     * Create a new session.
     */
    async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
      return post(baseUrl, "/sessions/create", req, fetcher, timeoutMs);
    },

    /**
     * Find existing recent session or create new one.
     */
    async findOrCreateSession(
      req: FindOrCreateSessionRequest,
    ): Promise<FindOrCreateSessionResponse> {
      return post(baseUrl, "/sessions/find_or_create", req, fetcher, timeoutMs);
    },

    /**
     * Get context to inject at session start (personality, memories, emotion).
     */
    async getSessionContext(
      req: GetSessionContextRequest,
    ): Promise<GetSessionContextResponse> {
      return post(baseUrl, "/context/build_session_start", req, fetcher, timeoutMs);
    },

    /**
     * End a session. Triggers emotion flush, summary generation.
     */
    async endSession(req: EndSessionRequest): Promise<EndSessionResponse> {
      return post(baseUrl, "/sessions/end", req, fetcher, timeoutMs);
    },

    // -------------------------------------------------------------------------
    // Conversation
    // -------------------------------------------------------------------------

    /**
     * Capture a conversation turn (user message or assistant response).
     */
    async captureConversation(
      req: CaptureConversationRequest,
    ): Promise<CaptureConversationResponse> {
      return post(baseUrl, "/conversation/capture", req, fetcher, timeoutMs);
    },

    // -------------------------------------------------------------------------
    // Presence
    // -------------------------------------------------------------------------

    presence: {
      /**
       * Register this medium as online.
       */
      async register(req: RegisterPresenceRequest): Promise<RegisterPresenceResponse> {
        return post(baseUrl, "/presence/register", req, fetcher, timeoutMs);
      },

      /**
       * Send heartbeat. Call every 30-60 seconds.
       */
      async heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse> {
        return post(baseUrl, "/presence/heartbeat", req, fetcher, timeoutMs);
      },

      /**
       * Unregister on graceful shutdown.
       */
      async unregister(req: UnregisterPresenceRequest): Promise<UnregisterPresenceResponse> {
        return post(baseUrl, "/presence/unregister", req, fetcher, timeoutMs);
      },

      /**
       * Get available mediums for a user.
       */
      async available(userId: string): Promise<GetAvailablePresenceResponse> {
        return get(baseUrl, `/presence/available?user_id=${encodeURIComponent(userId)}`, fetcher, timeoutMs);
      },
    },

    // -------------------------------------------------------------------------
    // Notifications (proactive contact)
    // -------------------------------------------------------------------------

    notifications: {
      /**
       * Get pending notifications for this medium.
       */
      async getPending(medium: string): Promise<GetPendingNotificationsResponse> {
        return get(
          baseUrl,
          `/notifications/pending?medium=${encodeURIComponent(medium)}`,
          fetcher,
          timeoutMs,
        );
      },

      /**
       * Mark notification as delivered.
       */
      async markDelivered(id: number): Promise<MarkNotificationDeliveredResponse> {
        return post(baseUrl, `/notifications/${id}/delivered`, {}, fetcher, timeoutMs);
      },

      /**
       * Mark notification as acknowledged.
       */
      async markAcknowledged(id: number): Promise<MarkNotificationAcknowledgedResponse> {
        return post(baseUrl, `/notifications/${id}/acknowledge`, {}, fetcher, timeoutMs);
      },

      /**
       * Mark notification as failed.
       */
      async markFailed(id: number, errorMessage: string): Promise<MarkNotificationFailedResponse> {
        return post(
          baseUrl,
          `/notifications/${id}/failed`,
          { error_message: errorMessage },
          fetcher,
          timeoutMs,
        );
      },
    },

    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------

    /**
     * Get daemon status.
     */
    async getStatus(req: GetStatusRequest): Promise<GetStatusResponse> {
      return post(baseUrl, "/status/get", req, fetcher, timeoutMs);
    },
  };
}

export type HookClient = ReturnType<typeof createHookClient>;
