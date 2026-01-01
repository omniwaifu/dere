import { loadConfig } from "@dere/shared-config";
import {
  ExtractedEdgesSchema,
  ExtractedEntitiesSchema,
  ExtractedFactsSchema,
  EdgeDateUpdatesSchema,
  EdgeDuplicateSchema,
  EntityAttributeUpdatesSchema,
  EntitySummariesSchema,
  EntityValidationSchema,
  FactDuplicateSchema,
  NodeResolutionsSchema,
  buildDedupeEdgesPrompt,
  buildDedupeEntitiesPrompt,
  buildDedupeFactsPrompt,
  buildExtractEdgeDatesPrompt,
  buildExtractEdgesPrompt,
  buildExtractEntitiesPrompt,
  buildExtractFactsPrompt,
  buildHydrateAttributesPrompt,
  buildSummarizeEntitiesPrompt,
  buildValidateEntitiesPrompt,
} from "./graph-prompts.js";
import {
  createEntityEdge,
  createEntityNode,
  createEpisodicEdge,
  createEpisodicNode,
  createFactNode,
  createFactRoleEdge,
  nowUtc,
  type EntityEdge,
  type EntityNode,
  type EpisodeType,
  type EpisodicNode,
  type FactNode,
  type FactRoleDetail,
  type FactRoleEdge,
} from "./graph-types.js";
import {
  findRecentConversationId,
  getEdgeUuidsForEpisode,
  getEntityByUuid,
  getEpisodesByConversationId,
  getEpisodesForEntities,
  getExistingEdges,
  getFactByText,
  getFactRoles,
  getFactUuidsForEpisode,
  getFactsByEntities,
  getRecentEpisodes,
  invalidateEdge,
  saveEntityEdge,
  saveEntityNode,
  saveEpisodicEdge,
  saveEpisodicNode,
  saveFactNode,
  saveFactRoleEdge,
} from "./graph-store.js";
import { searchSimilarNodes } from "./graph-search.js";
import { OpenAIEmbedder } from "./graph-embedder.js";
import { getGraphStructuredClient } from "./graph-llm.js";
import { graphAvailable } from "./graph-helpers.js";

const MAX_EXTRACTION_CHARS = 20000;
const MAX_CONTEXT_CHARS = 8000;
const LOG_LINE_THRESHOLD = 0.4;
const MIN_EXTRACTION_CHARS = 50;
const MIN_UNIQUE_WORDS = 5;

const SYSTEM_REMINDER_CLOSE_RE = /<\/system[-_]reminder\s*>/gi;
const SYSTEM_REMINDER_BLOCK_RE = /<system[-_]reminder\b[^>]*>[\s\S]*?<\/system[-_]reminder\s*>/gi;
const USER_BLOCK_RE = /<(user|human)(?:-message)?\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const USER_OPEN_RE = /<(user|human)(?:-message)?\b[^>]*>/gi;
const ROLE_LINE_RE = /^\s*(user|human|assistant|system)\s*:\s*/i;

function truncateForContext(content: string, maxChars = MAX_CONTEXT_CHARS): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `...${content.slice(content.length - maxChars)}`;
}

function extractLastUserBlock(content: string): string {
  let lastMatch: RegExpExecArray | null = null;
  for (const match of content.matchAll(USER_BLOCK_RE)) {
    lastMatch = match;
  }
  if (lastMatch) {
    const block = lastMatch[2]?.trim();
    if (block) {
      return block;
    }
  }

  let lastOpen: RegExpExecArray | null = null;
  for (const match of content.matchAll(USER_OPEN_RE)) {
    lastOpen = match;
  }
  if (lastOpen) {
    const start = lastOpen.index + lastOpen[0].length;
    const tail = content.slice(start).trim();
    if (!tail) {
      return "";
    }
    const assistantIdx = tail.search(/<(assistant|ai)(?:-message)?\b/i);
    if (assistantIdx >= 0) {
      return tail.slice(0, assistantIdx).trim();
    }
    return tail;
  }

  return "";
}

function extractLastUserLines(content: string): string {
  const lines = content.split(/\r?\n/);
  let lastUserIdx: number | null = null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const match = ROLE_LINE_RE.exec(lines[idx] ?? "");
    ROLE_LINE_RE.lastIndex = 0;
    if (match && match[1] && ["user", "human"].includes(match[1].toLowerCase())) {
      lastUserIdx = idx;
    }
  }
  if (lastUserIdx === null) {
    return "";
  }

  const match = ROLE_LINE_RE.exec(lines[lastUserIdx] ?? "");
  ROLE_LINE_RE.lastIndex = 0;
  const parts = [
    match ? (lines[lastUserIdx] ?? "").slice(match[0].length) : (lines[lastUserIdx] ?? ""),
  ];
  for (let idx = lastUserIdx + 1; idx < lines.length; idx += 1) {
    if (ROLE_LINE_RE.test(lines[idx] ?? "")) {
      ROLE_LINE_RE.lastIndex = 0;
      break;
    }
    parts.push(lines[idx] ?? "");
  }
  return parts.join("\n").trim();
}

function extractUserMessage(content: string): string {
  if (!content) {
    return content;
  }

  let lastClose: RegExpExecArray | null = null;
  for (const match of content.matchAll(SYSTEM_REMINDER_CLOSE_RE)) {
    lastClose = match;
  }
  if (lastClose) {
    const tail = content.slice(lastClose.index + lastClose[0].length).trim();
    if (tail) {
      return tail;
    }
  }

  const stripped = content.replace(SYSTEM_REMINDER_BLOCK_RE, "").trim();
  if (stripped && stripped !== content) {
    const userBlock = extractLastUserBlock(stripped);
    if (userBlock) {
      return userBlock;
    }
    const userLines = extractLastUserLines(stripped);
    if (userLines) {
      return userLines;
    }
    return stripped;
  }

  const userBlock = extractLastUserBlock(content);
  if (userBlock) {
    return userBlock;
  }
  const userLines = extractLastUserLines(content);
  if (userLines) {
    return userLines;
  }

  return content;
}

function isLogOrDataDump(content: string): boolean {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 5) {
    return false;
  }

  const logPatterns = [
    /^\d{2}:\d{2}:\d{2}/,
    /^\d{4}-\d{2}-\d{2}/,
    /^\s*(INFO|DEBUG|ERROR|WARN|WARNING)\s*\|/i,
    /^\s*\w+\.\d+\s*\|/,
    /^Traceback \(most recent/,
    /^\s*File "/,
    /^\s*│/,
  ];

  let logLineCount = 0;
  for (const line of lines.slice(0, 100)) {
    if (logPatterns.some((pattern) => pattern.test(line))) {
      logLineCount += 1;
    }
  }

  const ratio = logLineCount / Math.min(lines.length, 100);
  return ratio >= LOG_LINE_THRESHOLD;
}

function shouldSkipExtraction(content: string): [boolean, string] {
  if (content.length < MIN_EXTRACTION_CHARS) {
    return [true, `too short (${content.length} chars)`];
  }

  const words = content.toLowerCase().split(/\s+/).filter(Boolean);
  const unique = new Set(words);
  if (unique.size < MIN_UNIQUE_WORDS) {
    return [true, `too few unique words (${unique.size})`];
  }

  if (content.length > MAX_EXTRACTION_CHARS) {
    return [true, `too long (${content.length} chars)`];
  }

  if (isLogOrDataDump(content)) {
    return [true, "detected as log/data dump"];
  }

  return [false, ""];
}

function parseEdgeDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value.replace("Z", "+00:00"));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function ensureSpeakerFirst(nodes: EntityNode[], episode: EpisodicNode): EntityNode[] {
  const speakerName = (episode.speaker_name ?? "").trim();
  if (!speakerName) {
    return nodes;
  }

  const speakerId = (episode.speaker_id ?? "").trim();
  const idx = nodes.findIndex(
    (node) => node.name.trim().toLowerCase() === speakerName.toLowerCase(),
  );
  let speakerNode: EntityNode;
  if (idx >= 0) {
    speakerNode = nodes.splice(idx, 1)[0];
  } else {
    speakerNode = createEntityNode({
      name: speakerName,
      group_id: episode.group_id,
      labels: ["User"],
      summary: "",
      attributes: {},
      aliases: [],
    });
  }

  speakerNode.attributes = speakerNode.attributes ?? {};
  speakerNode.attributes.is_speaker = true;
  if (speakerId) {
    speakerNode.attributes.user_id = speakerId;
  }
  if (!speakerNode.labels || speakerNode.labels.length === 0) {
    speakerNode.labels = ["User"];
  }

  return [speakerNode, ...nodes];
}

function normalizeLabels(label: string | null | undefined): string[] {
  if (!label) {
    return [];
  }
  const trimmed = label.trim();
  return trimmed ? [trimmed] : [];
}

function buildEntityTypeSchemas(
  entityTypes: Record<string, Record<string, string>> | null | undefined,
): Record<string, Record<string, string>> | null {
  if (!entityTypes) {
    return null;
  }
  return entityTypes;
}

async function extractNodes(options: {
  episode: EpisodicNode;
  previousEpisodes: EpisodicNode[];
  enableReflection: boolean;
  extractionContent: string;
  entityTypes?: string[] | null;
  excludedEntityTypes?: string[] | null;
}): Promise<EntityNode[]> {
  const rawContent = options.extractionContent;
  const userMessage = extractUserMessage(rawContent);

  const [skip, reason] = shouldSkipExtraction(userMessage);
  if (skip) {
    console.log(`[graph] skipping entity extraction: ${reason}`);
    return [];
  }

  const prevEpisodeStrings = options.previousEpisodes
    .map((ep) => truncateForContext(extractUserMessage(ep.content)))
    .slice(-4);

  let customPrompt = "";
  let episodeContent = userMessage;
  if (options.episode.source === "json") {
    try {
      const parsed = JSON.parse(userMessage);
      episodeContent = JSON.stringify(parsed, null, 2);
    } catch {
      episodeContent = userMessage;
    }

    customPrompt = `
This episode source is JSON from: ${options.episode.source_description}

Treat CURRENT_MESSAGE as a JSON payload, not a conversation.
- Extract entities representing meaningful objects, identifiers, resources, people, orgs, repos, files, tasks, and durable concepts.
- Do NOT create entities for trivial keys, single primitive values, timestamps, or purely structural JSON fields.
`;
  } else if (options.episode.source === "code") {
    customPrompt = `
This episode source is CODE from: ${options.episode.source_description}

Treat CURRENT_MESSAGE as source code, not a conversation.
- Extract entities like repositories/projects, file/module names, symbols (classes/functions), libraries/frameworks, error types/messages, and key domain concepts.
- Avoid extracting every variable or local identifier unless it is clearly important/durable (e.g., public API, config keys).
`;
  } else if (options.episode.source === "doc") {
    customPrompt = `
This episode source is DOCUMENTATION from: ${options.episode.source_description}

Treat CURRENT_MESSAGE as documentation/notes.
- Extract entities like products, libraries, commands, APIs, configuration keys, concepts, and durable decisions.
- Avoid extracting generic words that don't add retrieval value.
`;
  }

  const prompt = buildExtractEntitiesPrompt({
    episodeContent,
    previousEpisodes: prevEpisodeStrings,
    customPrompt,
    speakerId: options.episode.speaker_id,
    speakerName: options.episode.speaker_name,
    personality: options.episode.personality,
    entityTypes: options.entityTypes ?? null,
    excludedEntityTypes: options.excludedEntityTypes ?? null,
  });

  const llm = await getGraphStructuredClient();
  const response = await llm.generate(prompt, ExtractedEntitiesSchema, {
    schemaName: "extracted_entities",
  });

  let extracted = response.extracted_entities.map((entity) =>
    createEntityNode({
      name: entity.name.trim(),
      group_id: options.episode.group_id,
      labels: normalizeLabels(entity.entity_type ?? null),
      summary: "",
      attributes: entity.attributes ?? {},
      aliases: entity.aliases ?? [],
    }),
  );

  if (options.enableReflection) {
    try {
      const validationPrompt = buildValidateEntitiesPrompt({
        extractedEntities: extracted.map((node) => ({
          name: node.name,
          summary: node.summary,
        })),
        episodeContent: userMessage,
        previousEpisodes: prevEpisodeStrings,
      });
      const validation = await llm.generate(validationPrompt, EntityValidationSchema, {
        schemaName: "entity_validation",
      });

      if (validation.hallucinated_entities.length > 0) {
        extracted = extracted.filter(
          (node) => !validation.hallucinated_entities.includes(node.name),
        );
      }

      if (validation.missed_entities.length > 0) {
        for (const missed of validation.missed_entities) {
          extracted.push(
            createEntityNode({
              name: missed.name,
              group_id: options.episode.group_id,
              labels: [],
              summary: missed.summary,
              attributes: {},
              aliases: [],
            }),
          );
        }
      }

      if (validation.refinements.length > 0) {
        for (const refinement of validation.refinements) {
          const node = extracted.find((item) => item.name === refinement.original_name);
          if (!node) {
            continue;
          }
          if (refinement.refined_name) {
            node.name = refinement.refined_name;
          }
          if (refinement.refined_summary) {
            node.summary = refinement.refined_summary;
          }
        }
      }
    } catch (error) {
      console.log(`[graph] reflection failed: ${String(error)}`);
    }
  }

  extracted = ensureSpeakerFirst(extracted, options.episode);

  try {
    const entitiesPayload = extracted.map((node, idx) => ({
      id: idx,
      name: node.name,
      labels: node.labels,
      attributes: node.attributes,
      aliases: node.aliases,
      summary: node.summary,
    }));
    const summaryPrompt = buildSummarizeEntitiesPrompt({
      previousEpisodes: prevEpisodeStrings,
      episodeContent: userMessage,
      entitiesPayload,
    });
    const summaries = await llm.generate(summaryPrompt, EntitySummariesSchema, {
      schemaName: "entity_summaries",
    });
    const summaryMap = new Map(
      summaries.entity_summaries.map((item) => [item.id, item.summary.trim()]),
    );
    extracted = extracted.map((node, idx) => {
      const summary = summaryMap.get(idx);
      if (summary) {
        node.summary = summary;
      }
      return node;
    });
  } catch (error) {
    console.log(`[graph] summary generation failed: ${String(error)}`);
  }

  return extracted;
}

async function hydrateNodeAttributes(
  episode: EpisodicNode,
  nodes: EntityNode[],
  previousEpisodes: EpisodicNode[],
  entityTypeSchemas?: Record<string, Record<string, string>> | null,
): Promise<void> {
  if (nodes.length === 0) {
    return;
  }

  const prevEpisodeStrings = previousEpisodes
    .map((ep) => truncateForContext(extractUserMessage(ep.content)))
    .slice(-4);
  const entitiesPayload = nodes.map((node, idx) => ({
    id: idx,
    name: node.name,
    labels: node.labels,
    summary: node.summary,
    attributes: node.attributes,
    aliases: node.aliases,
  }));

  const prompt = buildHydrateAttributesPrompt({
    previousEpisodes: prevEpisodeStrings,
    episodeContent: truncateForContext(extractUserMessage(episode.content)),
    entitiesPayload,
    entityTypeSchemas: buildEntityTypeSchemas(entityTypeSchemas),
  });

  const llm = await getGraphStructuredClient();
  try {
    const response = await llm.generate(prompt, EntityAttributeUpdatesSchema, {
      schemaName: "entity_attribute_updates",
    });
    const updates = new Map(
      response.entity_attributes.map((update) => [update.id, update.attributes]),
    );
    const protectedKeys = new Set(["is_speaker", "user_id"]);

    nodes.forEach((node, idx) => {
      const incoming = updates.get(idx);
      if (!incoming) {
        return;
      }
      let changed = false;
      Object.entries(incoming).forEach(([key, value]) => {
        if (protectedKeys.has(key)) {
          return;
        }
        if (value === null || value === undefined) {
          return;
        }
        if (typeof value === "string" && !value.trim()) {
          return;
        }
        if (Array.isArray(value) && value.length === 0) {
          return;
        }
        if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
          return;
        }
        if (node.attributes[key] !== value) {
          node.attributes[key] = value;
          changed = true;
        }
      });
      if (changed) {
        node.attributes = { ...node.attributes };
      }
    });
  } catch (error) {
    console.log(`[graph] attribute hydration failed: ${String(error)}`);
  }
}

async function deduplicateNodes(
  extractedNodes: EntityNode[],
  episode: EpisodicNode,
  previousEpisodes: EpisodicNode[],
  embedder: OpenAIEmbedder,
): Promise<{ resolved: EntityNode[]; uuidMap: Map<string, string> }> {
  const candidates = await searchSimilarNodes(extractedNodes, episode.group_id, (text) =>
    embedder.create(text),
  );
  if (candidates.length === 0) {
    return {
      resolved: extractedNodes,
      uuidMap: new Map(extractedNodes.map((node) => [node.uuid, node.uuid])),
    };
  }

  const candidateUuids = candidates.map((node) => node.uuid);
  const relevantEpisodes = await getEpisodesForEntities(candidateUuids, episode.group_id, 10);
  const contextEpisodes = relevantEpisodes.length > 0 ? relevantEpisodes : previousEpisodes;

  const extractedContext = extractedNodes.map((node, idx) => ({
    id: idx,
    name: node.name,
    entity_type: node.labels,
    attributes: node.attributes,
  }));

  const existingContext = candidates.map((node, idx) => ({
    idx,
    name: node.name,
    entity_types: node.labels,
    summary: node.summary,
    attributes: node.attributes,
  }));

  const prompt = buildDedupeEntitiesPrompt({
    extractedNodes: extractedContext,
    existingNodes: existingContext,
    episodeContent: truncateForContext(extractUserMessage(episode.content)),
    previousEpisodes: contextEpisodes.map((ep) =>
      truncateForContext(extractUserMessage(ep.content)),
    ),
  });

  const llm = await getGraphStructuredClient();
  const response = await llm.generate(prompt, NodeResolutionsSchema, {
    schemaName: "entity_resolutions",
  });

  const resolved: EntityNode[] = [];
  const uuidMap = new Map<string, string>();
  const resolutionById = new Map(
    response.entity_resolutions.map((resolution) => [resolution.id, resolution]),
  );

  extractedNodes.forEach((extracted, idx) => {
    const resolution = resolutionById.get(idx);
    if (!resolution) {
      extracted.mention_count = 1;
      uuidMap.set(extracted.uuid, extracted.uuid);
      resolved.push(extracted);
      return;
    }

    let resolvedNode = extracted;
    if (resolution.duplicate_idx >= 0 && resolution.duplicate_idx < candidates.length) {
      resolvedNode = candidates[resolution.duplicate_idx];
      resolvedNode.mention_count = (resolvedNode.mention_count ?? 1) + 1;
      uuidMap.set(extracted.uuid, resolvedNode.uuid);
      if (extracted.summary && !resolvedNode.summary) {
        resolvedNode.summary = extracted.summary;
      }
      if (extracted.labels.length > 0 && resolvedNode.labels.length === 0) {
        resolvedNode.labels = extracted.labels;
      }
    } else {
      resolvedNode.mention_count = 1;
      uuidMap.set(extracted.uuid, extracted.uuid);
    }

    const canonical = resolution.name?.trim();
    if (canonical && canonical !== resolvedNode.name) {
      resolvedNode.name = canonical;
    }
    resolved.push(resolvedNode);
  });

  return { resolved, uuidMap };
}

async function extractEntityEdges(
  episode: EpisodicNode,
  nodes: EntityNode[],
  previousEpisodes: EpisodicNode[],
  options: {
    edgeTypes?: string[] | null;
    excludedEdgeTypes?: string[] | null;
    extractionContent: string;
  },
): Promise<EntityEdge[]> {
  if (nodes.length < 2) {
    return [];
  }

  const nodesContext = nodes.map((node, idx) => ({
    id: idx,
    name: node.name,
    entity_types: node.labels,
  }));

  let episodeContent = extractUserMessage(options.extractionContent);
  let customPrompt = "";
  if (episode.source === "json") {
    try {
      const parsed = JSON.parse(episodeContent);
      episodeContent = JSON.stringify(parsed, null, 2);
    } catch {
      episodeContent = extractUserMessage(options.extractionContent);
    }
    customPrompt = `
This episode source is JSON from: ${episode.source_description}
Only extract facts that represent durable relationships between entities in the JSON (ownership, membership, association).
Avoid creating edges for purely structural JSON adjacency or transient telemetry fields.
`;
  } else if (episode.source === "code") {
    customPrompt = `
This episode source is CODE from: ${episode.source_description}
Prefer code-aware relation_type values when appropriate (e.g., DEFINES, IMPORTS, CALLS, DEPENDS_ON, USES, LOCATED_IN).
Only extract facts that are clearly supported by the code and involve two distinct ENTITIES.
`;
  } else if (episode.source === "doc") {
    customPrompt = `
This episode source is DOCUMENTATION from: ${episode.source_description}
Prefer doc-aware relation_type values when appropriate (e.g., DESCRIBES, DOCUMENTS, REQUIRES, CONFIGURES, USES).
Only extract facts that are clearly supported by the text and involve two distinct ENTITIES.
`;
  }

  const prompt = buildExtractEdgesPrompt({
    episodeContent,
    previousEpisodes: previousEpisodes.map((ep) =>
      truncateForContext(extractUserMessage(ep.content)),
    ),
    nodesContext,
    referenceTime: episode.valid_at.toISOString(),
    customPrompt,
    edgeTypes: options.edgeTypes ?? null,
    excludedEdgeTypes: options.excludedEdgeTypes ?? null,
  });

  const llm = await getGraphStructuredClient();
  const response = await llm.generate(prompt, ExtractedEdgesSchema, {
    schemaName: "extracted_edges",
  });

  const allowedEdgeTypes = new Set(options.edgeTypes ?? []);
  const excludedEdgeTypes = new Set(options.excludedEdgeTypes ?? []);
  const edges: EntityEdge[] = [];

  for (const edgeData of response.edges) {
    const fact = edgeData.fact?.trim();
    if (!fact) {
      continue;
    }
    const sourceIdx = edgeData.source_entity_id;
    const targetIdx = edgeData.target_entity_id;
    if (sourceIdx < 0 || targetIdx < 0 || sourceIdx >= nodes.length || targetIdx >= nodes.length) {
      continue;
    }
    if (sourceIdx === targetIdx) {
      continue;
    }

    const relationType = (edgeData.relation_type ?? "DEFAULT").trim() || "DEFAULT";
    let finalRelation = relationType;
    if (excludedEdgeTypes.has(finalRelation)) {
      finalRelation = "DEFAULT";
    }
    if (allowedEdgeTypes.size > 0 && !allowedEdgeTypes.has(finalRelation)) {
      finalRelation = "DEFAULT";
    }

    edges.push(
      createEntityEdge({
        source_node_uuid: nodes[sourceIdx].uuid,
        target_node_uuid: nodes[targetIdx].uuid,
        group_id: episode.group_id,
        name: finalRelation,
        fact,
        episodes: [episode.uuid],
        strength: edgeData.strength ?? null,
        valid_at: parseEdgeDate(edgeData.valid_at),
        invalid_at: parseEdgeDate(edgeData.invalid_at),
        attributes: edgeData.attributes ?? {},
      }),
    );
  }

  return edges;
}

async function deduplicateEdges(edges: EntityEdge[], episode: EpisodicNode): Promise<EntityEdge[]> {
  if (edges.length === 0) {
    return [];
  }

  const llm = await getGraphStructuredClient();
  const deduped: EntityEdge[] = [];

  for (const edge of edges) {
    const existing = await getExistingEdges(
      edge.source_node_uuid,
      edge.target_node_uuid,
      edge.group_id,
    );
    if (existing.length === 0) {
      deduped.push(edge);
      continue;
    }

    const activeEdges = existing.filter((item) => item.invalid_at === null);
    const invalidationCandidates = existing.filter((item) => item.invalid_at === null);

    const newEdgeData = {
      relation_type: edge.name,
      fact: edge.fact,
      valid_at: edge.valid_at ? edge.valid_at.toISOString() : null,
      invalid_at: edge.invalid_at ? edge.invalid_at.toISOString() : null,
    };

    const existingEdgesData = activeEdges.map((item, idx) => ({
      idx,
      relation_type: item.name,
      fact: item.fact,
      valid_at: item.valid_at ? item.valid_at.toISOString() : null,
      invalid_at: item.invalid_at ? item.invalid_at.toISOString() : null,
    }));

    const invalidationCandidatesData = invalidationCandidates.map((item, idx) => ({
      idx,
      relation_type: item.name,
      fact: item.fact,
      valid_at: item.valid_at ? item.valid_at.toISOString() : null,
    }));

    const prompt = buildDedupeEdgesPrompt({
      newEdge: newEdgeData,
      existingEdges: existingEdgesData,
      invalidationCandidates: invalidationCandidatesData,
    });

    const response = await llm.generate(prompt, EdgeDuplicateSchema, {
      schemaName: "edge_duplicate",
    });

    if (response.contradicted_facts.length > 0) {
      for (const idx of response.contradicted_facts) {
        if (idx >= 0 && idx < invalidationCandidates.length) {
          await invalidateEdge(invalidationCandidates[idx].uuid, edge.valid_at ?? nowUtc());
        }
      }
    }

    if (response.duplicate_facts.length > 0) {
      const duplicateIdx = response.duplicate_facts[0];
      if (duplicateIdx >= 0 && duplicateIdx < activeEdges.length) {
        const existingEdge = activeEdges[duplicateIdx];
        const episodeId = edge.episodes[0];
        if (episodeId && !existingEdge.episodes.includes(episodeId)) {
          existingEdge.episodes.push(episodeId);
          await saveEntityEdge(existingEdge);
        }
        continue;
      }
    }

    deduped.push(edge);
  }

  return deduped;
}

async function refineEdgeDates(
  episode: EpisodicNode,
  edges: EntityEdge[],
  previousEpisodes: EpisodicNode[],
): Promise<void> {
  const edgesToRefine: Array<Record<string, unknown>> = [];
  const edgeMap = new Map<number, EntityEdge>();

  edges.forEach((edge, idx) => {
    if (edge.valid_at && edge.invalid_at) {
      return;
    }
    edgeMap.set(idx, edge);
    edgesToRefine.push({
      id: idx,
      relation_type: edge.name,
      fact: edge.fact,
      valid_at: edge.valid_at ? edge.valid_at.toISOString() : null,
      invalid_at: edge.invalid_at ? edge.invalid_at.toISOString() : null,
    });
  });

  if (edgesToRefine.length === 0) {
    return;
  }

  const prompt = buildExtractEdgeDatesPrompt({
    previousEpisodes: previousEpisodes.map((ep) =>
      truncateForContext(extractUserMessage(ep.content)),
    ),
    episodeContent: truncateForContext(extractUserMessage(episode.content)),
    edges: edgesToRefine,
    referenceTime: episode.valid_at.toISOString(),
  });

  const llm = await getGraphStructuredClient();
  try {
    const response = await llm.generate(prompt, EdgeDateUpdatesSchema, {
      schemaName: "edge_date_updates",
    });
    const updates = new Map(response.edge_dates.map((update) => [update.id, update]));
    edgeMap.forEach((edge, idx) => {
      const update = updates.get(idx);
      if (!update) {
        return;
      }
      if (!edge.valid_at && update.valid_at) {
        edge.valid_at = parseEdgeDate(update.valid_at) ?? edge.valid_at;
      }
      if (!edge.invalid_at && update.invalid_at) {
        edge.invalid_at = parseEdgeDate(update.invalid_at) ?? edge.invalid_at;
      }
    });
  } catch (error) {
    console.log(`[graph] edge date refinement failed: ${String(error)}`);
  }
}

async function extractFactNodes(
  episode: EpisodicNode,
  nodes: EntityNode[],
  previousEpisodes: EpisodicNode[],
  extractionContent: string,
): Promise<{ factNodes: FactNode[]; factRoles: FactRoleEdge[] }> {
  if (nodes.length < 2) {
    return { factNodes: [], factRoles: [] };
  }

  const nodesContext = nodes.map((node, idx) => ({
    id: idx,
    name: node.name,
    entity_types: node.labels,
  }));
  let episodeContent = extractUserMessage(extractionContent);
  let customPrompt = "";
  if (episode.source === "json") {
    try {
      const parsed = JSON.parse(episodeContent);
      episodeContent = JSON.stringify(parsed, null, 2);
    } catch {
      episodeContent = extractUserMessage(extractionContent);
    }
    customPrompt = `
This episode source is JSON from: ${episode.source_description}
Extract only durable, semantically meaningful facts (ownership, membership, assignments, configuration).
Avoid transient telemetry or structural adjacency in JSON.
`;
  } else if (episode.source === "code") {
    customPrompt = `
This episode source is CODE from: ${episode.source_description}
Extract only durable code facts (ownership, definitions, dependencies, incidents, decisions).
Avoid transient runtime details or purely local variables.
`;
  } else if (episode.source === "doc") {
    customPrompt = `
This episode source is DOCUMENTATION from: ${episode.source_description}
Extract only durable facts (decisions, requirements, constraints, roles, responsibilities).
Avoid purely narrative or speculative statements.
`;
  }

  const prompt = buildExtractFactsPrompt({
    episodeContent,
    previousEpisodes: previousEpisodes.map((ep) =>
      truncateForContext(extractUserMessage(ep.content)),
    ),
    nodesContext,
    referenceTime: episode.valid_at.toISOString(),
    customPrompt,
  });

  const llm = await getGraphStructuredClient();
  let response;
  try {
    response = await llm.generate(prompt, ExtractedFactsSchema, {
      schemaName: "extracted_facts",
    });
  } catch (error) {
    console.log(`[graph] fact extraction failed: ${String(error)}`);
    return { factNodes: [], factRoles: [] };
  }

  const factNodes: FactNode[] = [];
  const factRoles: FactRoleEdge[] = [];
  const seenFactUuids = new Set<string>();

  for (const factData of response.facts) {
    const factText = factData.fact?.trim();
    if (!factText) {
      continue;
    }

    const roleEntries: Array<{ entityUuid: string; role: string; roleDescription: string | null }> =
      [];
    const seenRoles = new Set<string>();
    const entityUuids = new Set<string>();

    for (const role of factData.roles) {
      if (role.entity_id < 0 || role.entity_id >= nodes.length) {
        continue;
      }
      const roleName = (role.role ?? "").trim();
      if (!roleName) {
        continue;
      }
      const entityUuid = nodes[role.entity_id].uuid;
      const key = `${entityUuid}:${roleName}`;
      if (seenRoles.has(key)) {
        continue;
      }
      seenRoles.add(key);
      entityUuids.add(entityUuid);
      roleEntries.push({
        entityUuid,
        role: roleName,
        roleDescription: role.role_description ?? null,
      });
    }

    if (entityUuids.size < 2) {
      continue;
    }

    const factAttributes: Record<string, unknown> = { ...(factData.attributes ?? {}) };
    const factType = (factData.fact_type ?? "").trim();
    if (factType && factType.toUpperCase() !== "DEFAULT") {
      factAttributes.fact_type = factType;
    }

    let factNode = createFactNode({
      fact: factText,
      group_id: episode.group_id,
      attributes: factAttributes,
      episodes: [episode.uuid],
      valid_at: parseEdgeDate(factData.valid_at),
      invalid_at: parseEdgeDate(factData.invalid_at),
    });

    const existing = await getFactByText(factText, episode.group_id);
    if (existing) {
      if (!existing.episodes.includes(episode.uuid)) {
        existing.episodes.push(episode.uuid);
      }
      if (!existing.valid_at && factNode.valid_at) {
        existing.valid_at = factNode.valid_at;
      }
      if (!existing.invalid_at && factNode.invalid_at) {
        existing.invalid_at = factNode.invalid_at;
      }
      for (const [key, value] of Object.entries(factAttributes)) {
        if (!(key in existing.attributes)) {
          existing.attributes[key] = value;
        }
      }
      factNode = existing;
    }

    if (!seenFactUuids.has(factNode.uuid)) {
      factNodes.push(factNode);
      seenFactUuids.add(factNode.uuid);
    }

    for (const entry of roleEntries) {
      factRoles.push(
        createFactRoleEdge({
          source_node_uuid: factNode.uuid,
          target_node_uuid: entry.entityUuid,
          group_id: episode.group_id,
          role: entry.role,
          role_description: entry.roleDescription,
        }),
      );
    }
  }

  return { factNodes, factRoles };
}

const CONFLICT_ATTRIBUTE_EXCLUSIONS = new Set([
  "archival",
  "confidence",
  "fact_type",
  "sources",
  "tags",
]);

function normalizeConflictValue(value: unknown): unknown | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function extractConflictAttributes(
  attributes: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!attributes) {
    return {};
  }
  const conflicts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (CONFLICT_ATTRIBUTE_EXCLUSIONS.has(key)) {
      continue;
    }
    const normalized = normalizeConflictValue(value);
    if (normalized === null) {
      continue;
    }
    conflicts[key] = normalized;
  }
  return conflicts;
}

function buildRoleSignature(roles: FactRoleEdge[] | FactRoleDetail[]): Record<string, string[]> {
  const signature: Record<string, Set<string>> = {};
  roles.forEach((role) => {
    const roleName = (role as FactRoleEdge).role ?? (role as FactRoleDetail).role;
    const entityUuid =
      (role as FactRoleEdge).target_node_uuid ?? (role as FactRoleDetail).entity_uuid;
    if (!roleName || !entityUuid) {
      return;
    }
    signature[roleName] = signature[roleName] ?? new Set();
    signature[roleName].add(entityUuid);
  });

  const normalized: Record<string, string[]> = {};
  Object.entries(signature).forEach(([role, uuids]) => {
    normalized[role] = Array.from(uuids).sort();
  });
  return normalized;
}

function findAttributeConflicts(
  newFact: FactNode,
  newRoles: FactRoleEdge[],
  candidateFacts: FactNode[],
  rolesByCandidate: Map<string, FactRoleDetail[]>,
): FactNode[] {
  const roleSignature = buildRoleSignature(newRoles);
  if (Object.keys(roleSignature).length === 0) {
    return [];
  }

  const newAttributes = extractConflictAttributes(newFact.attributes);
  if (Object.keys(newAttributes).length === 0) {
    return [];
  }

  const conflicts: FactNode[] = [];
  candidateFacts.forEach((candidate) => {
    const candidateRoles = rolesByCandidate.get(candidate.uuid) ?? [];
    const candidateSignature = buildRoleSignature(candidateRoles);
    if (JSON.stringify(candidateSignature) !== JSON.stringify(roleSignature)) {
      return;
    }
    const candidateAttributes = extractConflictAttributes(candidate.attributes);
    if (Object.keys(candidateAttributes).length === 0) {
      return;
    }
    for (const [key, value] of Object.entries(newAttributes)) {
      if (key in candidateAttributes && candidateAttributes[key] !== value) {
        conflicts.push(candidate);
        break;
      }
    }
  });

  return conflicts;
}

async function deduplicateFactNodes(
  episode: EpisodicNode,
  factNodes: FactNode[],
  factRoles: FactRoleEdge[],
): Promise<{ factNodes: FactNode[]; factRoles: FactRoleEdge[] }> {
  if (factNodes.length === 0) {
    return { factNodes: [], factRoles: [] };
  }

  const rolesByFact = new Map<string, FactRoleEdge[]>();
  factRoles.forEach((role) => {
    const list = rolesByFact.get(role.source_node_uuid) ?? [];
    list.push(role);
    rolesByFact.set(role.source_node_uuid, list);
  });

  const dedupedFacts: FactNode[] = [];
  const dedupedRoles: FactRoleEdge[] = [];
  const seenFactUuids = new Set<string>();
  const llm = await getGraphStructuredClient();

  for (const fact of factNodes) {
    const roles = rolesByFact.get(fact.uuid) ?? [];
    const entityUuids = Array.from(new Set(roles.map((role) => role.target_node_uuid)));
    if (entityUuids.length === 0) {
      if (!seenFactUuids.has(fact.uuid)) {
        dedupedFacts.push(fact);
        seenFactUuids.add(fact.uuid);
      }
      dedupedRoles.push(...roles);
      continue;
    }

    const candidates = (await getFactsByEntities(entityUuids, episode.group_id, 5)).filter(
      (candidate) => candidate.uuid !== fact.uuid,
    );
    if (candidates.length === 0) {
      if (!seenFactUuids.has(fact.uuid)) {
        dedupedFacts.push(fact);
        seenFactUuids.add(fact.uuid);
      }
      dedupedRoles.push(...roles);
      continue;
    }

    const candidateRoles = await getFactRoles(
      candidates.map((candidate) => candidate.uuid),
      episode.group_id,
    );
    const rolesByCandidate = new Map<string, FactRoleDetail[]>();
    candidateRoles.forEach((role) => {
      const list = rolesByCandidate.get(role.fact_uuid) ?? [];
      list.push(role);
      rolesByCandidate.set(role.fact_uuid, list);
    });

    const entityNames = new Map<string, string>();
    for (const uuid of entityUuids) {
      const entity = await getEntityByUuid(uuid);
      entityNames.set(uuid, entity?.name ?? uuid);
    }

    const newFactPayload = {
      fact: fact.fact,
      roles: roles.map((role) => ({
        role: role.role,
        entity: entityNames.get(role.target_node_uuid) ?? role.target_node_uuid,
      })),
    };

    const existingFactsPayload = candidates.map((candidate, idx) => ({
      idx,
      fact: candidate.fact,
      roles: (rolesByCandidate.get(candidate.uuid) ?? []).map((role) => ({
        role: role.role,
        entity_name: role.entity_name,
      })),
    }));

    let response;
    try {
      const prompt = buildDedupeFactsPrompt({
        newFact: newFactPayload,
        existingFacts: existingFactsPayload,
      });
      response = await llm.generate(prompt, FactDuplicateSchema, { schemaName: "fact_duplicate" });
    } catch (error) {
      console.log(`[graph] fact dedupe failed: ${String(error)}`);
      response = { duplicate_facts: [] };
    }

    let resolvedFact = fact;
    let isDuplicate = false;
    if (response.duplicate_facts.length > 0) {
      const duplicateIdx = response.duplicate_facts[0];
      if (duplicateIdx >= 0 && duplicateIdx < candidates.length) {
        const existing = candidates[duplicateIdx];
        if (!existing.episodes.includes(episode.uuid)) {
          existing.episodes.push(episode.uuid);
        }
        if (!existing.valid_at && fact.valid_at) {
          existing.valid_at = fact.valid_at;
        }
        if (!existing.invalid_at && fact.invalid_at) {
          existing.invalid_at = fact.invalid_at;
        }
        for (const [key, value] of Object.entries(fact.attributes)) {
          if (!(key in existing.attributes)) {
            existing.attributes[key] = value;
          }
        }
        resolvedFact = existing;
        isDuplicate = true;
      }
    }

    if (!isDuplicate) {
      const conflicts = findAttributeConflicts(fact, roles, candidates, rolesByCandidate);
      if (conflicts.length > 0) {
        fact.supersedes = fact.supersedes ?? [];
        conflicts.forEach((conflicted) => {
          if (!fact.supersedes.includes(conflicted.uuid)) {
            fact.supersedes.push(conflicted.uuid);
          }
          conflicted.superseded_by = conflicted.superseded_by ?? [];
          if (!conflicted.superseded_by.includes(fact.uuid)) {
            conflicted.superseded_by.push(fact.uuid);
          }
          if (
            !conflicted.invalid_at ||
            (episode.valid_at && conflicted.invalid_at > episode.valid_at)
          ) {
            conflicted.invalid_at = episode.valid_at;
          }
          void saveFactNode(conflicted);
        });
      }
    }

    roles.forEach((role) => {
      role.source_node_uuid = resolvedFact.uuid;
      dedupedRoles.push(role);
    });

    if (!seenFactUuids.has(resolvedFact.uuid)) {
      dedupedFacts.push(resolvedFact);
      seenFactUuids.add(resolvedFact.uuid);
    }
  }

  return { factNodes: dedupedFacts, factRoles: dedupedRoles };
}

async function generateNodeEmbeddings(
  embedder: OpenAIEmbedder,
  nodes: EntityNode[],
): Promise<void> {
  if (nodes.length === 0) {
    return;
  }
  const names = nodes.map((node) => node.name.replace(/\n/g, " "));
  const embeddings = await embedder.createBatch(names);
  nodes.forEach((node, idx) => {
    node.name_embedding = embeddings[idx] ?? null;
  });
}

async function generateEdgeEmbeddings(
  embedder: OpenAIEmbedder,
  edges: EntityEdge[],
): Promise<void> {
  if (edges.length === 0) {
    return;
  }
  const facts = edges.map((edge) => edge.fact.replace(/\n/g, " "));
  const embeddings = await embedder.createBatch(facts);
  edges.forEach((edge, idx) => {
    edge.fact_embedding = embeddings[idx] ?? null;
  });
}

async function generateFactEmbeddings(embedder: OpenAIEmbedder, facts: FactNode[]): Promise<void> {
  if (facts.length === 0) {
    return;
  }
  const texts = facts.map((fact) => fact.fact.replace(/\n/g, " "));
  const embeddings = await embedder.createBatch(texts);
  facts.forEach((fact, idx) => {
    fact.fact_embedding = embeddings[idx] ?? null;
  });
}

async function saveNodesAndEdges(
  episode: EpisodicNode,
  allNodes: EntityNode[],
  newNodes: EntityNode[],
  edges: EntityEdge[],
  factNodes: FactNode[],
  factRoleEdges: FactRoleEdge[],
): Promise<void> {
  const nodesWithEmbeddings = allNodes.filter((node) => node.name_embedding !== null);
  for (const node of nodesWithEmbeddings) {
    node.last_mentioned = episode.created_at;
    await saveEntityNode(node);
  }

  for (const edge of edges) {
    await saveEntityEdge(edge);
  }

  for (const fact of factNodes) {
    await saveFactNode(fact);
  }

  for (const factRole of factRoleEdges) {
    await saveFactRoleEdge(factRole);
  }

  for (const node of allNodes) {
    const episodicEdge = createEpisodicEdge({
      source_node_uuid: episode.uuid,
      target_node_uuid: node.uuid,
      group_id: episode.group_id,
    });
    await saveEpisodicEdge(episodicEdge);
  }

  episode.entity_edges = await getEdgeUuidsForEpisode(episode.uuid, episode.group_id);
  episode.fact_nodes = await getFactUuidsForEpisode(episode.uuid, episode.group_id);
  await saveEpisodicNode(episode);

  if (newNodes.length > 0 || edges.length > 0 || factNodes.length > 0) {
    console.log(
      `[graph] stored episode ${episode.uuid} nodes=${newNodes.length} edges=${edges.length} facts=${factNodes.length}`,
    );
  }
}

async function generateConversationId(
  currentTimestamp: Date,
  sourceDescription: string,
  groupId: string,
  idleThresholdMinutes: number,
): Promise<string> {
  const recent = await findRecentConversationId(groupId, sourceDescription);
  if (recent && recent.validAt) {
    const gapMinutes = (currentTimestamp.getTime() - recent.validAt.getTime()) / 60000;
    if (gapMinutes <= idleThresholdMinutes) {
      return recent.conversationId;
    }
  }

  const date = currentTimestamp.toISOString().split("T")[0];
  return `${date}_${sourceDescription}`;
}

export type AddEpisodeOptions = {
  episodeBody: string;
  sourceDescription: string;
  referenceTime: Date;
  source?: EpisodeType;
  groupId?: string;
  name?: string | null;
  conversationId?: string | null;
  speakerId?: string | null;
  speakerName?: string | null;
  personality?: string | null;
  extractionContent?: string | null;
  entityTypes?: string[] | null;
  excludedEntityTypes?: string[] | null;
  edgeTypes?: string[] | null;
  excludedEdgeTypes?: string[] | null;
};

export type AddEpisodeResults = {
  episode: EpisodicNode;
  nodes: EntityNode[];
  edges: EntityEdge[];
  facts: FactNode[];
  factRoles: FactRoleEdge[];
};

export async function addEpisode(options: AddEpisodeOptions): Promise<AddEpisodeResults> {
  const config = await loadConfig();
  const graphConfig = (config.dere_graph ?? {}) as Record<string, unknown>;
  if (graphConfig.enabled === false) {
    throw new Error("dere_graph disabled");
  }

  if (!(await graphAvailable())) {
    throw new Error("graph not available");
  }

  const groupId = options.groupId ?? "default";
  const sourceDescription = options.sourceDescription;
  const referenceTime = options.referenceTime;
  const source = options.source ?? "text";
  const idleThreshold =
    typeof graphConfig.idle_threshold_minutes === "number"
      ? graphConfig.idle_threshold_minutes
      : 15;

  const conversationId =
    options.conversationId ??
    (await generateConversationId(referenceTime, sourceDescription, groupId, idleThreshold));

  const name = options.name ?? referenceTime.toISOString().split("T")[0];

  let episode: EpisodicNode;
  const existingEpisodes = await getEpisodesByConversationId(groupId, conversationId);
  if (existingEpisodes.length > 0) {
    episode = existingEpisodes[0];
    episode.content = `${episode.content}\n\n${options.episodeBody}`.trim();
  } else {
    episode = createEpisodicNode({
      name,
      group_id: groupId,
      source,
      source_description: sourceDescription,
      content: options.episodeBody,
      valid_at: referenceTime,
      conversation_id: conversationId,
      speaker_id: options.speakerId ?? null,
      speaker_name: options.speakerName ?? null,
      personality: options.personality ?? null,
    });
  }

  const extractionContent = options.extractionContent ?? options.episodeBody;

  const previousEpisodes = await getRecentEpisodes(groupId, 5);

  await saveEpisodicNode(episode);

  const embedder = await OpenAIEmbedder.fromConfig();
  const enableReflection = graphConfig.enable_reflection !== false;

  const extractedNodes = await extractNodes({
    episode,
    previousEpisodes,
    enableReflection,
    extractionContent,
    entityTypes: options.entityTypes ?? null,
    excludedEntityTypes: options.excludedEntityTypes ?? null,
  });

  if (extractedNodes.length === 0) {
    return { episode, nodes: [], edges: [], facts: [], factRoles: [] };
  }

  const { resolved, uuidMap } = await deduplicateNodes(
    extractedNodes,
    episode,
    previousEpisodes,
    embedder,
  );

  const enableAttributeHydration = false;
  if (enableAttributeHydration) {
    await hydrateNodeAttributes(episode, resolved, previousEpisodes, null);
  }

  const edges = await extractEntityEdges(episode, resolved, previousEpisodes, {
    edgeTypes: options.edgeTypes ?? null,
    excludedEdgeTypes: options.excludedEdgeTypes ?? null,
    extractionContent,
  });

  const dedupedEdges = await deduplicateEdges(edges, episode);

  const enableEdgeDateRefinement = false;
  if (enableEdgeDateRefinement) {
    await refineEdgeDates(episode, dedupedEdges, previousEpisodes);
  }

  const { factNodes, factRoles } = await extractFactNodes(
    episode,
    resolved,
    previousEpisodes,
    extractionContent,
  );
  const dedupedFacts = await deduplicateFactNodes(episode, factNodes, factRoles);

  const nodesNeedingEmbeddings = resolved.filter((node) => !node.name_embedding);
  if (nodesNeedingEmbeddings.length > 0) {
    await generateNodeEmbeddings(embedder, nodesNeedingEmbeddings);
  }

  const newNodeUuids = new Set(
    Array.from(uuidMap.entries())
      .filter(([key, value]) => key === value)
      .map(([key]) => key),
  );
  const newNodes = resolved.filter((node) => newNodeUuids.has(node.uuid));

  if (dedupedEdges.length > 0) {
    await generateEdgeEmbeddings(embedder, dedupedEdges);
  }

  if (dedupedFacts.factNodes.length > 0) {
    const factsNeedingEmbeddings = dedupedFacts.factNodes.filter((fact) => !fact.fact_embedding);
    if (factsNeedingEmbeddings.length > 0) {
      await generateFactEmbeddings(embedder, factsNeedingEmbeddings);
    }
  }

  await saveNodesAndEdges(
    episode,
    resolved,
    newNodes,
    dedupedEdges,
    dedupedFacts.factNodes,
    dedupedFacts.factRoles,
  );

  return {
    episode,
    nodes: newNodes,
    edges: dedupedEdges,
    facts: dedupedFacts.factNodes,
    factRoles: dedupedFacts.factRoles,
  };
}
