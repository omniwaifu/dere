import { describe, expect, test } from "bun:test";

import { createApp } from "./app.js";

describe("daemon integration", () => {
  test("/health returns ok", async () => {
    const { app } = createApp();
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.status).toBe("healthy");
  });

  test("/agent/models returns configured models", async () => {
    const { app } = createApp();
    const response = await app.request("/agent/models");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { models?: unknown[] };
    expect(Array.isArray(payload.models)).toBe(true);
    expect(payload.models?.length).toBeGreaterThan(0);
  });
});

const graphBaseUrl = process.env.DERE_GRAPH_TEST_URL;
const graphTest = graphBaseUrl ? test : test.skip;

graphTest("graph /kg/stats responds with summary fields", async () => {
  const url = new URL("/kg/stats", graphBaseUrl);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload).toEqual(
    expect.objectContaining({
      total_entities: expect.any(Number),
      total_facts: expect.any(Number),
      total_edges: expect.any(Number),
      total_communities: expect.any(Number),
      label_distribution: expect.any(Object),
    }),
  );
});
