import { z } from "zod";

const DateTimeSchema = z.string();
const NullableDateTimeSchema = DateTimeSchema.nullable();
const JsonRecordSchema = z.record(z.string(), z.unknown());

export const MissionStatusSchema = z.enum(["active", "paused", "archived"]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const MissionExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type MissionExecutionStatus = z.infer<typeof MissionExecutionStatusSchema>;

export const MissionTriggerTypeSchema = z.enum(["scheduled", "manual"]);
export type MissionTriggerType = z.infer<typeof MissionTriggerTypeSchema>;

export const CreateMissionRequestSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  schedule: z.string(),
  description: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  allowed_tools: z.array(z.string()).nullable().optional(),
  mcp_servers: z.array(z.string()).nullable().optional(),
  plugins: z.array(z.string()).nullable().optional(),
  thinking_budget: z.number().nullable().optional(),
  model: z.string(),
  working_dir: z.string(),
  sandbox_mode: z.boolean(),
  sandbox_mount_type: z.string(),
  sandbox_settings: JsonRecordSchema.nullable().optional(),
  run_once: z.boolean(),
});
export type CreateMissionRequest = z.infer<typeof CreateMissionRequestSchema>;

export const UpdateMissionRequestSchema = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  schedule: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  allowed_tools: z.array(z.string()).nullable().optional(),
  mcp_servers: z.array(z.string()).nullable().optional(),
  plugins: z.array(z.string()).nullable().optional(),
  thinking_budget: z.number().nullable().optional(),
  model: z.string().nullable().optional(),
  working_dir: z.string().nullable().optional(),
  sandbox_mode: z.boolean().nullable().optional(),
  sandbox_mount_type: z.string().nullable().optional(),
  sandbox_settings: JsonRecordSchema.nullable().optional(),
  run_once: z.boolean().nullable().optional(),
});
export type UpdateMissionRequest = z.infer<typeof UpdateMissionRequestSchema>;

export const MissionResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  prompt: z.string(),
  cron_expression: z.string(),
  natural_language_schedule: z.string().nullable(),
  timezone: z.string(),
  run_once: z.boolean(),
  personality: z.string().nullable(),
  allowed_tools: z.array(z.string()).nullable(),
  mcp_servers: z.array(z.string()).nullable(),
  plugins: z.array(z.string()).nullable(),
  thinking_budget: z.number().nullable(),
  model: z.string(),
  working_dir: z.string(),
  sandbox_mode: z.boolean(),
  sandbox_mount_type: z.string(),
  sandbox_settings: JsonRecordSchema.nullable(),
  status: z.string(),
  next_execution_at: NullableDateTimeSchema,
  last_execution_at: NullableDateTimeSchema,
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
});
export type MissionResponse = z.infer<typeof MissionResponseSchema>;

export const ExecutionResponseSchema = z.object({
  id: z.number(),
  mission_id: z.number(),
  status: z.string(),
  trigger_type: z.string(),
  triggered_by: z.string().nullable(),
  started_at: NullableDateTimeSchema,
  completed_at: NullableDateTimeSchema,
  output_text: z.string().nullable(),
  output_summary: z.string().nullable(),
  tool_count: z.number(),
  error_message: z.string().nullable(),
  created_at: DateTimeSchema,
});
export type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

export const ProjectTaskStatusSchema = z.enum([
  "backlog",
  "ready",
  "claimed",
  "in_progress",
  "done",
  "blocked",
  "cancelled",
]);
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

export const CreateTaskRequestSchema = z.object({
  working_dir: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  acceptance_criteria: z.string().nullable().optional(),
  context_summary: z.string().nullable().optional(),
  scope_paths: z.array(z.string()).nullable().optional(),
  required_tools: z.array(z.string()).nullable().optional(),
  task_type: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  estimated_effort: z.string().nullable().optional(),
  priority: z.number(),
  blocked_by: z.array(z.number()).nullable().optional(),
  related_task_ids: z.array(z.number()).nullable().optional(),
  created_by_session_id: z.number().nullable().optional(),
  created_by_agent_id: z.number().nullable().optional(),
  discovered_from_task_id: z.number().nullable().optional(),
  discovery_reason: z.string().nullable().optional(),
  extra: JsonRecordSchema.nullable().optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  outcome: z.string().nullable().optional(),
  completion_notes: z.string().nullable().optional(),
  files_changed: z.array(z.string()).nullable().optional(),
  last_error: z.string().nullable().optional(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;

export const TaskResponseSchema = z.object({
  id: z.number(),
  working_dir: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  acceptance_criteria: z.string().nullable(),
  context_summary: z.string().nullable(),
  scope_paths: z.array(z.string()).nullable(),
  required_tools: z.array(z.string()).nullable(),
  task_type: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  estimated_effort: z.string().nullable(),
  priority: z.number(),
  status: z.string(),
  claimed_by_session_id: z.number().nullable(),
  claimed_by_agent_id: z.number().nullable(),
  claimed_at: NullableDateTimeSchema,
  attempt_count: z.number(),
  blocked_by: z.array(z.number()).nullable(),
  related_task_ids: z.array(z.number()).nullable(),
  created_by_session_id: z.number().nullable(),
  created_by_agent_id: z.number().nullable(),
  discovered_from_task_id: z.number().nullable(),
  discovery_reason: z.string().nullable(),
  outcome: z.string().nullable(),
  completion_notes: z.string().nullable(),
  files_changed: z.array(z.string()).nullable(),
  follow_up_task_ids: z.array(z.number()).nullable(),
  last_error: z.string().nullable(),
  extra: JsonRecordSchema.nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  started_at: NullableDateTimeSchema,
  completed_at: NullableDateTimeSchema,
});
export type TaskResponse = z.infer<typeof TaskResponseSchema>;
