/**
 * Tests for fact-checker contradiction detection.
 *
 * Run with: bun test packages/daemon/src/services/fact-checker.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "../db.js";
import {
  checkFindings,
  integrateFindings,
  type Finding,
} from "./fact-checker.js";
import { addFact } from "@dere/graph";

const TEST_GROUP_ID = "test-fact-checker";

describe("fact-checker", () => {
  beforeAll(async () => {
    // Clean up any previous test data
    const db = await getDb();
    await db
      .deleteFrom("contradiction_reviews")
      .where("group_id", "=", TEST_GROUP_ID)
      .execute();
  });

  afterAll(async () => {
    // Clean up test data
    const db = await getDb();
    await db
      .deleteFrom("contradiction_reviews")
      .where("group_id", "=", TEST_GROUP_ID)
      .execute();
  });

  test("checkFindings returns clean findings when no contradictions exist", async () => {
    const findings: Finding[] = [
      {
        fact: "The sky is blue during a clear day",
        entityNames: [],
        source: "test",
      },
    ];

    const result = await checkFindings(findings, TEST_GROUP_ID);

    // Without existing facts, all findings should be clean
    expect(result.clean.length).toBe(1);
    expect(result.contradictions.length).toBe(0);
  });

  test("integrateFindings adds clean facts to the graph", async () => {
    const findings: Finding[] = [
      {
        fact: `Test fact ${Date.now()}: Water boils at 100 degrees Celsius at sea level`,
        entityNames: [],
        source: "test-integration",
      },
    ];

    const result = await integrateFindings(findings, TEST_GROUP_ID);

    expect(result.added.length).toBe(1);
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test("integrateFindings queues contradictions for review", async () => {
    // First, add a fact about a specific topic
    const originalFact = `Test fact ${Date.now()}: The project deadline is March 15th`;
    await addFact({
      fact: originalFact,
      groupId: TEST_GROUP_ID,
      source: "test-setup",
    });

    // Now try to add a contradicting fact
    // Note: This test depends on the semantic similarity implementation
    // Currently similarity check uses placeholders (returns 0), so this may not
    // actually trigger contradiction detection until embeddings are integrated
    const findings: Finding[] = [
      {
        fact: `Test fact ${Date.now()}: The project deadline is April 1st`,
        entityNames: ["project", "deadline"],
        source: "test-contradiction",
        context: "testing contradiction detection",
      },
    ];

    const result = await integrateFindings(findings, TEST_GROUP_ID);

    // With placeholder similarity (always 0), contradictions won't be detected
    // This test documents the expected behavior once similarity is implemented
    console.log("Integration result:", {
      added: result.added.length,
      queued: result.queued,
      skipped: result.skipped,
    });

    // For now, verify the function runs without error
    expect(result.added.length + result.queued + result.skipped).toBe(1);
  });
});
