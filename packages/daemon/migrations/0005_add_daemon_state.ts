import { sql, type Kysely } from "kysely";

import type { Database } from "../src/db-types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS daemon_state (
      user_id TEXT PRIMARY KEY,
      suppressed_until TIMESTAMPTZ,
      last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      autonomous_work_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`DROP TABLE IF EXISTS daemon_state`.execute(db);
}
