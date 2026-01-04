import { sql, type Kysely } from "kysely";

import type { Database } from "../src/db-types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`ALTER TABLE context_cache ADD COLUMN IF NOT EXISTS context_metadata jsonb`.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`ALTER TABLE context_cache DROP COLUMN IF EXISTS context_metadata`.execute(db);
}
