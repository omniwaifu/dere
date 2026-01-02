import { getDaemonUrl } from "../../../scripts/config_reader.js";

async function searchEntity(entityName: string): Promise<Record<string, unknown> | null> {
  const daemonUrl = await getDaemonUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${daemonUrl}/kg/entity/${entityName}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`Error searching entity: ${response.status} ${response.statusText}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error(`Error searching entity: ${String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const entityName = process.argv[2];
  if (!entityName) {
    console.error("Usage: entity_search.ts <entity_name>");
    process.exit(1);
  }

  const result = await searchEntity(entityName);
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
