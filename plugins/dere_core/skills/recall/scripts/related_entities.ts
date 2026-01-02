import { getDaemonUrl } from "../../../scripts/config_reader.js";

async function getRelatedEntities(
  entityName: string,
  limit = 10,
): Promise<Record<string, unknown> | null> {
  const daemonUrl = await getDaemonUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const url = new URL(`${daemonUrl}/kg/entity/${entityName}/related`);
    url.searchParams.set("limit", String(limit));
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`Error getting related entities: ${response.status} ${response.statusText}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error(`Error getting related entities: ${String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const entityName = process.argv[2];
  if (!entityName) {
    console.error("Usage: related_entities.ts <entity_name> [limit]");
    process.exit(1);
  }

  const limitArg = process.argv[3];
  const limit = limitArg ? Number.parseInt(limitArg, 10) : 10;

  const result = await getRelatedEntities(entityName, Number.isFinite(limit) ? limit : 10);
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
