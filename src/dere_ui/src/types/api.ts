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

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
  timestamp: number;
  seq?: number;
}

export interface SessionConfig {
  working_dir: string;
  output_style?: string;
  personality?: string | string[];
  model?: string;
  user_id?: string;
  allowed_tools?: string[];
  include_context?: boolean;
  enable_streaming?: boolean;
  thinking_budget?: number | null;
}

export interface SessionResponse {
  session_id: number;
  config: SessionConfig;
  claude_session_id: string | null;
  name: string | null;
}

export interface SessionListResponse {
  sessions: SessionResponse[];
}

export interface OutputStyleInfo {
  name: string;
  description: string;
}

export interface PersonalityInfo {
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
}

export interface AvailableOutputStylesResponse {
  styles: OutputStyleInfo[];
}

export interface AvailablePersonalitiesResponse {
  personalities: PersonalityInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

export interface AvailableModelsResponse {
  models: ModelInfo[];
}

export interface RecentDirectoriesResponse {
  directories: string[];
}

export interface ApiToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ApiToolResult {
  tool_use_id: string;
  name: string;
  output: string;
  is_error: boolean;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  thinking?: string | null;
  tool_uses?: ApiToolUse[];
  tool_results?: ApiToolResult[];
}

export interface MessageHistoryResponse {
  messages: ConversationMessage[];
  has_more: boolean;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "success" | "error";
}

export interface ToolResult {
  toolUseId: string;
  name: string;
  output: string;
  isError: boolean;
}

export interface ResponseTimings {
  time_to_first_token: number;
  response_time: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  timestamp: number;
  isStreaming?: boolean;
  timings?: ResponseTimings;
}

export type ClientMessageType =
  | "new_session"
  | "resume_session"
  | "query"
  | "update_config"
  | "cancel"
  | "close"
  | "permission_response";

export interface ClientMessage {
  type: ClientMessageType;
  config?: SessionConfig;
  session_id?: number;
  prompt?: string;
  last_seq?: number;
  request_id?: string;
  allowed?: boolean;
  deny_message?: string;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface EmotionStateResponse {
  has_emotion: boolean;
  state?: string;
  dominant_emotion?: string;
  intensity?: number;
  last_updated?: number;
  active_emotions?: Record<string, { intensity: number; last_updated: number }>;
  error?: string;
}

export interface EmotionSummaryResponse {
  summary: string;
}

export interface EmotionEvent {
  timestamp: number;
  stimulus_type: string;
  valence: number;
  intensity: number;
  resulting_emotion: string | null;
}

export interface EmotionHistoryResponse {
  events: EmotionEvent[];
  total_count: number;
}

export interface OCCGoal {
  id: string;
  description: string;
  importance: number;
  active: boolean;
}

export interface OCCStandard {
  id: string;
  description: string;
  importance: number;
}

export interface OCCAttitude {
  id: string;
  target_object: string;
  description: string;
  appealingness: number;
}

export interface EmotionProfileResponse {
  has_profile: boolean;
  profile_path: string | null;
  goals: OCCGoal[];
  standards: OCCStandard[];
  attitudes: OCCAttitude[];
}

export interface Task {
  uuid: string;
  description: string;
  status: string;
  project: string | null;
  tags: string[];
  entry: string;
  modified: string | null;
  end: string | null;
  due: string | null;
  urgency: number;
}

export interface TasksResponse {
  tasks: Task[];
  pending_count: number;
  completed_count: number;
}
