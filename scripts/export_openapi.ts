import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

async function writeJson(path: string, payload: JsonRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function main(): Promise<void> {
  const schemaPath = join(repoRoot, "schemas", "openapi", "dere_daemon.openapi.json");
  const raw = await readFile(schemaPath, "utf-8");
  const schema = JSON.parse(raw) as JsonRecord;
  await writeJson(schemaPath, schema);
  console.log(`Normalized OpenAPI schema: ${schemaPath.slice(repoRoot.length + 1)}`);
}

await main();
