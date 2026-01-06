import { sql, type Kysely } from "kysely";

import type { Database } from "../src/db-types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  // Partial index for active sessions (end_time IS NULL)
  // Used by getActiveSessionCount() which runs on every monitor tick
  await sql`
    CREATE INDEX IF NOT EXISTS sessions_active_user_idx
    ON sessions (user_id)
    WHERE end_time IS NULL
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`DROP INDEX IF EXISTS sessions_active_user_idx`.execute(db);
}
