export type StreamEventType =
  | "session_ready"
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "error"
  | "done"
  | "cancelled";

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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  timestamp: number;
  isStreaming?: boolean;
}

export type ClientMessageType =
  | "new_session"
  | "resume_session"
  | "query"
  | "update_config"
  | "cancel"
  | "close";

export interface ClientMessage {
  type: ClientMessageType;
  config?: SessionConfig;
  session_id?: number;
  prompt?: string;
  last_seq?: number;
}

export interface EmotionStateResponse {
  has_emotion: boolean;
  dominant_emotion: string | null;
  intensity: number;
  last_updated: number | null;
  active_emotions: Record<string, { intensity: number; last_updated: number }>;
}

export interface EmotionSummaryResponse {
  summary: string;
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
