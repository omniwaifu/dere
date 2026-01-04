import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileMigrationProvider, Migrator } from "kysely";

import { createDb } from "./db.js";
import { log } from "./logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

async function main(): Promise<void> {
  const { db } = await createDb();

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsDir,
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((result) => {
    if (result.status === "Success") {
      log.daemon.info("Migration applied", { name: result.migrationName });
    } else if (result.status === "Error") {
      log.daemon.error("Migration failed", { name: result.migrationName });
    }
  });

  await db.destroy();

  if (error) {
    log.daemon.error("Migration error", { error: String(error) });
    process.exitCode = 1;
  }
}

await main();
