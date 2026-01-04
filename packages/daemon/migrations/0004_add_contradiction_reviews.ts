import { sql, type Kysely } from "kysely";

import type { Database } from "../src/db-types.js";

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS contradiction_reviews (
      id SERIAL PRIMARY KEY,
      new_fact TEXT NOT NULL,
      existing_fact_uuid TEXT NOT NULL,
      existing_fact_text TEXT NOT NULL,
      similarity REAL NOT NULL,
      reason TEXT NOT NULL,
      source TEXT,
      context TEXT,
      entity_names JSONB NOT NULL DEFAULT '[]',
      group_id TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT,
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS idx_contradiction_reviews_status ON contradiction_reviews(status)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_contradiction_reviews_group_id ON contradiction_reviews(group_id)`.execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`DROP TABLE IF EXISTS contradiction_reviews`.execute(db);
}
