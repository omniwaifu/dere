import { z } from "zod";

type PromptPair = {
  system: string;
  user: string;
};

function buildPrompt({ system, user }: PromptPair): string {
  return `SYSTEM:\n${system}\n\nUSER:\n${user}`;
}

export const ExtractedEntitySchema = z.object({
  name: z.string(),
  entity_type: z.string().nullable().optional(),
  knowledge_scope: z.enum(["skip", "curious"]).default("skip"),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  aliases: z.array(z.string()).optional().default([]),
});

export const ExtractedEntitiesSchema = z.object({
  extracted_entities: z.array(ExtractedEntitySchema).optional().default([]),
});

export const EntitySummarySchema = z.object({
  id: z.number(),
  summary: z.string(),
});

export const EntitySummariesSchema = z.object({
  entity_summaries: z.array(EntitySummarySchema).optional().default([]),
});

export const EntityAttributeUpdateSchema = z.object({
  id: z.number(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});

export const EntityAttributeUpdatesSchema = z.object({
  entity_attributes: z.array(EntityAttributeUpdateSchema).optional().default([]),
});

export const EdgeSchema = z.object({
  relation_type: z.string(),
  source_entity_id: z.number(),
  target_entity_id: z.number(),
  fact: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  valid_at: z.string().nullable().optional(),
  invalid_at: z.string().nullable().optional(),
  strength: z.number().nullable().optional(),
});

export const ExtractedEdgesSchema = z.object({
  edges: z.array(EdgeSchema).optional().default([]),
});

export const FactRoleSchema = z.object({
  entity_id: z.number(),
  role: z.string(),
  role_description: z.string().nullable().optional(),
});

export const FactSchema = z.object({
  fact: z.string(),
  roles: z.array(FactRoleSchema).optional().default([]),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
  fact_type: z.string().nullable().optional(),
  valid_at: z.string().nullable().optional(),
  invalid_at: z.string().nullable().optional(),
});

export const ExtractedFactsSchema = z.object({
  facts: z.array(FactSchema).optional().default([]),
});

export const EdgeDateUpdateSchema = z.object({
  id: z.number(),
  valid_at: z.string().nullable().optional(),
  invalid_at: z.string().nullable().optional(),
});

export const EdgeDateUpdatesSchema = z.object({
  edge_dates: z.array(EdgeDateUpdateSchema).optional().default([]),
});

export const NodeDuplicateSchema = z.object({
  id: z.number(),
  duplicate_idx: z.number(),
  name: z.string(),
  duplicates: z.array(z.number()).optional().default([]),
});

export const NodeResolutionsSchema = z.object({
  entity_resolutions: z.array(NodeDuplicateSchema).optional().default([]),
});

export const EdgeDuplicateSchema = z.object({
  duplicate_facts: z.array(z.number()).optional().default([]),
  contradicted_facts: z.array(z.number()).optional().default([]),
  fact_type: z.string().optional().default("DEFAULT"),
});

export const FactDuplicateSchema = z.object({
  duplicate_facts: z.array(z.number()).optional().default([]),
});

export const MissedEntitySchema = z.object({
  name: z.string(),
  summary: z.string(),
});

export const EntityRefinementSchema = z.object({
  original_name: z.string(),
  refined_name: z.string().nullable().optional(),
  refined_summary: z.string().nullable().optional(),
});

export const EntityValidationSchema = z.object({
  missed_entities: z.array(MissedEntitySchema).optional().default([]),
  hallucinated_entities: z.array(z.string()).optional().default([]),
  refinements: z.array(EntityRefinementSchema).optional().default([]),
});

export function buildExtractEntitiesPrompt(options: {
  episodeContent: string;
  previousEpisodes?: string[];
  customPrompt?: string;
  speakerId?: string | null;
  speakerName?: string | null;
  personality?: string | null;
  entityTypes?: string[] | null;
  excludedEntityTypes?: string[] | null;
}): string {
  const system = `You are an AI assistant that extracts entity nodes from text.
Your primary task is to extract and classify significant entities mentioned in the provided text.`;

  let speakerContext = "";
  if (options.speakerName && options.speakerId) {
    speakerContext = `
<SPEAKER>
This message was spoken by: ${options.speakerName} (ID: ${options.speakerId})
</SPEAKER>

CRITICAL: When extracting entities, resolve first-person pronouns:
- "I", "me", "my", "mine", "myself" -> ${options.speakerName}
- Always create a User/Person entity for the speaker (and place it FIRST in the output list)
- Link all first-person actions/preferences/statements to the speaker entity

Example:
- "I like the color blue" -> Extract: Entity("${options.speakerName}", type="User"), Entity("blue", type="Color")
- "My project is called dere" -> Extract: Entity("${options.speakerName}", type="User"), Entity("dere", type="Project")
`;
  } else if (options.speakerName) {
    speakerContext = `
<SPEAKER>
This message was spoken by: ${options.speakerName}
</SPEAKER>

CRITICAL: Resolve first-person pronouns (I, me, my, mine) to ${options.speakerName}.
`;
  }

  if (options.personality) {
    const speakerName = options.speakerName ?? "User";
    speakerContext += `
<BOT>
The AI assistant responding to this conversation is: ${options.personality}
</BOT>

CRITICAL: When extracting entities:
- Always create an AI/Assistant entity for ${options.personality}
- Second-person pronouns ("you", "your", "yours") in user messages refer to ${options.personality}
- Extract ${options.personality} as an entity when the user addresses the bot

Example:
- "I like you" -> Extract: Entity("${speakerName}", type="User"), Entity("${options.personality}", type="Assistant")
- "You are helpful" -> Extract: Entity("${options.personality}", type="Assistant")
`;
  }

  let entityTypeContext = "";
  if (options.entityTypes && options.entityTypes.length > 0) {
    entityTypeContext = `
<ENTITY_TYPES>
Focus on extracting entities of these types: ${options.entityTypes.join(", ")}
</ENTITY_TYPES>
`;
  }

  if (options.excludedEntityTypes && options.excludedEntityTypes.length > 0) {
    entityTypeContext += `
<EXCLUDED_TYPES>
Do NOT extract entities of these types: ${options.excludedEntityTypes.join(", ")}
</EXCLUDED_TYPES>
`;
  }

  let previousContext = "";
  if (options.previousEpisodes && options.previousEpisodes.length > 0) {
    previousContext = `
<PREVIOUS_MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS_MESSAGES>
`;
  }

  const user = `
${speakerContext}
${entityTypeContext}
${previousContext}

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

Given the above CURRENT_MESSAGE (and optional PREVIOUS_MESSAGES for context), extract entities that are explicitly or
implicitly mentioned in the CURRENT_MESSAGE.

IMPORTANT: You may use PREVIOUS_MESSAGES only to disambiguate references. Do NOT extract entities mentioned only in
PREVIOUS_MESSAGES.

${options.customPrompt ?? ""}

Entity Extraction Guidelines:
1. Extract anything worth remembering from the conversation - think broadly, pretend you're assembling a dossier:
   - People, places, things
   - Topics they care about
   - Things they like, dislike, or prefer
   - Things that matter to them or describe them
   - Anything that would help understand the person or conversation better
2. Avoid creating nodes for relationships or actions (these are edges, not nodes).
3. Avoid creating nodes for temporal information like dates, times or years.
4. Be as explicit as possible in your node names, using full names and avoiding abbreviations.
5. IMPORTANT: If speaker context is provided, resolve all first-person pronouns to the speaker's name.

QUOTED/SHARED CONTENT HANDLING:
- If the message contains pasted content from external sources (Reddit threads, forum posts, articles, chat logs),
  do NOT attribute opinions or preferences from that content to the speaker.
- Look for patterns indicating external content: "u/username", "User X said", block quotes, discussion framing.
- Extract entities mentioned in shared content, but remember the speaker is DISCUSSING this content, not authoring it.
- The speaker's own framing ("I found this interesting", "I agree with") ARE attributable to the speaker.
${options.entityTypes && options.entityTypes.length > 0 ? `6. Focus on entity types: ${options.entityTypes.join(", ")}` : ""}
${options.excludedEntityTypes && options.excludedEntityTypes.length > 0 ? `7. Exclude entity types: ${options.excludedEntityTypes.join(", ")}` : ""}

Knowledge Scope Classification:
For each entity, classify whether it's worth learning more about:
- "skip": Would an AI assistant already know this from training? (RAM, CPU, Docker, Python, git, Linux, tmux, etc.)
- "curious": Is this something worth exploring further? (niche tools, user-specific context, recent things, obscure libraries)

Examples:
- "RAM" -> skip (everyone knows what RAM is)
- "tmux" -> skip (standard Unix tool)
- "Python" -> skip (major programming language)
- "justin's Hetzner box" -> curious (user-specific, worth understanding their setup)
- "Conduwuit" -> curious (niche Matrix server fork)
- "dere project" -> curious (user's specific project)

When in doubt, default to "skip" - we don't want to waste cycles researching common knowledge.

Attributes:
For each entity, extract relevant attributes that help distinguish it from similar entities:
- For People/Users: job_title, company, location, relationship_to_user, role, expertise, user_id, is_speaker, attributes, preferences
- For Projects: language, framework, status, purpose, repository_url
- For Files/Modules: file_path, module_name, purpose, language
- For Companies/Organizations: industry, size, location
- For Tasks: deadline, priority, status, assignee
- For Concepts: domain, definition

For speaker entities, include: {"is_speaker": true, "user_id": "${options.speakerId ?? "unknown"}"}

Only include attributes that are explicitly mentioned or clearly implied in the text.
Empty attributes dict is acceptable if no distinguishing attributes are present.
`;

  return buildPrompt({ system, user });
}

export function buildSummarizeEntitiesPrompt(options: {
  previousEpisodes: string[];
  episodeContent: string;
  entitiesPayload: Array<Record<string, unknown>>;
}): string {
  const system =
    "You are a helpful assistant that writes concise summaries for entities extracted from a conversation.";

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<ENTITIES>
${JSON.stringify(options.entitiesPayload, null, 2)}
</ENTITIES>

For each entity in ENTITIES, write a concise 1-2 sentence summary describing who/what it is and the most important attributes.
Summaries should capture distinguishing context, roles, and relationships mentioned in the messages.
If there is insufficient information to summarize, return an empty string.
`;

  return buildPrompt({ system, user });
}

export function buildHydrateAttributesPrompt(options: {
  previousEpisodes: string[];
  episodeContent: string;
  entitiesPayload: Array<Record<string, unknown>>;
  entityTypeSchemas?: Record<string, Record<string, string>> | null;
}): string {
  const system = `You are an AI assistant that enriches entity attributes with structured data.
Your task is to extract additional attributes for the provided entities based on the conversation context.`;

  const schemaContext = options.entityTypeSchemas
    ? `\n<ENTITY_TYPE_SCHEMAS>\n${JSON.stringify(options.entityTypeSchemas, null, 2)}\n</ENTITY_TYPE_SCHEMAS>\n`
    : "";

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<ENTITIES>
${JSON.stringify(options.entitiesPayload, null, 2)}
</ENTITIES>
${schemaContext}

Update entity attributes using the provided messages.
Only add attributes that are explicitly mentioned or clearly implied.
Return updated attributes for each entity by id.
`;

  return buildPrompt({ system, user });
}

export function buildExtractEdgesPrompt(options: {
  episodeContent: string;
  previousEpisodes: string[];
  nodesContext: Array<Record<string, unknown>>;
  referenceTime: string;
  customPrompt?: string;
  edgeTypes?: string[] | null;
  excludedEdgeTypes?: string[] | null;
}): string {
  const system =
    "You are a helpful assistant that extracts factual relationships between entities.";

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<ENTITIES>
${JSON.stringify(options.nodesContext, null, 2)}
</ENTITIES>

Reference time: ${options.referenceTime}

${options.customPrompt ?? ""}

Guidelines:
- Extract only relationships between distinct entities in ENTITIES
- If a relation is time-bound, include valid_at/invalid_at in ISO format
- Use relation_type in SCREAMING_SNAKE_CASE
- Provide concise factual "fact" text describing the relationship
${options.edgeTypes && options.edgeTypes.length > 0 ? `- Prefer relation_type values from: ${options.edgeTypes.join(", ")}` : ""}
${options.excludedEdgeTypes && options.excludedEdgeTypes.length > 0 ? `- Avoid relation_type values from: ${options.excludedEdgeTypes.join(", ")}` : ""}
`;

  return buildPrompt({ system, user });
}

export function buildExtractFactsPrompt(options: {
  episodeContent: string;
  previousEpisodes: string[];
  nodesContext: Array<Record<string, unknown>>;
  referenceTime: string;
  customPrompt?: string;
}): string {
  const system = "You are a helpful assistant that extracts multi-entity facts from text.";

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<ENTITIES>
${JSON.stringify(options.nodesContext, null, 2)}
</ENTITIES>

Reference time: ${options.referenceTime}

${options.customPrompt ?? ""}

Guidelines:
- Extract durable facts that involve two or more entities
- For each fact, specify roles with entity_id and role
- Use fact_type in SCREAMING_SNAKE_CASE when applicable, otherwise DEFAULT
- Provide valid_at/invalid_at in ISO format when time-bound
`;

  return buildPrompt({ system, user });
}

export function buildDedupeEntitiesPrompt(options: {
  extractedNodes: Array<Record<string, unknown>>;
  existingNodes: Array<Record<string, unknown>>;
  episodeContent: string;
  previousEpisodes: string[];
}): string {
  const system =
    "You are a helpful assistant that determines whether or not ENTITIES extracted from a conversation are duplicates of existing entities.";

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<ENTITIES>
${JSON.stringify(options.extractedNodes, null, 2)}
</ENTITIES>

<EXISTING ENTITIES>
${JSON.stringify(options.existingNodes, null, 2)}
</EXISTING ENTITIES>

For each of the above ENTITIES, determine if the entity is a duplicate of any of the EXISTING ENTITIES.

Entities should only be considered duplicates if they refer to the *same real-world object or concept*.

Consider the entity attributes when determining duplicates:
- Entities with conflicting attributes (e.g., different companies, different locations) are DIFFERENT entities
- Entities with similar names but different distinguishing attributes should be kept separate
- When in doubt, keep entities separate (conservative approach)

Do NOT mark entities as duplicates if:
- They are related but distinct.
- They have similar names or purposes but refer to separate instances or concepts.
- They have conflicting attribute values (e.g., "Alice (researcher at OpenAI)" vs "Alice (barista)").

Task:
ENTITIES contains ${options.extractedNodes.length} entities with IDs 0 through ${Math.max(
    0,
    options.extractedNodes.length - 1,
  )}.
Your response MUST include EXACTLY ${options.extractedNodes.length} resolutions with IDs 0 through ${Math.max(
    0,
    options.extractedNodes.length - 1,
  )}.

For every entity, return an object with:
- "id": integer id from ENTITIES
- "name": the best full name for the entity
- "duplicate_idx": the idx of the EXISTING ENTITY that is the best duplicate match, or -1 if no duplicate
- "duplicates": a sorted list of all idx values from EXISTING ENTITIES that are duplicates (empty list if none)

Only use idx values that appear in EXISTING ENTITIES.
`;

  return buildPrompt({ system, user });
}

export function buildDedupeEdgesPrompt(options: {
  newEdge: Record<string, unknown>;
  existingEdges: Array<Record<string, unknown>>;
  invalidationCandidates: Array<Record<string, unknown>>;
}): string {
  const system =
    "You are a helpful assistant that de-duplicates facts from fact lists and determines which existing facts are contradicted by the new fact.";

  const user = `
Task:
You will receive TWO separate lists of facts. Each list uses 'idx' as its index field, starting from 0.

1. DUPLICATE DETECTION:
   - If the NEW FACT represents identical factual information as any fact in EXISTING FACTS, return those idx values in duplicate_facts.
   - Facts with similar information that contain key differences should NOT be marked as duplicates.
   - Return idx values from EXISTING FACTS.
   - If no duplicates, return an empty list for duplicate_facts.

2. FACT TYPE CLASSIFICATION:
   - Return the fact type as fact_type or DEFAULT if not a specific type.

3. CONTRADICTION DETECTION:
   - Based on FACT INVALIDATION CANDIDATES and NEW FACT, determine which facts the new fact contradicts.
   - Return idx values from FACT INVALIDATION CANDIDATES.
   - If no contradictions, return an empty list for contradicted_facts.

IMPORTANT:
- duplicate_facts: Use ONLY 'idx' values from EXISTING FACTS
- contradicted_facts: Use ONLY 'idx' values from FACT INVALIDATION CANDIDATES
- These are two separate lists with independent idx ranges starting from 0

<EXISTING FACTS>
${JSON.stringify(options.existingEdges, null, 2)}
</EXISTING FACTS>

<FACT INVALIDATION CANDIDATES>
${JSON.stringify(options.invalidationCandidates, null, 2)}
</FACT INVALIDATION CANDIDATES>

<NEW FACT>
${JSON.stringify(options.newEdge, null, 2)}
</NEW FACT>
`;

  return buildPrompt({ system, user });
}

export function buildDedupeFactsPrompt(options: {
  newFact: Record<string, unknown>;
  existingFacts: Array<Record<string, unknown>>;
}): string {
  const system = "You are a helpful assistant that de-duplicates facts from fact lists.";

  const user = `
Task:
You will receive TWO separate lists of facts. Each list uses 'idx' as its index field, starting from 0.

1. DUPLICATE DETECTION:
   - If the NEW FACT represents identical factual information as any fact in EXISTING FACTS, return those idx values in duplicate_facts.
   - Facts with similar information that contain key differences should NOT be marked as duplicates.
   - Return idx values from EXISTING FACTS.
   - If no duplicates, return an empty list for duplicate_facts.

IMPORTANT:
- duplicate_facts: Use ONLY 'idx' values from EXISTING FACTS

<EXISTING FACTS>
${JSON.stringify(options.existingFacts, null, 2)}
</EXISTING FACTS>

<NEW FACT>
${JSON.stringify(options.newFact, null, 2)}
</NEW FACT>
`;

  return buildPrompt({ system, user });
}

export function buildValidateEntitiesPrompt(options: {
  extractedEntities: Array<Record<string, unknown>>;
  episodeContent: string;
  previousEpisodes: string[];
}): string {
  const system = `You are an expert entity extraction validator. Your task is to review extracted entities and:
1. Identify any important entities that were missed
2. Flag any hallucinated entities that don't actually appear in the conversation
3. Suggest refinements to entity names or summaries for clarity

Be thorough but conservative - only suggest changes when clearly justified.`;

  const entitiesStr = options.extractedEntities
    .map((entity) => `- ${String(entity.name ?? "")}: ${String(entity.summary ?? "No summary")}`)
    .join("\n");

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<EXTRACTED ENTITIES>
${entitiesStr}
</EXTRACTED ENTITIES>

Review the EXTRACTED ENTITIES and provide:

1. **Missed Entities**: Any important entities (people, places, concepts) that were mentioned but not extracted
2. **Hallucinations**: Any extracted entities that don't actually appear in the messages
3. **Refinements**: Suggestions to improve entity names or summaries for clarity

Guidelines:
- Focus on entities that add meaningful context
- Don't extract trivial or overly generic entities
- Entities must be explicitly or clearly implicitly mentioned in the conversation
- Prefer full names over nicknames when both are available
- If extraction looks good, it's fine to return empty lists for missed/hallucinated entities

Return your analysis in this format:
- missed_entities: list of {name, summary} for missed entities
- hallucinated_entities: list of entity names that should be removed
- refinements: list of {original_name, refined_name, refined_summary} for improvements
`;

  return buildPrompt({ system, user });
}

export function buildExtractEdgeDatesPrompt(options: {
  previousEpisodes: string[];
  episodeContent: string;
  edges: Array<Record<string, unknown>>;
  referenceTime: string;
}): string {
  const system = `You are an assistant that extracts valid_at/invalid_at timestamps for edges.`;

  const user = `
<PREVIOUS MESSAGES>
${options.previousEpisodes.join("\n")}
</PREVIOUS MESSAGES>

<CURRENT_MESSAGE>
${options.episodeContent}
</CURRENT_MESSAGE>

<EDGES>
${JSON.stringify(options.edges, null, 2)}
</EDGES>

Reference time: ${options.referenceTime}

Fill in valid_at/invalid_at for the edges when possible.
If unknown, return nulls.
`;

  return buildPrompt({ system, user });
}
