/**
 * Fact Checker - validates new findings against existing knowledge graph.
 *
 * Core responsibilities:
 * 1. Find related entities before adding new facts
 * 2. Detect potential contradictions via semantic similarity
 * 3. Route contradictions to review queue, auto-add clean facts
 */

import { getLogger } from "../logger.js";
import {
  nodeBfsSearch,
  getFactsByEntities,
  hybridFactSearch,
  hybridNodeSearch,
  addFact,
  type EntityNode,
  type FactNode,
} from "@dere/graph";
import { getDb } from "../db.js";
import { daemonEvents } from "../events.js";

const log = getLogger("fact-checker");

// ============================================================================
// Types
// ============================================================================

export type Finding = {
  fact: string;
  entityNames: string[];
  source: string;
  context?: string;
};

export type ContradictionCandidate = {
  newFact: string;
  existingFact: FactNode;
  similarity: number;
  reason: string;
};

export type CheckResult = {
  clean: Finding[];
  contradictions: ContradictionCandidate[];
  relatedEntities: EntityNode[];
};

// ============================================================================
// Configuration
// ============================================================================

// Facts with similarity in this range are flagged as potential contradictions
// Too similar (>0.95) = probably duplicate, too different (<0.7) = unrelated
const CONTRADICTION_SIMILARITY_MIN = 0.7;
const CONTRADICTION_SIMILARITY_MAX = 0.95;

// How many hops from mentioned entities to search
const RELATED_ENTITY_DEPTH = 2;

// Max related entities to return
const RELATED_ENTITY_LIMIT = 50;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Find entities within N hops of the given entity UUIDs.
 * Used to understand the neighborhood before adding new facts.
 */
export async function findRelatedEntities(
  entityUuids: string[],
  groupId: string,
  maxDepth = RELATED_ENTITY_DEPTH,
  limit = RELATED_ENTITY_LIMIT,
): Promise<EntityNode[]> {
  if (entityUuids.length === 0) {
    return [];
  }

  log.debug("finding related entities", {
    origins: entityUuids.length,
    maxDepth,
    limit,
  });

  const related = await nodeBfsSearch(entityUuids, groupId, maxDepth, limit);

  log.debug("found related entities", { count: related.length });
  return related;
}

/**
 * Find existing facts that might contradict a new fact.
 *
 * Uses semantic similarity to find facts in the "danger zone":
 * - Similar enough to be about the same topic (>0.7)
 * - Different enough to potentially conflict (<0.95)
 *
 * Facts about the same entities with similarity in this range
 * warrant human review before being added.
 */
export async function findPotentialContradictions(
  fact: string,
  entityUuids: string[],
  groupId: string,
): Promise<ContradictionCandidate[]> {
  const candidates: ContradictionCandidate[] = [];

  // Strategy 1: Check facts directly connected to mentioned entities
  if (entityUuids.length > 0) {
    const entityFacts = await getFactsByEntities(entityUuids, groupId, 20);

    for (const existingFact of entityFacts) {
      // TODO: compute actual embedding similarity
      // For now, this is a placeholder - need to integrate embedding comparison
      const similarity = 0; // placeholder

      if (
        similarity >= CONTRADICTION_SIMILARITY_MIN &&
        similarity <= CONTRADICTION_SIMILARITY_MAX
      ) {
        candidates.push({
          newFact: fact,
          existingFact,
          similarity,
          reason: "similar fact about same entities",
        });
      }
    }
  }

  // Strategy 2: Semantic search across all facts
  const searchResults = await hybridFactSearch({
    query: fact,
    groupId,
    limit: 10,
  });

  for (const result of searchResults) {
    // Skip if we already found this via entity lookup
    if (candidates.some((c) => c.existingFact.uuid === result.uuid)) {
      continue;
    }

    // hybridFactSearch returns scored results, use that as similarity proxy
    // TODO: get actual embedding similarity from search results
    const similarity = 0; // placeholder

    if (
      similarity >= CONTRADICTION_SIMILARITY_MIN &&
      similarity <= CONTRADICTION_SIMILARITY_MAX
    ) {
      candidates.push({
        newFact: fact,
        existingFact: result,
        similarity,
        reason: "semantically similar fact in graph",
      });
    }
  }

  if (candidates.length > 0) {
    log.info("found potential contradictions", {
      fact: fact.slice(0, 100),
      count: candidates.length,
    });
  }

  return candidates;
}

/**
 * Check a batch of findings against existing knowledge.
 *
 * Returns findings split into:
 * - clean: safe to add automatically
 * - contradictions: need human review
 * - relatedEntities: context about the knowledge neighborhood
 */
export async function checkFindings(
  findings: Finding[],
  groupId: string,
): Promise<CheckResult> {
  const clean: Finding[] = [];
  const contradictions: ContradictionCandidate[] = [];
  let allRelatedEntities: EntityNode[] = [];

  // Collect all entity UUIDs mentioned across findings
  // TODO: resolve entity names to UUIDs via entity lookup
  const allEntityUuids: string[] = [];

  // Find the neighborhood once for all findings
  if (allEntityUuids.length > 0) {
    allRelatedEntities = await findRelatedEntities(allEntityUuids, groupId);
  }

  // Check each finding for contradictions
  for (const finding of findings) {
    // TODO: resolve finding.entityNames to UUIDs
    const entityUuids: string[] = [];

    const potentialContradictions = await findPotentialContradictions(
      finding.fact,
      entityUuids,
      groupId,
    );

    if (potentialContradictions.length > 0) {
      contradictions.push(...potentialContradictions);
    } else {
      clean.push(finding);
    }
  }

  log.info("findings check complete", {
    total: findings.length,
    clean: clean.length,
    contradictions: contradictions.length,
    relatedEntities: allRelatedEntities.length,
  });

  return { clean, contradictions, relatedEntities: allRelatedEntities };
}

// ============================================================================
// Entity Resolution
// ============================================================================

/**
 * Resolve entity names to UUIDs via hybrid search.
 * Returns a map of name -> UUID for found entities.
 */
async function resolveEntityNames(
  names: string[],
  groupId: string,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (names.length === 0) {
    return resolved;
  }

  // Search for each entity name
  for (const name of names) {
    const results = await hybridNodeSearch({
      query: name,
      groupId,
      limit: 1,
    });

    if (results.length > 0) {
      // Use exact match or closest match
      const match =
        results.find((r) => r.name.toLowerCase() === name.toLowerCase()) ??
        results[0];
      if (match) {
        resolved.set(name, match.uuid);
      }
    }
  }

  log.debug("resolved entity names", {
    requested: names.length,
    found: resolved.size,
  });

  return resolved;
}

// ============================================================================
// Integration Orchestration
// ============================================================================

export type IntegrationResult = {
  added: FactNode[];
  queued: number;
  skipped: number;
};

/**
 * Integrate findings into the knowledge graph.
 *
 * Orchestrates the full flow:
 * 1. Resolve entity names to UUIDs
 * 2. Check for contradictions
 * 3. Queue contradictions for review
 * 4. Auto-add clean facts
 */
export async function integrateFindings(
  findings: Finding[],
  groupId: string,
): Promise<IntegrationResult> {
  if (findings.length === 0) {
    return { added: [], queued: 0, skipped: 0 };
  }

  log.info("integrating findings", { count: findings.length, groupId });

  // Collect all unique entity names
  const allNames = new Set<string>();
  for (const finding of findings) {
    for (const name of finding.entityNames) {
      allNames.add(name);
    }
  }

  // Resolve names to UUIDs
  const nameToUuid = await resolveEntityNames([...allNames], groupId);

  // Track results
  const added: FactNode[] = [];
  let queued = 0;
  let skipped = 0;

  for (const finding of findings) {
    // Get UUIDs for this finding's entities
    const entityUuids = finding.entityNames
      .map((name) => nameToUuid.get(name))
      .filter((uuid): uuid is string => Boolean(uuid));

    // Check for contradictions
    const contradictions = await findPotentialContradictions(
      finding.fact,
      entityUuids,
      groupId,
    );

    if (contradictions.length > 0) {
      // Queue for review
      await queueContradictionReview({
        newFact: finding.fact,
        source: finding.source,
        context: finding.context,
        entityNames: finding.entityNames,
        contradictions,
        groupId,
      });
      queued++;
    } else {
      // Clean fact - add directly
      try {
        const result = await addFact({
          fact: finding.fact,
          groupId,
          source: finding.source,
          attributes: {
            discovered_by: "fact-checker",
            discovery_context: finding.context,
            related_entities: finding.entityNames,
          },
        });
        added.push(result.fact);
      } catch (err) {
        log.warn("failed to add fact", {
          fact: finding.fact.slice(0, 100),
          error: String(err),
        });
        skipped++;
      }
    }
  }

  log.info("integration complete", {
    added: added.length,
    queued,
    skipped,
  });

  return { added, queued, skipped };
}

// ============================================================================
// Contradiction Review Queue
// ============================================================================

type ContradictionReviewInput = {
  newFact: string;
  source: string | undefined;
  context: string | undefined;
  entityNames: string[];
  contradictions: ContradictionCandidate[];
  groupId: string;
};

/**
 * Queue a contradiction for human review.
 */
async function queueContradictionReview(
  input: ContradictionReviewInput,
): Promise<void> {
  const { newFact, source, context, entityNames, contradictions, groupId } = input;
  const db = await getDb();

  // Store each contradiction pair
  for (const contradiction of contradictions) {
    await db
      .insertInto("contradiction_reviews")
      .values({
        new_fact: newFact,
        existing_fact_uuid: contradiction.existingFact.uuid,
        existing_fact_text: contradiction.existingFact.fact,
        similarity: contradiction.similarity,
        reason: contradiction.reason,
        source: source ?? null,
        context: context ?? null,
        entity_names: JSON.stringify(entityNames),
        group_id: groupId,
        status: "pending",
        created_at: new Date(),
      })
      .execute();
  }

  // Emit events for each contradiction detected
  for (const contradiction of contradictions) {
    daemonEvents.emit("integration:contradiction_detected", {
      newFact,
      existingFactUuid: contradiction.existingFact.uuid,
      existingFactText: contradiction.existingFact.fact,
      similarity: contradiction.similarity,
      groupId,
    });
  }

  log.info("queued contradiction for review", {
    fact: newFact.slice(0, 100),
    conflicts: contradictions.length,
  });
}
