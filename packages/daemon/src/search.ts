import type { Hono } from "hono";

import {
  graphAvailable,
  toDate,
  OpenAIEmbedder,
  type SearchFilters,
  hybridNodeSearch,
  searchGraph,
} from "@dere/graph";

function parseLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, parsed);
}

function toTimestampSeconds(value: unknown): number {
  const date = toDate(value);
  if (!date) {
    return 0;
  }
  return Math.floor(date.getTime() / 1000);
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function createEmbedding(text: string): Promise<number[]> {
  const embedder = await OpenAIEmbedder.fromConfig();
  return embedder.create(text);
}

export function registerSearchRoutes(app: Hono): void {
  app.post("/search/similar", async (c) => {
    const payload = await parseJson<{
      query?: string;
      limit?: number;
      user_id?: string | null;
    }>(c.req.raw);

    if (!payload?.query) {
      return c.json({ results: [] }, 400);
    }

    const limit = parseLimit(payload.limit, 10);
    const groupId = payload.user_id ?? "default";

    try {
      if (!(await graphAvailable())) {
        return c.json({ results: [] });
      }
      const searchResults = await searchGraph({
        query: payload.query,
        groupId,
        limit,
      });

      const results = searchResults.edges.map((edge) => ({
        id: edge.uuid,
        session_id: null,
        prompt: edge.fact,
        message_type: "knowledge",
        timestamp: toTimestampSeconds(edge.created_at),
        similarity: 0.9,
      }));

      return c.json({ results });
    } catch (error) {
      console.log(`[search] similar failed: ${String(error)}`);
      return c.json({ results: [] });
    }
  });

  app.post("/search/hybrid", async (c) => {
    const payload = await parseJson<{
      query?: string;
      entity_values?: string[];
      limit?: number;
      user_id?: string | null;
      since?: string | null;
      before?: string | null;
      as_of?: string | null;
      only_valid?: boolean;
      rerank_method?: string | null;
      center_entity?: string | null;
      diversity?: number | null;
    }>(c.req.raw);

    if (!payload?.query) {
      return c.json({ results: [], entity_values: payload?.entity_values ?? [] }, 400);
    }

    const groupId = payload.user_id ?? "default";
    const limit = parseLimit(payload.limit, 10);
    const since = payload.since ? new Date(payload.since) : null;
    const before = payload.before ? new Date(payload.before) : null;
    const asOf = payload.as_of ? new Date(payload.as_of) : null;
    const onlyValid = Boolean(payload.only_valid);
    const rerankMethod = payload.rerank_method ?? null;
    const diversity = typeof payload.diversity === "number" ? payload.diversity : 0.5;
    const centerEntity =
      typeof payload.center_entity === "string" ? payload.center_entity.trim() : "";

    const filters: SearchFilters = {};
    if (since && !Number.isNaN(since.getTime())) {
      filters.created_at = { operator: "greater_than_equal", value: since };
    }
    if (before && !Number.isNaN(before.getTime())) {
      filters.created_at = { operator: "less_than_equal", value: before };
    }
    if (onlyValid) {
      filters.invalid_at = { operator: "is_null" };
    }
    if (asOf && !Number.isNaN(asOf.getTime())) {
      filters.valid_at = { operator: "less_than_equal", value: asOf };
      filters.invalid_at = { operator: "greater_than", value: asOf };
    }

    try {
      if (!(await graphAvailable())) {
        return c.json({ results: [], entity_values: payload.entity_values ?? [] });
      }

      let centerNodeUuid: string | null = null;
      if (centerEntity && rerankMethod === "distance") {
        const centerEmbedding = await createEmbedding(centerEntity.replace(/\n/g, " "));
        const centerNodes = await hybridNodeSearch({
          query: centerEntity,
          groupId,
          limit: 1,
          queryVector: centerEmbedding,
        });
        centerNodeUuid = centerNodes[0]?.uuid ?? null;
      }

      const searchResults = await searchGraph({
        query: payload.query,
        groupId,
        limit,
        filters,
        rerankMethod,
        lambdaParam: diversity,
        centerNodeUuid,
      });

      const results = searchResults.edges.map((edge) => ({
        id: edge.uuid,
        session_id: null,
        prompt: edge.fact,
        message_type: "knowledge",
        timestamp: toTimestampSeconds(edge.created_at),
        working_dir: null,
        medium: null,
        entity_score: 0.0,
        semantic_score: 0.9,
        recency_score: 0.5,
        combined_score: 0.8,
      }));

      return c.json({ results, entity_values: payload.entity_values ?? [] });
    } catch (error) {
      console.log(`[search] hybrid failed: ${String(error)}`);
      return c.json({ results: [], entity_values: payload?.entity_values ?? [] });
    }
  });

  app.post("/embeddings/generate", async (c) => {
    const url = new URL(c.req.url);
    const queryText = url.searchParams.get("text");
    const payload = await parseJson<{ text?: string }>(c.req.raw);
    const text =
      typeof queryText === "string" && queryText.trim()
        ? queryText.trim()
        : typeof payload?.text === "string"
          ? payload.text.trim()
          : "";
    if (!text) {
      return c.json({ error: "text is required" }, 400);
    }

    try {
      const embedding = await createEmbedding(text);
      return c.json({ embedding, model: "text-embedding-3-small" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 503);
    }
  });
}
