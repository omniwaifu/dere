export type ContextMetadata = {
  entities: Array<{ uuid: string; name: string }>;
  edges: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildContextMetadata(
  nodes: Array<{ uuid: string; name: string }>,
  edges: Array<{ uuid: string }>,
): ContextMetadata {
  return {
    entities: nodes.map((node) => ({ uuid: node.uuid, name: node.name })),
    edges: edges.map((edge) => edge.uuid),
  };
}

export function extractCitedEntityUuids(
  responseText: string,
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  if (!responseText || !metadata) {
    return [];
  }

  const entities = metadata.entities;
  if (!Array.isArray(entities) || entities.length === 0) {
    return [];
  }

  const responseLower = responseText.toLowerCase();
  const cited: string[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    if (!entity || typeof entity !== "object") {
      continue;
    }
    const record = entity as Record<string, unknown>;
    const uuid = typeof record.uuid === "string" ? record.uuid : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (!uuid || !name) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegExp(name.toLowerCase())}\\b`, "i");
    if (pattern.test(responseLower) && !seen.has(uuid)) {
      cited.push(uuid);
      seen.add(uuid);
    }
  }

  return cited;
}
