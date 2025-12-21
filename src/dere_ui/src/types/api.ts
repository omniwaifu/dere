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
  sandbox_mode?: boolean;
  sandbox_mount_type?: "direct" | "copy" | "none";
  sandbox_settings?: Record<string, unknown> | null;
}

export interface SessionResponse {
  session_id: number;
  config: SessionConfig;
  claude_session_id: string | null;
  name: string | null;
  sandbox_mode: boolean;
  is_locked: boolean;
  mission_id: number | null;
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

export type ConversationBlock =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      tool_use_id: string;
      name: string;
      output: string;
      is_error: boolean;
    };

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  thinking?: string | null;
  tool_uses?: ApiToolUse[];
  tool_results?: ApiToolResult[];
  blocks?: ConversationBlock[] | null;
}

export interface MessageHistoryResponse {
  messages: ConversationMessage[];
  has_more: boolean;
}

export interface ConversationMetricMessage {
  id: number;
  message_type: string;
  timestamp: number;
  created_at?: number | null;
  personality?: string | null;
  ttft_ms?: number | null;
  response_ms?: number | null;
  thinking_ms?: number | null;
  tool_uses?: number | null;
  tool_names?: string[] | null;
}

export interface ConversationMetricsResponse {
  messages: ConversationMetricMessage[];
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
  response_time?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  personality?: string;
  thinking?: string;
  thinkingDuration?: number;
  blocks?: ConversationBlock[];
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

export interface ResultingEmotion {
  type: string;
  intensity: number;
}

export interface EmotionEvent {
  timestamp: number;
  stimulus_type: string;
  valence: number;
  intensity: number;
  resulting_emotions: ResultingEmotion[];
  reasoning: string | null;
}

export interface EmotionHistoryResponse {
  events: EmotionEvent[];
  total_count: number;
}

export interface EmotionHistoryDBResponse {
  events: EmotionEvent[];
  total_count: number;
  start_time: number;
  end_time: number;
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

export interface UserConfig {
  name: string;
}

export interface ContextConfig {
  time: boolean;
  weather: boolean;
  recent_files: boolean;
  knowledge_graph: boolean;
  activity: boolean;
  media_player: boolean;
  tasks: boolean;
  calendar: boolean;
  activity_lookback_minutes: number;
  activity_differential_enabled: boolean;
  activity_min_lookback_minutes: number;
  activity_full_lookback_threshold_minutes: number;
  activity_max_duration_hours: number;
  recent_files_timeframe: string;
  recent_files_base_path: string;
  recent_files_max_depth: number;
  show_inactive_items: boolean;
  format: string;
  max_title_length: number;
  show_duration_for_short: boolean;
  line_numbered_xml: boolean;
  update_interval_seconds: number;
  weather_cache_minutes: number;
}

export interface WeatherConfig {
  enabled: boolean;
  city: string | null;
  units: string;
}

export interface ActivityWatchConfig {
  enabled: boolean;
  url: string;
}

export interface DiscordConfig {
  token: string;
  default_persona: string;
  allowed_guilds: string;
  allowed_channels: string;
  idle_timeout_seconds: number;
  summary_grace_seconds: number;
  context_enabled: boolean;
}

export interface DatabaseConfig {
  url: string;
}

export interface DereGraphConfig {
  enabled: boolean;
  falkor_host: string;
  falkor_port: number;
  falkor_database: string;
  claude_model: string;
  embedding_dim: number;
  enable_reflection: boolean;
  idle_threshold_minutes: number;
}

export interface AmbientConfig {
  enabled: boolean;
  check_interval_minutes: number;
  idle_threshold_minutes: number;
  activity_lookback_hours: number;
  embedding_search_limit: number;
  context_change_threshold: number;
  notification_method: string;
  daemon_url: string;
  user_id: string | null;
  personality: string | null;
  escalation_enabled: boolean;
  escalation_lookback_hours: number;
  min_notification_interval_minutes: number;
  startup_delay_seconds: number;
  fsm_enabled: boolean;
  fsm_idle_interval: number[];
  fsm_monitoring_interval: number[];
  fsm_engaged_interval: number;
  fsm_cooldown_interval: number[];
  fsm_escalating_interval: number[];
  fsm_suppressed_interval: number[];
  fsm_weight_activity: number;
  fsm_weight_emotion: number;
  fsm_weight_responsiveness: number;
  fsm_weight_temporal: number;
  fsm_weight_task: number;
}

export interface PluginModeConfig {
  mode: "always" | "never" | "auto";
  directories: string[];
}

export interface PluginsConfig {
  dere_core: PluginModeConfig;
  dere_productivity: PluginModeConfig;
  dere_code: PluginModeConfig;
  dere_vault: PluginModeConfig;
}

export interface DereConfig {
  default_personality: string;
  user_id: string;
  user: UserConfig;
  context: ContextConfig;
  weather: WeatherConfig;
  activitywatch: ActivityWatchConfig;
  discord: DiscordConfig;
  database: DatabaseConfig;
  dere_graph: DereGraphConfig;
  ambient: AmbientConfig;
  plugins: PluginsConfig;
}

// Config Schema (JSON Schema with UI metadata)
export interface ConfigSchemaOption {
  value: string;
  label: string;
}

export interface ConfigSchemaProperty {
  type?: string | string[];
  anyOf?: Array<{ type: string }>;
  title?: string;
  description?: string;
  default?: unknown;
  // UI metadata from json_schema_extra
  ui_type?: "toggle" | "select" | "number" | "text" | "readonly" | "hidden";
  ui_group?: string;
  ui_order?: number;
  options?: ConfigSchemaOption[];
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  // For nested objects
  $ref?: string;
  properties?: Record<string, ConfigSchemaProperty>;
  // Section-level metadata
  ui_section?: string;
  ui_icon?: string;
}

export interface ConfigSchema {
  $defs: Record<string, {
    type: string;
    title?: string;
    description?: string;
    properties: Record<string, ConfigSchemaProperty>;
  }>;
  properties: Record<string, ConfigSchemaProperty>;
  title: string;
  type: string;
}

// Missions
export type MissionStatus = "active" | "paused" | "archived";
export type MissionExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type MissionTriggerType = "scheduled" | "manual";

export interface Mission {
  id: number;
  name: string;
  description: string | null;
  prompt: string;
  cron_expression: string;
  natural_language_schedule: string | null;
  timezone: string;
  status: MissionStatus;
  next_execution_at: string | null;
  last_execution_at: string | null;
  personality: string | null;
  allowed_tools: string[] | null;
  mcp_servers: string[] | null;
  plugins: string[] | null;
  thinking_budget: number | null;
  model: string;
  working_dir: string;
  sandbox_mode: boolean;
  sandbox_mount_type: string;
  sandbox_settings: Record<string, unknown> | null;
  run_once: boolean;
  created_at: string;
  updated_at: string;
}

export interface MissionExecution {
  id: number;
  mission_id: number;
  status: MissionExecutionStatus;
  trigger_type: MissionTriggerType;
  triggered_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  output_text: string | null;
  output_summary: string | null;
  tool_count: number;
  error_message: string | null;
  created_at: string;
}

export interface CreateMissionRequest {
  name: string;
  description?: string;
  prompt: string;
  schedule: string;
  personality?: string;
  allowed_tools?: string[];
  mcp_servers?: string[];
  plugins?: string[];
  thinking_budget?: number;
  model?: string;
  working_dir?: string;
  sandbox_mode?: boolean;
  sandbox_mount_type?: string;
  sandbox_settings?: Record<string, unknown> | null;
  run_once?: boolean;
}

export interface UpdateMissionRequest {
  name?: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  personality?: string;
  allowed_tools?: string[];
  mcp_servers?: string[];
  plugins?: string[];
  thinking_budget?: number;
  model?: string;
  working_dir?: string;
  sandbox_mode?: boolean;
  sandbox_mount_type?: string;
  sandbox_settings?: Record<string, unknown> | null;
  run_once?: boolean;
}

// Dashboard state
export interface DashboardEmotionState {
  type: string;
  intensity: number;
  last_updated: number | null;
}

export interface DashboardActivityState {
  current_app: string | null;
  current_title: string | null;
  is_idle: boolean;
  idle_duration_seconds: number;
  activity_category: "productive" | "neutral" | "distracted" | "absent";
}

export interface DashboardAmbientState {
  fsm_state: string;
  next_check_at: string | null;
  is_enabled: boolean;
}

export interface DashboardStateResponse {
  emotion: DashboardEmotionState;
  activity: DashboardActivityState;
  ambient: DashboardAmbientState;
  timestamp: string;
}

// Summary Context
export interface SummaryContextResponse {
  summary: string | null;
  session_ids: number[];
  created_at: string | null;
}

// Memory
export type CoreMemoryScope = "user" | "session";
export type CoreMemoryBlockType = "persona" | "human" | "task";

export interface CoreMemoryBlock {
  id: number;
  block_type: CoreMemoryBlockType;
  content: string;
  scope: CoreMemoryScope;
  session_id: number | null;
  user_id: string | null;
  char_limit: number;
  version: number;
  updated_at: string | null;
}

export interface CoreMemoryEditResponse {
  block: CoreMemoryBlock;
  created: boolean;
}

export interface CoreMemoryHistoryEntry {
  block_id: number;
  version: number;
  content: string;
  reason: string | null;
  created_at: string | null;
}

export interface CoreMemoryRollbackResponse {
  block: CoreMemoryBlock;
  rolled_back_to: number;
}

export interface RecallSearchResult {
  block_id: number;
  conversation_id: number;
  session_id: number;
  message_type: string;
  timestamp: number;
  medium: string | null;
  user_id: string | null;
  text: string;
  score: number;
}

export interface RecallSearchResponse {
  query: string;
  results: RecallSearchResult[];
}

export interface ArchivalFactInsertResponse {
  created: boolean;
  fact: KGFactSummary;
}

export interface ConsolidationRun {
  id: number;
  user_id: string | null;
  task_id: number | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  recency_days: number | null;
  community_resolution: number | null;
  update_core_memory: boolean;
  triggered_by: string | null;
  stats: Record<string, number> | null;
  error_message: string | null;
}

export interface ConsolidationRunsResponse {
  runs: ConsolidationRun[];
  total: number;
  offset: number;
  limit: number;
}

// Knowledge Graph
export interface KGEntitySummary {
  uuid: string;
  name: string;
  labels: string[];
  summary: string;
  mention_count: number;
  retrieval_quality: number;
  last_mentioned: string | null;
  created_at: string;
}

export interface KGEdgeSummary {
  uuid: string;
  source_uuid: string;
  source_name: string;
  target_uuid: string;
  target_name: string;
  relation: string;
  fact: string;
  strength: number | null;
  valid_at: string | null;
  invalid_at: string | null;
  created_at: string;
}

export interface KGFactRoleSummary {
  entity_uuid: string;
  entity_name: string;
  role: string;
  role_description: string | null;
}

export interface KGFactSummary {
  uuid: string;
  fact: string;
  roles: KGFactRoleSummary[];
  attributes: Record<string, unknown> | null;
  valid_at: string | null;
  invalid_at: string | null;
  created_at: string;
}

export interface KGEntityListResponse {
  entities: KGEntitySummary[];
  total: number;
  offset: number;
  limit: number;
}

export interface KGSearchResultsResponse {
  entities: KGEntitySummary[];
  edges: KGEdgeSummary[];
  facts: KGFactSummary[];
  query: string;
}

export interface KGFactSearchResponse {
  facts: KGFactSummary[];
  query: string;
}

export interface KGTimelineFact {
  kind: "edge" | "fact";
  edge?: KGEdgeSummary;
  fact?: KGFactSummary;
  temporal_status: "valid" | "expired" | "future";
}

export interface KGFactsTimelineResponse {
  facts: KGTimelineFact[];
  total: number;
  offset: number;
}

export interface KGTopEntity {
  uuid: string;
  name: string;
  labels: string[];
  mention_count: number;
  retrieval_quality: number;
}

export interface KGStatsResponse {
  total_entities: number;
  total_facts: number;
  total_edges: number;
  total_communities: number;
  top_mentioned: KGTopEntity[];
  top_quality: KGTopEntity[];
  top_fact_roles: { role: string; count: number }[];
  top_fact_entities: { uuid: string; name: string; labels: string[]; count: number }[];
  label_distribution: Record<string, number>;
}

export interface KGCommunityInfo {
  name: string;
  summary: string;
  member_count: number;
}

export interface KGCommunitiesResponse {
  communities: KGCommunityInfo[];
}

export interface KGLabelsResponse {
  labels: string[];
}

// Personality Editor Types
export type PersonalitySource = "embedded" | "user" | "override";

export interface PersonalityEditorInfo {
  name: string;
  short_name: string;
  color: string;
  icon: string;
  source: PersonalitySource;
  has_embedded: boolean;
}

export interface PersonalitiesEditorResponse {
  personalities: PersonalityEditorInfo[];
}

export interface PersonalityMetadata {
  name: string;
  short_name: string;
  aliases?: string[];
}

export interface PersonalityDisplay {
  color: string;
  icon: string;
  announcement?: string;
  avatar?: string | null;
}

export interface PersonalityPrompt {
  content: string;
}

export interface PersonalityData {
  metadata: PersonalityMetadata;
  display: PersonalityDisplay;
  prompt: PersonalityPrompt;
}

export interface PersonalityDetailResponse {
  data: PersonalityData;
  is_override: boolean;
  has_embedded: boolean;
}
