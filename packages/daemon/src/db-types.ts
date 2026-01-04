import type { ColumnType, Generated } from "kysely";

type Timestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type JsonArray = unknown[] | null;

type StringArray = string[] | null;

type BigIntArray = number[] | null;

export interface MissionsTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  prompt: string;
  cron_expression: string;
  natural_language_schedule: string | null;
  timezone: string;
  run_once: boolean;
  personality: string | null;
  allowed_tools: StringArray;
  mcp_servers: StringArray;
  plugins: StringArray;
  thinking_budget: number | null;
  model: string;
  working_dir: string;
  sandbox_mode: boolean;
  sandbox_mount_type: ColumnType<string, string | undefined, string | undefined>;
  sandbox_settings: JsonValue;
  status: string;
  next_execution_at: Timestamp;
  last_execution_at: Timestamp;
  user_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface MissionExecutionsTable {
  id: Generated<number>;
  mission_id: number;
  status: string;
  trigger_type: string;
  triggered_by: string | null;
  started_at: Timestamp;
  completed_at: Timestamp;
  output_text: string | null;
  output_summary: string | null;
  tool_count: number;
  error_message: string | null;
  execution_metadata: JsonValue;
  created_at: Timestamp;
}

export interface SessionsTable {
  id: Generated<number>;
  name: string | null;
  working_dir: string;
  start_time: number;
  end_time: number | null;
  last_activity: ColumnType<Date, Date | string, Date | string>;
  continued_from: number | null;
  project_type: string | null;
  claude_session_id: string | null;
  personality: string | null;
  medium: string | null;
  user_id: string | null;
  thinking_budget: number | null;
  sandbox_mode: boolean;
  sandbox_mount_type: string;
  sandbox_settings: JsonValue;
  is_locked: boolean;
  mission_id: number | null;
  created_at: Timestamp;
  summary: string | null;
  summary_updated_at: Timestamp;
}

export interface ConversationsTable {
  id: Generated<number>;
  session_id: number;
  prompt: string;
  message_type: string;
  timestamp: number;
  medium: string | null;
  user_id: string | null;
  personality: string | null;
  ttft_ms: number | null;
  response_ms: number | null;
  thinking_ms: number | null;
  tool_uses: number | null;
  tool_names: StringArray;
  created_at: Timestamp;
}

export interface ConversationBlocksTable {
  id: Generated<number>;
  conversation_id: number;
  ordinal: number;
  block_type: string;
  text: string | null;
  tool_use_id: string | null;
  tool_name: string | null;
  tool_input: JsonValue;
  is_error: boolean | null;
  content_embedding: number[] | null;
  created_at: Timestamp;
}

export interface EntitiesTable {
  id: Generated<number>;
  session_id: number;
  conversation_id: number;
  entity_type: string;
  entity_value: string;
  normalized_value: string;
  fingerprint: string | null;
  confidence: number;
  context_start: number | null;
  context_end: number | null;
  entity_metadata: string | null;
  created_at: Timestamp;
}

export interface ContextCacheTable {
  session_id: number;
  context_text: string;
  context_metadata: JsonValue;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SummaryContextTable {
  id: Generated<number>;
  summary: string;
  session_ids: BigIntArray;
  created_at: Timestamp;
}

export interface ProjectTasksTable {
  id: Generated<number>;
  working_dir: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  context_summary: string | null;
  scope_paths: StringArray;
  required_tools: StringArray;
  task_type: string | null;
  tags: StringArray;
  estimated_effort: string | null;
  priority: number;
  status: string;
  claimed_by_session_id: number | null;
  claimed_by_agent_id: number | null;
  claimed_at: Timestamp;
  attempt_count: number;
  blocked_by: BigIntArray;
  related_task_ids: BigIntArray;
  created_by_session_id: number | null;
  created_by_agent_id: number | null;
  discovered_from_task_id: number | null;
  discovery_reason: string | null;
  outcome: string | null;
  completion_notes: string | null;
  files_changed: StringArray;
  follow_up_task_ids: BigIntArray;
  last_error: string | null;
  extra: JsonValue;
  created_at: Timestamp;
  updated_at: Timestamp;
  started_at: Timestamp;
  completed_at: Timestamp;
}

export interface AmbientNotificationsTable {
  id: Generated<number>;
  user_id: string;
  target_medium: string;
  target_location: string;
  message: string;
  priority: string;
  routing_reasoning: string | null;
  status: string;
  error_message: string | null;
  created_at: Timestamp;
  delivered_at: Timestamp;
  parent_notification_id: number | null;
  acknowledged: boolean;
  acknowledged_at: Timestamp;
  response_time: Timestamp;
}

export interface NotificationContextTable {
  id: Generated<number>;
  notification_id: number;
  trigger_type: string | null;
  trigger_id: string | null;
  trigger_data: JsonValue;
  context_snapshot: JsonValue;
  created_at: ColumnType<Date, Date | string, Date | string>;
}

export interface ExplorationFindingsTable {
  id: Generated<number>;
  task_id: number;
  user_id: string | null;
  finding: string;
  source_context: string | null;
  confidence: number;
  worth_sharing: boolean;
  share_message: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SurfacedFindingsTable {
  id: Generated<number>;
  finding_id: number;
  session_id: number | null;
  surfaced_at: Timestamp;
}

export interface MediumPresenceTable {
  medium: string;
  user_id: string;
  status: string;
  last_heartbeat: ColumnType<Date, Date | string, Date | string>;
  available_channels: JsonArray;
  created_at: Timestamp;
}

export interface EmotionStatesTable {
  id: Generated<number>;
  session_id: number | null;
  primary_emotion: string | null;
  primary_intensity: number | null;
  secondary_emotion: string | null;
  secondary_intensity: number | null;
  overall_intensity: number | null;
  appraisal_data: JsonValue;
  trigger_data: JsonValue;
  last_update: Timestamp;
  created_at: Timestamp;
}

export interface StimulusHistoryTable {
  id: Generated<number>;
  session_id: number | null;
  stimulus_type: string;
  valence: number;
  intensity: number;
  timestamp: ColumnType<number, number, number>;
  context: JsonValue;
  created_at: Timestamp;
}

export interface CoreMemoryBlocksTable {
  id: Generated<number>;
  user_id: string | null;
  session_id: number | null;
  block_type: string;
  content: string;
  char_limit: number;
  version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CoreMemoryVersionsTable {
  id: Generated<number>;
  block_id: number;
  version: number;
  content: string;
  reason: string | null;
  created_at: Timestamp;
}

export interface ConsolidationRunsTable {
  id: Generated<number>;
  user_id: string | null;
  task_id: number | null;
  status: string;
  started_at: Timestamp;
  finished_at: Timestamp;
  recency_days: number | null;
  community_resolution: number | null;
  update_core_memory: boolean;
  triggered_by: string | null;
  stats: JsonValue;
  error_message: string | null;
}

export interface TaskQueueTable {
  id: Generated<number>;
  task_type: string;
  model_name: string;
  content: string;
  metadata: JsonValue;
  priority: number;
  status: string;
  session_id: number | null;
  created_at: Timestamp;
  processed_at: Timestamp;
  retry_count: number;
  error_message: string | null;
}

export interface SwarmsTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  parent_session_id: number | null;
  working_dir: string;
  git_branch_prefix: string | null;
  base_branch: string | null;
  status: string;
  auto_synthesize: boolean;
  synthesis_prompt: string | null;
  skip_synthesis_on_failure: boolean;
  synthesis_output: string | null;
  synthesis_summary: string | null;
  auto_supervise: boolean;
  supervisor_warn_seconds: number;
  supervisor_cancel_seconds: number;
  created_at: Timestamp;
  started_at: Timestamp;
  completed_at: Timestamp;
}

export interface SwarmAgentsTable {
  id: Generated<number>;
  swarm_id: number;
  name: string;
  role: string;
  is_synthesis_agent: boolean;
  mode: string;
  prompt: string;
  goal: string | null;
  capabilities: StringArray;
  task_types: StringArray;
  max_tasks: number | null;
  max_duration_seconds: number | null;
  idle_timeout_seconds: number;
  tasks_completed: number;
  tasks_failed: number;
  current_task_id: number | null;
  personality: string | null;
  plugins: StringArray;
  git_branch: string | null;
  allowed_tools: StringArray;
  thinking_budget: number | null;
  model: string | null;
  sandbox_mode: boolean;
  depends_on: JsonValue;
  session_id: number | null;
  status: string;
  output_text: string | null;
  output_summary: string | null;
  error_message: string | null;
  tool_count: number;
  created_at: Timestamp;
  started_at: Timestamp;
  completed_at: Timestamp;
}

export interface SwarmScratchpadTable {
  id: Generated<number>;
  swarm_id: number;
  key: string;
  value: JsonValue;
  set_by_agent_id: number | null;
  set_by_agent_name: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ContradictionReviewsTable {
  id: Generated<number>;
  new_fact: string;
  existing_fact_uuid: string;
  existing_fact_text: string;
  similarity: number;
  reason: string;
  source: string | null;
  context: string | null;
  entity_names: JsonValue;
  group_id: string;
  status: string;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Timestamp;
  created_at: Timestamp;
}

export interface Database {
  missions: MissionsTable;
  mission_executions: MissionExecutionsTable;
  sessions: SessionsTable;
  conversations: ConversationsTable;
  conversation_blocks: ConversationBlocksTable;
  entities: EntitiesTable;
  context_cache: ContextCacheTable;
  summary_context: SummaryContextTable;
  project_tasks: ProjectTasksTable;
  ambient_notifications: AmbientNotificationsTable;
  notification_context: NotificationContextTable;
  exploration_findings: ExplorationFindingsTable;
  surfaced_findings: SurfacedFindingsTable;
  medium_presence: MediumPresenceTable;
  emotion_states: EmotionStatesTable;
  stimulus_history: StimulusHistoryTable;
  core_memory_blocks: CoreMemoryBlocksTable;
  core_memory_versions: CoreMemoryVersionsTable;
  consolidation_runs: ConsolidationRunsTable;
  task_queue: TaskQueueTable;
  swarms: SwarmsTable;
  swarm_agents: SwarmAgentsTable;
  swarm_scratchpad: SwarmScratchpadTable;
  contradiction_reviews: ContradictionReviewsTable;
}
