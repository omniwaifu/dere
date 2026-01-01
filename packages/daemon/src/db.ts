import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import { loadConfig } from "@dere/shared-config";

import type { Database } from "./db-types.js";

let db: Kysely<Database> | null = null;

async function resolveDatabaseUrl(): Promise<string> {
  const envUrl = process.env.DERE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (envUrl) {
    return envUrl;
  }

  const config = await loadConfig();
  const url = config.database?.url;
  if (typeof url === "string" && url.trim()) {
    return url;
  }

  throw new Error("Database URL not configured. Set DERE_DATABASE_URL or config.database.url");
}

export async function getDb(): Promise<Kysely<Database>> {
  if (db) {
    return db;
  }

  const databaseUrl = await resolveDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });
  db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  return db;
}
