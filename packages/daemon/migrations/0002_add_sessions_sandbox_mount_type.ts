import { sql, type Kysely } from "kysely";

import type { Database } from "../src/db-types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await db.executeQuery(
    sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sandbox_mount_type text NOT NULL DEFAULT 'copy'`,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await db.executeQuery(
    sql`ALTER TABLE sessions DROP COLUMN IF EXISTS sandbox_mount_type`,
  );
}
