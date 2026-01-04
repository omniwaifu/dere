import { sql, type Kysely } from "kysely";

import type { Database } from "../src/db-types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  const statements = [
    sql`CREATE EXTENSION IF NOT EXISTS vector`,

    sql`
      CREATE TABLE IF NOT EXISTS missions (
        id serial PRIMARY KEY,
        name text NOT NULL,
        description text,
        prompt text NOT NULL,
        cron_expression text NOT NULL,
        natural_language_schedule text,
        timezone text NOT NULL DEFAULT 'UTC',
        run_once boolean NOT NULL DEFAULT false,
        personality text,
        allowed_tools text[],
        mcp_servers text[],
        plugins text[],
        thinking_budget integer,
        model text NOT NULL DEFAULT 'claude-sonnet-4-20250514',
        working_dir text NOT NULL DEFAULT '/workspace',
        sandbox_mode boolean NOT NULL DEFAULT true,
        sandbox_mount_type text NOT NULL DEFAULT 'none',
        sandbox_settings jsonb,
        status text NOT NULL DEFAULT 'active',
        next_execution_at timestamptz,
        last_execution_at timestamptz,
        user_id text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS ix_missions_name ON missions (name)`,
    sql`CREATE INDEX IF NOT EXISTS missions_created_idx ON missions (created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS missions_status_next_exec_idx ON missions (status, next_execution_at)`,

    sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id serial PRIMARY KEY,
        name text,
        working_dir text NOT NULL,
        start_time integer NOT NULL,
        end_time integer,
        last_activity timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        continued_from integer REFERENCES sessions(id),
        project_type text,
        claude_session_id text,
        personality text,
        medium text,
        user_id text,
        thinking_budget integer,
        sandbox_mode boolean NOT NULL DEFAULT false,
        sandbox_settings jsonb,
        is_locked boolean NOT NULL DEFAULT false,
        mission_id integer REFERENCES missions(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        summary text,
        summary_updated_at timestamptz
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS sessions_working_dir_idx ON sessions (working_dir)`,
    sql`CREATE INDEX IF NOT EXISTS sessions_start_time_idx ON sessions (start_time DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS mission_executions (
        id serial PRIMARY KEY,
        mission_id integer NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending',
        trigger_type text NOT NULL DEFAULT 'scheduled',
        triggered_by text,
        started_at timestamptz,
        completed_at timestamptz,
        output_text text,
        output_summary text,
        tool_count integer NOT NULL DEFAULT 0,
        error_message text,
        execution_metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS mission_executions_mission_idx ON mission_executions (mission_id)`,
    sql`CREATE INDEX IF NOT EXISTS mission_executions_started_idx ON mission_executions (started_at DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id serial PRIMARY KEY,
        session_id integer NOT NULL REFERENCES sessions(id),
        prompt text NOT NULL,
        message_type text NOT NULL DEFAULT 'user',
        timestamp integer NOT NULL,
        medium text,
        user_id text,
        personality text,
        ttft_ms integer,
        response_ms integer,
        thinking_ms integer,
        tool_uses integer,
        tool_names text[],
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations (session_id)`,
    sql`CREATE INDEX IF NOT EXISTS conversations_timestamp_idx ON conversations (timestamp DESC)`,
    sql`CREATE INDEX IF NOT EXISTS conversations_medium_idx ON conversations (medium) WHERE medium IS NOT NULL`,
    sql`CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations (user_id) WHERE user_id IS NOT NULL`,
    sql`
      CREATE INDEX IF NOT EXISTS conversations_medium_timestamp_idx
      ON conversations (medium, timestamp DESC)
      WHERE medium IS NOT NULL
    `,
    sql`
      CREATE INDEX IF NOT EXISTS conversations_user_medium_ts_idx
      ON conversations (user_id, medium, timestamp DESC)
      WHERE user_id IS NOT NULL AND medium IS NOT NULL
    `,
    sql`CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON conversations (created_at DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS conversation_blocks (
        id serial PRIMARY KEY,
        conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        ordinal integer NOT NULL,
        block_type text NOT NULL,
        text text,
        content_embedding vector(1536),
        tool_use_id text,
        tool_name text,
        tool_input jsonb,
        is_error boolean,
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_blocks_conversation_ordinal_idx
      ON conversation_blocks (conversation_id, ordinal)
    `,
    sql`CREATE INDEX IF NOT EXISTS conversation_blocks_conversation_idx ON conversation_blocks (conversation_id)`,
    sql`CREATE INDEX IF NOT EXISTS conversation_blocks_tool_use_id_idx ON conversation_blocks (tool_use_id)`,
    sql`
      CREATE INDEX IF NOT EXISTS idx_conversation_blocks_text
      ON conversation_blocks
      USING gin (to_tsvector('english'::regconfig, text))
    `,
    sql`
      CREATE INDEX IF NOT EXISTS idx_conversation_blocks_embedding
      ON conversation_blocks
      USING ivfflat (content_embedding vector_cosine_ops)
      WITH (lists = 100)
    `,

    sql`
      CREATE TABLE IF NOT EXISTS entities (
        id serial PRIMARY KEY,
        session_id integer NOT NULL REFERENCES sessions(id),
        conversation_id integer NOT NULL REFERENCES conversations(id),
        entity_type text NOT NULL,
        entity_value text NOT NULL,
        normalized_value text NOT NULL,
        fingerprint text,
        confidence double precision NOT NULL,
        context_start integer,
        context_end integer,
        entity_metadata text,
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS entities_session_idx ON entities (session_id)`,
    sql`CREATE INDEX IF NOT EXISTS entities_type_idx ON entities (entity_type)`,
    sql`CREATE INDEX IF NOT EXISTS entities_normalized_idx ON entities (normalized_value)`,
    sql`
      CREATE INDEX IF NOT EXISTS entities_fingerprint_idx
      ON entities (fingerprint)
      WHERE fingerprint IS NOT NULL
    `,

    sql`
      CREATE TABLE IF NOT EXISTS context_cache (
        session_id integer PRIMARY KEY REFERENCES sessions(id),
        context_text text NOT NULL,
        context_metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS summary_context (
        id serial PRIMARY KEY,
        summary text NOT NULL,
        session_ids bigint[],
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS task_queue (
        id serial PRIMARY KEY,
        task_type text NOT NULL,
        model_name text NOT NULL,
        content text NOT NULL,
        metadata jsonb,
        priority integer NOT NULL DEFAULT 5,
        status text NOT NULL DEFAULT 'pending',
        session_id integer,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at timestamptz,
        retry_count integer NOT NULL DEFAULT 0,
        error_message text
      )
    `,
    sql`
      CREATE INDEX IF NOT EXISTS task_queue_pending_model_idx
      ON task_queue (status, model_name)
      WHERE status = 'pending'
    `,
    sql`
      CREATE INDEX IF NOT EXISTS task_queue_claim_idx
      ON task_queue (status, model_name, priority, created_at)
      WHERE status = 'pending'
    `,
    sql`CREATE INDEX IF NOT EXISTS task_queue_id_status_idx ON task_queue (id, status)`,
    sql`
      CREATE INDEX IF NOT EXISTS task_queue_session_idx
      ON task_queue (session_id)
      WHERE session_id IS NOT NULL
    `,
    sql`CREATE INDEX IF NOT EXISTS task_queue_created_idx ON task_queue (created_at DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS consolidation_runs (
        id serial PRIMARY KEY,
        user_id text,
        task_id integer REFERENCES task_queue(id),
        status text NOT NULL DEFAULT 'running',
        started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at timestamptz,
        recency_days integer,
        community_resolution double precision,
        update_core_memory boolean NOT NULL DEFAULT false,
        triggered_by text,
        stats jsonb,
        error_message text
      )
    `,
    sql`
      CREATE INDEX IF NOT EXISTS consolidation_runs_user_idx
      ON consolidation_runs (user_id)
      WHERE user_id IS NOT NULL
    `,
    sql`CREATE INDEX IF NOT EXISTS consolidation_runs_status_idx ON consolidation_runs (status)`,
    sql`CREATE INDEX IF NOT EXISTS consolidation_runs_started_idx ON consolidation_runs (started_at DESC)`,
    sql`
      CREATE INDEX IF NOT EXISTS consolidation_runs_task_idx
      ON consolidation_runs (task_id)
      WHERE task_id IS NOT NULL
    `,

    sql`
      CREATE TABLE IF NOT EXISTS core_memory_blocks (
        id serial PRIMARY KEY,
        user_id text,
        session_id integer REFERENCES sessions(id),
        block_type text NOT NULL,
        content text NOT NULL,
        char_limit integer NOT NULL DEFAULT 8192,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`
      CREATE INDEX IF NOT EXISTS core_memory_blocks_user_idx
      ON core_memory_blocks (user_id)
      WHERE user_id IS NOT NULL
    `,
    sql`
      CREATE INDEX IF NOT EXISTS core_memory_blocks_session_idx
      ON core_memory_blocks (session_id)
      WHERE session_id IS NOT NULL
    `,
    sql`CREATE INDEX IF NOT EXISTS core_memory_blocks_type_idx ON core_memory_blocks (block_type)`,
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS core_memory_blocks_user_type_unique
      ON core_memory_blocks (user_id, block_type)
      WHERE session_id IS NULL AND user_id IS NOT NULL
    `,
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS core_memory_blocks_session_type_unique
      ON core_memory_blocks (session_id, block_type)
      WHERE session_id IS NOT NULL
    `,

    sql`
      CREATE TABLE IF NOT EXISTS core_memory_versions (
        id serial PRIMARY KEY,
        block_id integer NOT NULL REFERENCES core_memory_blocks(id),
        version integer NOT NULL,
        content text NOT NULL,
        reason text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS core_memory_versions_block_idx ON core_memory_versions (block_id)`,
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS core_memory_versions_block_version_unique
      ON core_memory_versions (block_id, version)
    `,

    sql`
      CREATE TABLE IF NOT EXISTS emotion_states (
        id serial PRIMARY KEY,
        session_id integer REFERENCES sessions(id),
        primary_emotion text,
        primary_intensity double precision,
        secondary_emotion text,
        secondary_intensity double precision,
        overall_intensity double precision,
        appraisal_data jsonb,
        trigger_data jsonb,
        last_update timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS emotion_states_session_idx ON emotion_states (session_id)`,
    sql`CREATE INDEX IF NOT EXISTS emotion_states_last_update_idx ON emotion_states (last_update DESC)`,
    sql`
      CREATE INDEX IF NOT EXISTS emotion_states_session_update_idx
      ON emotion_states (session_id, last_update DESC)
    `,

    sql`
      CREATE TABLE IF NOT EXISTS stimulus_history (
        id serial PRIMARY KEY,
        session_id integer REFERENCES sessions(id),
        stimulus_type text NOT NULL,
        valence double precision NOT NULL,
        intensity double precision NOT NULL,
        timestamp bigint NOT NULL,
        context jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS stimulus_history_session_idx ON stimulus_history (session_id)`,
    sql`CREATE INDEX IF NOT EXISTS stimulus_history_timestamp_idx ON stimulus_history (timestamp DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS ambient_notifications (
        id serial PRIMARY KEY,
        user_id text NOT NULL,
        target_medium text NOT NULL,
        target_location text NOT NULL,
        message text NOT NULL,
        priority text NOT NULL,
        routing_reasoning text,
        status text NOT NULL DEFAULT 'pending',
        error_message text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        delivered_at timestamptz,
        parent_notification_id integer REFERENCES ambient_notifications(id),
        acknowledged boolean NOT NULL DEFAULT false,
        acknowledged_at timestamptz,
        response_time timestamptz
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS notification_context (
        id serial PRIMARY KEY,
        notification_id integer NOT NULL REFERENCES ambient_notifications(id),
        trigger_type text,
        trigger_id text,
        trigger_data jsonb,
        context_snapshot jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`
      CREATE INDEX IF NOT EXISTS notification_context_notification_id_idx
      ON notification_context (notification_id)
    `,

    sql`
      CREATE TABLE IF NOT EXISTS medium_presence (
        medium text NOT NULL,
        user_id text NOT NULL,
        status text NOT NULL DEFAULT 'online',
        last_heartbeat timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        available_channels jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (medium, user_id)
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS swarms (
        id serial PRIMARY KEY,
        name text NOT NULL,
        description text,
        parent_session_id integer REFERENCES sessions(id),
        working_dir text NOT NULL,
        git_branch_prefix text,
        base_branch text,
        status text NOT NULL DEFAULT 'pending',
        auto_synthesize boolean NOT NULL DEFAULT false,
        synthesis_prompt text,
        skip_synthesis_on_failure boolean NOT NULL DEFAULT false,
        synthesis_output text,
        synthesis_summary text,
        auto_supervise boolean NOT NULL DEFAULT false,
        supervisor_warn_seconds integer NOT NULL DEFAULT 600,
        supervisor_cancel_seconds integer NOT NULL DEFAULT 1800,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at timestamptz,
        completed_at timestamptz
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS swarms_name_idx ON swarms (name)`,
    sql`CREATE INDEX IF NOT EXISTS swarms_parent_session_idx ON swarms (parent_session_id)`,
    sql`CREATE INDEX IF NOT EXISTS swarms_status_idx ON swarms (status)`,
    sql`CREATE INDEX IF NOT EXISTS swarms_created_idx ON swarms (created_at DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS swarm_agents (
        id serial PRIMARY KEY,
        swarm_id integer NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
        name text NOT NULL,
        role text NOT NULL DEFAULT 'generic',
        is_synthesis_agent boolean NOT NULL DEFAULT false,
        mode text NOT NULL DEFAULT 'assigned',
        prompt text NOT NULL DEFAULT '',
        goal text,
        capabilities text[],
        task_types text[],
        max_tasks integer,
        max_duration_seconds integer,
        idle_timeout_seconds integer NOT NULL DEFAULT 60,
        tasks_completed integer NOT NULL DEFAULT 0,
        tasks_failed integer NOT NULL DEFAULT 0,
        current_task_id integer,
        personality text,
        plugins text[],
        git_branch text,
        allowed_tools text[],
        thinking_budget integer,
        model text,
        sandbox_mode boolean NOT NULL DEFAULT true,
        depends_on jsonb,
        session_id integer REFERENCES sessions(id),
        status text NOT NULL DEFAULT 'pending',
        output_text text,
        output_summary text,
        error_message text,
        tool_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at timestamptz,
        completed_at timestamptz
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS swarm_agents_swarm_idx ON swarm_agents (swarm_id)`,
    sql`CREATE INDEX IF NOT EXISTS swarm_agents_status_idx ON swarm_agents (status)`,

    sql`
      CREATE TABLE IF NOT EXISTS project_tasks (
        id serial PRIMARY KEY,
        working_dir text NOT NULL,
        title text NOT NULL,
        description text,
        acceptance_criteria text,
        context_summary text,
        scope_paths text[],
        required_tools text[],
        task_type text,
        tags text[],
        estimated_effort text,
        priority integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'backlog',
        claimed_by_session_id integer REFERENCES sessions(id),
        claimed_by_agent_id integer,
        claimed_at timestamptz,
        attempt_count integer NOT NULL DEFAULT 0,
        blocked_by bigint[],
        related_task_ids bigint[],
        created_by_session_id integer REFERENCES sessions(id),
        created_by_agent_id integer,
        discovered_from_task_id integer REFERENCES project_tasks(id),
        discovery_reason text,
        outcome text,
        completion_notes text,
        files_changed text[],
        follow_up_task_ids bigint[],
        last_error text,
        extra jsonb,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at timestamptz,
        completed_at timestamptz
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS project_tasks_working_dir_idx ON project_tasks (working_dir)`,
    sql`CREATE INDEX IF NOT EXISTS project_tasks_status_idx ON project_tasks (status)`,
    sql`CREATE INDEX IF NOT EXISTS project_tasks_task_type_idx ON project_tasks (task_type)`,
    sql`CREATE INDEX IF NOT EXISTS project_tasks_tags_idx ON project_tasks USING gin (tags)`,
    sql`CREATE INDEX IF NOT EXISTS project_tasks_blocked_by_idx ON project_tasks USING gin (blocked_by)`,
    sql`
      CREATE INDEX IF NOT EXISTS project_tasks_ready_idx
      ON project_tasks (working_dir, status, priority DESC)
      WHERE status = 'ready' AND claimed_by_session_id IS NULL AND claimed_by_agent_id IS NULL
    `,
    sql`CREATE INDEX IF NOT EXISTS project_tasks_created_idx ON project_tasks (created_at DESC)`,

    sql`
      CREATE TABLE IF NOT EXISTS swarm_scratchpad (
        id serial PRIMARY KEY,
        swarm_id integer NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
        key text NOT NULL,
        value jsonb,
        set_by_agent_id integer REFERENCES swarm_agents(id) ON DELETE SET NULL,
        set_by_agent_name text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (swarm_id, key)
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS swarm_scratchpad_swarm_idx ON swarm_scratchpad (swarm_id)`,

    sql`
      CREATE TABLE IF NOT EXISTS exploration_findings (
        id serial PRIMARY KEY,
        task_id integer NOT NULL REFERENCES project_tasks(id),
        user_id text,
        finding text NOT NULL,
        source_context text,
        confidence double precision NOT NULL DEFAULT 0,
        worth_sharing boolean NOT NULL DEFAULT false,
        share_message text,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS exploration_findings_task_idx ON exploration_findings (task_id)`,
    sql`
      CREATE INDEX IF NOT EXISTS exploration_findings_user_idx
      ON exploration_findings (user_id)
      WHERE user_id IS NOT NULL
    `,
    sql`CREATE INDEX IF NOT EXISTS exploration_findings_created_idx ON exploration_findings (created_at DESC)`,
    sql`
      CREATE INDEX IF NOT EXISTS exploration_findings_text_idx
      ON exploration_findings
      USING gin (to_tsvector('english', finding))
    `,

    sql`
      CREATE TABLE IF NOT EXISTS surfaced_findings (
        id serial PRIMARY KEY,
        finding_id integer NOT NULL REFERENCES exploration_findings(id),
        session_id integer REFERENCES sessions(id),
        surfaced_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (finding_id, session_id)
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS surfaced_findings_finding_idx ON surfaced_findings (finding_id)`,
    sql`CREATE INDEX IF NOT EXISTS surfaced_findings_session_idx ON surfaced_findings (session_id)`,
    sql`CREATE INDEX IF NOT EXISTS surfaced_findings_surfaced_idx ON surfaced_findings (surfaced_at DESC)`,

    sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_claimed_by_agent_fkey'
        ) THEN
          ALTER TABLE project_tasks
          ADD CONSTRAINT project_tasks_claimed_by_agent_fkey
          FOREIGN KEY (claimed_by_agent_id) REFERENCES swarm_agents(id);
        END IF;
      END $$;
    `,
    sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_created_by_agent_fkey'
        ) THEN
          ALTER TABLE project_tasks
          ADD CONSTRAINT project_tasks_created_by_agent_fkey
          FOREIGN KEY (created_by_agent_id) REFERENCES swarm_agents(id);
        END IF;
      END $$;
    `,
    sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'swarm_agents_current_task_fkey'
        ) THEN
          ALTER TABLE swarm_agents
          ADD CONSTRAINT swarm_agents_current_task_fkey
          FOREIGN KEY (current_task_id) REFERENCES project_tasks(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}

export async function down(db: Kysely<Database>): Promise<void> {
  const statements = [
    sql`DROP TABLE IF EXISTS surfaced_findings CASCADE`,
    sql`DROP TABLE IF EXISTS exploration_findings CASCADE`,
    sql`DROP TABLE IF EXISTS swarm_scratchpad CASCADE`,
    sql`DROP TABLE IF EXISTS project_tasks CASCADE`,
    sql`DROP TABLE IF EXISTS swarm_agents CASCADE`,
    sql`DROP TABLE IF EXISTS swarms CASCADE`,
    sql`DROP TABLE IF EXISTS medium_presence CASCADE`,
    sql`DROP TABLE IF EXISTS notification_context CASCADE`,
    sql`DROP TABLE IF EXISTS ambient_notifications CASCADE`,
    sql`DROP TABLE IF EXISTS stimulus_history CASCADE`,
    sql`DROP TABLE IF EXISTS emotion_states CASCADE`,
    sql`DROP TABLE IF EXISTS core_memory_versions CASCADE`,
    sql`DROP TABLE IF EXISTS core_memory_blocks CASCADE`,
    sql`DROP TABLE IF EXISTS consolidation_runs CASCADE`,
    sql`DROP TABLE IF EXISTS task_queue CASCADE`,
    sql`DROP TABLE IF EXISTS summary_context CASCADE`,
    sql`DROP TABLE IF EXISTS context_cache CASCADE`,
    sql`DROP TABLE IF EXISTS entities CASCADE`,
    sql`DROP TABLE IF EXISTS conversation_blocks CASCADE`,
    sql`DROP TABLE IF EXISTS conversations CASCADE`,
    sql`DROP TABLE IF EXISTS mission_executions CASCADE`,
    sql`DROP TABLE IF EXISTS sessions CASCADE`,
    sql`DROP TABLE IF EXISTS missions CASCADE`,
  ];

  for (const statement of statements) {
    await statement.execute(db);
  }
}
