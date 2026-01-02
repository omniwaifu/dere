import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileMigrationProvider, Migrator } from "kysely";

import { createDb } from "./db.js";

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
      console.log(`✅ ${result.migrationName}`);
    } else if (result.status === "Error") {
      console.error(`❌ ${result.migrationName}`);
    }
  });

  await db.destroy();

  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

await main();
