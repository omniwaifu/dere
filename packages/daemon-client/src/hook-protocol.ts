/**
 * Hook Protocol - Interface for medium integrations (CLI, UI, Matrix, etc.)
 *
 * This module defines the contract between the daemon and client mediums.
 * Mediums (ways to interact with dere) implement this protocol to:
 * - Get context at session start (personality, memories, emotion)
 * - Report conversation events (for memory, OCC updates)
 * - Register presence (so daemon knows what mediums are available)
 *
 * All endpoints are REST (not tRPC) because plugins run as standalone
 * scripts and can't import workspace packages. The daemon-client package
 * can import this for type hints, but plugins copy the interface shape.
 *
 * Base URL: configured via DERE_DAEMON_URL env var (default http://localhost:8787)
 */

// -----------------------------------------------------------------------------
// Session Context
// -----------------------------------------------------------------------------

/**
 * GET /context/build_session_start
 *
 * Called at session start to get injected context (personality prompt,
 * recent memories, emotion state, etc.)
 */
export interface GetSessionContextRequest {
  session_id: number;
  user_id: string;
  working_dir?: string;
  medium?: string; // 'cli' | 'ui' | 'matrix' | etc.
}

export interface GetSessionContextResponse {
  status: "ready" | "cached" | "building" | "error";
  context?: string; // The context to inject into the conversation
}

// -----------------------------------------------------------------------------
// Session Lifecycle
// -----------------------------------------------------------------------------

/**
 * POST /sessions/end
 *
 * Called when a session ends (user exits, timeout, etc.)
 * Triggers emotion flush, summary generation, etc.
 */
export interface EndSessionRequest {
  session_id: number;
  exit_reason?: string; // 'normal' | 'error' | 'timeout' | etc.
}

export interface EndSessionResponse {
  status: "ended" | "error";
  summary_generated?: boolean;
}

// -----------------------------------------------------------------------------
// Conversation Capture
// -----------------------------------------------------------------------------

/**
 * POST /conversation/capture
 *
 * Called to record a conversation turn (user message or assistant response).
 * Triggers curiosity detection, emotion stimulus, knowledge extraction.
 */
export interface CaptureConversationRequest {
  session_id: number;
  personality?: string;
  project_path?: string;
  prompt: string; // The message content
  message_type: "user" | "assistant";
  is_command?: boolean;
}

export interface CaptureConversationResponse {
  status: "captured" | "error";
  conversation_id?: number;
}

// -----------------------------------------------------------------------------
// Presence Management
// -----------------------------------------------------------------------------

/**
 * POST /presence/register
 *
 * Called when a medium comes online. Daemon tracks available mediums
 * for proactive contact decisions.
 */
export interface RegisterPresenceRequest {
  medium: string; // 'cli' | 'matrix' | 'discord' | etc.
  user_id: string;
  available_channels: Array<{
    channel_id?: string;
    channel_name?: string;
    [key: string]: unknown;
  }>;
}

export interface RegisterPresenceResponse {
  status: "registered" | "error";
}

/**
 * POST /presence/heartbeat
 *
 * Keep-alive ping. Mediums should send every 30-60 seconds.
 * Stale presences (no heartbeat for 5 minutes) are auto-cleaned.
 */
export interface HeartbeatRequest {
  medium: string;
  user_id: string;
}

export interface HeartbeatResponse {
  status: "ok" | "error";
}

/**
 * POST /presence/unregister
 *
 * Called when a medium goes offline gracefully.
 */
export interface UnregisterPresenceRequest {
  medium: string;
  user_id: string;
}

export interface UnregisterPresenceResponse {
  status: "unregistered" | "error";
}

/**
 * GET /presence/available?user_id=xxx
 *
 * Query which mediums are currently online for a user.
 */
export interface GetAvailablePresenceResponse {
  mediums: Array<{
    medium: string;
    available_channels: unknown[];
    last_heartbeat: string;
  }>;
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

/**
 * POST /status/get
 *
 * Get daemon status including personality info, available MCP servers, etc.
 */
export interface GetStatusRequest {
  personality?: string;
  mcp_servers?: string[];
  context?: boolean;
}

export interface GetStatusResponse {
  status: "ok" | "error";
  personality?: {
    name: string;
    description?: string;
  };
  context?: string;
  [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Session Creation
// -----------------------------------------------------------------------------

/**
 * POST /sessions/create
 *
 * Create a new session for this medium.
 */
export interface CreateSessionRequest {
  working_dir: string;
  personality?: string | null;
  medium: string;
  user_id?: string | null;
}

export interface CreateSessionResponse {
  session_id: number;
}

/**
 * POST /sessions/find_or_create
 *
 * Find an existing recent session or create a new one.
 * Useful for mediums that want session continuity.
 */
export interface FindOrCreateSessionRequest {
  working_dir: string;
  personality?: string | null;
  medium: string;
  max_age_hours?: number | null;
  user_id?: string | null;
}

export interface FindOrCreateSessionResponse {
  session_id: number;
  resumed: boolean;
  claude_session_id: string | null;
}

// -----------------------------------------------------------------------------
// Notifications (for proactive contact)
// -----------------------------------------------------------------------------

/**
 * GET /notifications/pending?medium=xxx
 *
 * Get pending notifications for this medium.
 * Daemon queues these when it wants to proactively contact user.
 */
export interface PendingNotification {
  id: number;
  medium: string;
  channel_id?: string;
  message: string;
  priority: number;
  created_at: string;
  [key: string]: unknown;
}

export interface GetPendingNotificationsResponse {
  notifications: PendingNotification[];
}

/**
 * POST /notifications/{id}/delivered
 *
 * Mark notification as delivered (sent to user).
 */
export interface MarkNotificationDeliveredResponse {
  status: "ok" | "error";
}

/**
 * POST /notifications/{id}/acknowledge
 *
 * Mark notification as acknowledged (user responded).
 */
export interface MarkNotificationAcknowledgedResponse {
  status: "ok" | "error";
}

/**
 * POST /notifications/{id}/failed
 *
 * Mark notification as failed to deliver.
 */
export interface MarkNotificationFailedRequest {
  error_message: string;
}

export interface MarkNotificationFailedResponse {
  status: "ok" | "error";
}

// -----------------------------------------------------------------------------
// Protocol Summary
// -----------------------------------------------------------------------------

/**
 * HookProtocol - The complete interface for medium integrations.
 *
 * Typical flow for a new medium:
 * 1. On startup: presence.register()
 * 2. Periodically: presence.heartbeat() every 30-60s
 * 3. Periodically: notifications.getPending() to check for proactive contact
 * 4. On user starts conversation: sessions.findOrCreate() or sessions.create()
 * 5. On session start: getSessionContext() → inject into conversation
 * 6. On user message: captureConversation(message_type: 'user')
 * 7. On assistant response: captureConversation(message_type: 'assistant')
 * 8. On session end: endSession()
 * 9. On shutdown: presence.unregister()
 */
export interface HookProtocol {
  // Session lifecycle
  createSession(req: CreateSessionRequest): Promise<CreateSessionResponse>;
  findOrCreateSession(req: FindOrCreateSessionRequest): Promise<FindOrCreateSessionResponse>;
  getSessionContext(req: GetSessionContextRequest): Promise<GetSessionContextResponse>;
  endSession(req: EndSessionRequest): Promise<EndSessionResponse>;

  // Conversation capture
  captureConversation(req: CaptureConversationRequest): Promise<CaptureConversationResponse>;

  // Presence management
  presence: {
    register(req: RegisterPresenceRequest): Promise<RegisterPresenceResponse>;
    heartbeat(req: HeartbeatRequest): Promise<HeartbeatResponse>;
    unregister(req: UnregisterPresenceRequest): Promise<UnregisterPresenceResponse>;
    available(userId: string): Promise<GetAvailablePresenceResponse>;
  };

  // Notifications (proactive contact from daemon)
  notifications: {
    getPending(medium: string): Promise<GetPendingNotificationsResponse>;
    markDelivered(id: number): Promise<MarkNotificationDeliveredResponse>;
    markAcknowledged(id: number): Promise<MarkNotificationAcknowledgedResponse>;
    markFailed(id: number, errorMessage: string): Promise<MarkNotificationFailedResponse>;
  };

  // Status
  getStatus(req: GetStatusRequest): Promise<GetStatusResponse>;
}
