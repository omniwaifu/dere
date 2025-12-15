from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from dere_graph.llm_client import Message


# Response Models for Entity Extraction
class ExtractedEntity(BaseModel):
    name: str = Field(..., description="Name of the extracted entity")
    entity_type: str | None = Field(None, description="Type of the entity")
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Dynamic attributes that help distinguish this entity from others (e.g., job, company, location, role, status)",
    )
    aliases: list[str] = Field(
        default_factory=list,
        description="Alternative names or ways this entity might be referenced (e.g., nicknames, abbreviations, synonyms)",
    )


class ExtractedEntities(BaseModel):
    extracted_entities: list[ExtractedEntity]


class EntitySummary(BaseModel):
    id: int = Field(..., description="The id of the entity from the ENTITIES list")
    summary: str = Field(..., description="Concise 1-2 sentence summary of the entity")


class EntitySummaries(BaseModel):
    entity_summaries: list[EntitySummary]


class EntityAttributeUpdate(BaseModel):
    id: int = Field(..., description="The id of the entity from the ENTITIES list")
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Structured attributes for the entity (keys depend on entity type).",
    )


class EntityAttributeUpdates(BaseModel):
    entity_attributes: list[EntityAttributeUpdate]


# Response Models for Edge Extraction
class Edge(BaseModel):
    relation_type: str = Field(..., description="FACT_PREDICATE_IN_SCREAMING_SNAKE_CASE")
    source_entity_id: int = Field(
        ..., description="The id of the source entity from the ENTITIES list"
    )
    target_entity_id: int = Field(
        ..., description="The id of the target entity from the ENTITIES list"
    )
    fact: str = Field(
        ...,
        description="A natural language description of the relationship between the entities",
    )
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional structured attributes for the fact (e.g., role, priority, status).",
    )
    valid_at: str | None = Field(
        None, description="ISO 8601 datetime when relationship became true"
    )
    invalid_at: str | None = Field(
        None, description="ISO 8601 datetime when relationship stopped being true"
    )
    strength: float | None = Field(
        None,
        description="Intensity/strength of relationship from 0.0 to 1.0 (e.g., 'kinda likes'=0.3, 'likes'=0.6, 'really loves'=0.95)",
    )


class ExtractedEdges(BaseModel):
    edges: list[Edge]


# Response Models for Edge Dates
class EdgeDates(BaseModel):
    valid_at: str | None = Field(
        None, description="ISO 8601 datetime when relationship became true"
    )
    invalid_at: str | None = Field(
        None, description="ISO 8601 datetime when relationship stopped being true"
    )


class EdgeDateUpdate(BaseModel):
    id: int = Field(..., description="The id of the edge from the EDGES list")
    valid_at: str | None = Field(
        None, description="ISO 8601 datetime when relationship became true"
    )
    invalid_at: str | None = Field(
        None, description="ISO 8601 datetime when relationship stopped being true"
    )


class EdgeDateUpdates(BaseModel):
    edge_dates: list[EdgeDateUpdate]


# Response Models for Entity Deduplication
class NodeDuplicate(BaseModel):
    id: int = Field(..., description="integer id of the entity")
    duplicate_idx: int = Field(
        ...,
        description="idx of the duplicate entity. If no duplicate entities are found, default to -1.",
    )
    name: str = Field(
        ...,
        description="Name of the entity. Should be the most complete and descriptive name.",
    )
    duplicates: list[int] = Field(
        ...,
        description="idx of all entities that are a duplicate of the entity with the above id.",
    )


class NodeResolutions(BaseModel):
    entity_resolutions: list[NodeDuplicate]


# Response Models for Entity Validation (Reflection)
class MissedEntity(BaseModel):
    name: str = Field(..., description="Name of the missed entity")
    summary: str = Field(..., description="Brief summary of the entity")


class EntityRefinement(BaseModel):
    original_name: str = Field(..., description="Original entity name to refine")
    refined_name: str | None = Field(None, description="Improved entity name, if applicable")
    refined_summary: str | None = Field(None, description="Improved entity summary, if applicable")


class EntityValidation(BaseModel):
    missed_entities: list[MissedEntity] = Field(
        default_factory=list,
        description="Entities that were mentioned but not extracted",
    )
    hallucinated_entities: list[str] = Field(
        default_factory=list,
        description="Entity names that should be removed (not in conversation)",
    )
    refinements: list[EntityRefinement] = Field(
        default_factory=list,
        description="Suggested improvements to extracted entities",
    )


# Response Models for Edge Deduplication
class EdgeDuplicate(BaseModel):
    duplicate_facts: list[int] = Field(
        ...,
        description="List of idx values of any duplicate facts. If no duplicates found, empty list.",
    )
    contradicted_facts: list[int] = Field(
        ...,
        description="List of idx values of facts that should be invalidated.",
    )
    fact_type: str = Field(..., description="One of the provided fact types or DEFAULT")


# Prompts for Entity Extraction
def extract_entities_text(
    episode_content: str,
    previous_episodes: list[str] | None = None,
    custom_prompt: str = "",
    speaker_id: str | None = None,
    speaker_name: str | None = None,
    personality: str | None = None,
    entity_types: list[str] | None = None,
    excluded_entity_types: list[str] | None = None,
) -> list[Message]:
    sys_prompt = """You are an AI assistant that extracts entity nodes from text.
    Your primary task is to extract and classify significant entities mentioned in the provided text."""

    # Build speaker context if provided
    speaker_context = ""
    if speaker_name and speaker_id:
        speaker_context = f"""
<SPEAKER>
This message was spoken by: {speaker_name} (ID: {speaker_id})
</SPEAKER>

CRITICAL: When extracting entities, resolve first-person pronouns:
- "I", "me", "my", "mine", "myself" → {speaker_name}
- Always create a User/Person entity for the speaker (and place it FIRST in the output list)
- Link all first-person actions/preferences/statements to the speaker entity

Example:
- "I like the color blue" → Extract: Entity("{{speaker_name}}", type="User"), Entity("blue", type="Color")
- "My project is called dere" → Extract: Entity("{{speaker_name}}", type="User"), Entity("dere", type="Project")
"""
    elif speaker_name:
        speaker_context = f"""
<SPEAKER>
This message was spoken by: {speaker_name}
</SPEAKER>

CRITICAL: Resolve first-person pronouns (I, me, my, mine) to {speaker_name}.
"""

    # Add bot/personality context
    if personality:
        speaker_context += f"""
<BOT>
The AI assistant responding to this conversation is: {personality}
</BOT>

CRITICAL: When extracting entities:
- Always create an AI/Assistant entity for {personality}
- Second-person pronouns ("you", "your", "yours") in user messages refer to {personality}
- Extract {personality} as an entity when the user addresses the bot

Example:
- "I like you" → Extract: Entity("{{speaker_name or "User"}}", type="User"), Entity("{{personality}}", type="Assistant")
- "You are helpful" → Extract: Entity("{{personality}}", type="Assistant")
"""

    # Build entity type constraints
    entity_type_context = ""
    if entity_types:
        entity_type_context = f"""
<ENTITY_TYPES>
Focus on extracting entities of these types: {", ".join(entity_types)}
</ENTITY_TYPES>
"""

    if excluded_entity_types:
        entity_type_context += f"""
<EXCLUDED_TYPES>
Do NOT extract entities of these types: {", ".join(excluded_entity_types)}
</EXCLUDED_TYPES>
"""

    # Build previous context if provided
    previous_context = ""
    if previous_episodes:
        previous_context = f"""
<PREVIOUS_MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS_MESSAGES>
"""

    user_prompt = f"""
{speaker_context}
{entity_type_context}
{previous_context}

<CURRENT_MESSAGE>
{episode_content}
</CURRENT_MESSAGE>

Given the above CURRENT_MESSAGE (and optional PREVIOUS_MESSAGES for context), extract entities that are explicitly or
implicitly mentioned in the CURRENT_MESSAGE.

IMPORTANT: You may use PREVIOUS_MESSAGES only to disambiguate references. Do NOT extract entities mentioned only in
PREVIOUS_MESSAGES.

{custom_prompt}

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
{f"6. Focus on entity types: {', '.join(entity_types)}" if entity_types else ""}
{f"7. Exclude entity types: {', '.join(excluded_entity_types)}" if excluded_entity_types else ""}

Attributes:
For each entity, extract relevant attributes that help distinguish it from similar entities:
- For People/Users: job_title, company, location, relationship_to_user, role, expertise, user_id, is_speaker, attributes, preferences
- For Projects: language, framework, status, purpose, repository_url
- For Files/Modules: file_path, module_name, purpose, language
- For Companies/Organizations: industry, size, location
- For Tasks: deadline, priority, status, assignee
- For Concepts: domain, definition

For speaker entities, include: {{"is_speaker": true, "user_id": "{{speaker_id if speaker_id else "unknown"}}"}}

Only include attributes that are explicitly mentioned or clearly implied in the text.
Empty attributes dict is acceptable if no distinguishing attributes are present.
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


def summarize_entities(
    previous_episodes: list[str],
    current_episode: str,
    entities: list[dict[str, Any]],
) -> list[Message]:
    """Generate concise summaries for entities based on the current episode and context."""
    sys_prompt = """You are an expert entity summarizer for a knowledge graph.
You will be given a CURRENT MESSAGE, optional PREVIOUS MESSAGES for context, and a list of ENTITIES.
Return concise summaries that capture only what is stated or clearly implied in the messages."""

    user_prompt = f"""
<PREVIOUS_MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS_MESSAGES>

<CURRENT_MESSAGE>
{current_episode}
</CURRENT_MESSAGE>

<ENTITIES>
{entities}
</ENTITIES>

Task:
- Produce a short summary for EACH entity in ENTITIES.
- Each summary should be 1-2 sentences and focus on durable, identity-defining facts (roles, relationships, preferences).
- Do NOT hallucinate. If nothing meaningful is known beyond the name, say so briefly.

Output requirements:
- Return EXACTLY one summary per entity id in ENTITIES.
- Use the ids from ENTITIES.
"""

    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


def hydrate_entity_attributes(
    previous_episodes: list[str],
    current_episode: str,
    entities: list[dict[str, Any]],
    entity_type_schemas: dict[str, dict[str, str]] | None = None,
) -> list[Message]:
    """Extract and normalize entity attributes in a dedicated hydration pass."""
    sys_prompt = """You are an expert knowledge graph attribute extractor.
You will be given a CURRENT MESSAGE, optional PREVIOUS MESSAGES for context, and a list of ENTITIES.
Return conservative structured attributes for each entity, without hallucinating."""

    schema_context = ""
    if entity_type_schemas:
        schema_context = f"""
<ENTITY_TYPE_SCHEMAS>
{entity_type_schemas}
</ENTITY_TYPE_SCHEMAS>
"""

    user_prompt = f"""
<PREVIOUS_MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS_MESSAGES>

<CURRENT_MESSAGE>
{current_episode}
</CURRENT_MESSAGE>

<ENTITIES>
{entities}
</ENTITIES>

{schema_context}

Task:
- For EACH entity, extract durable, identity-defining attributes mentioned or clearly implied in the messages.
- Prefer stable attributes (roles, organizations, locations, preferences, IDs) over transient facts.
- Do NOT hallucinate. If nothing beyond the existing attributes is supported, return an empty dict for that entity.
- If ENTITY_TYPE_SCHEMAS is provided, only emit keys listed for the entity's type label(s).

Output requirements:
- Return EXACTLY one attributes object per entity id in ENTITIES.
- Use the ids from ENTITIES.
"""

    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


# Prompts for Edge Extraction
def extract_edges(
    episode_content: str,
    previous_episodes: list[str],
    nodes: list[dict[str, Any]],
    reference_time: str,
    custom_prompt: str = "",
    edge_types: list[str] | None = None,
    excluded_edge_types: list[str] | None = None,
) -> list[Message]:
    sys_prompt = """You are an expert fact extractor that extracts fact triples from text.
1. Extracted fact triples should also be extracted with relevant date information.
2. Treat the CURRENT TIME as the time the CURRENT MESSAGE was sent. All temporal information should be extracted relative to this time."""

    edge_type_context = ""
    if edge_types:
        edge_type_context = f"""
<FACT_TYPES>
Use one of these relation_type values when possible: {", ".join(edge_types)}.
If none fit, use DEFAULT.
</FACT_TYPES>
"""

    if excluded_edge_types:
        edge_type_context += f"""
<EXCLUDED_FACT_TYPES>
Do NOT use these relation_type values: {", ".join(excluded_edge_types)}
</EXCLUDED_FACT_TYPES>
"""

    user_prompt = f"""
<PREVIOUS_MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS_MESSAGES>

<CURRENT_MESSAGE>
{episode_content}
</CURRENT_MESSAGE>

<ENTITIES>
{nodes}
</ENTITIES>

{edge_type_context}

<REFERENCE_TIME>
{reference_time}  # ISO 8601 (UTC); used to resolve relative time mentions
</REFERENCE_TIME>

# TASK
Extract all factual relationships between the given ENTITIES based on the CURRENT MESSAGE.
Only extract facts that:
- involve two DISTINCT ENTITIES from the ENTITIES list,
- are clearly stated or unambiguously implied in the CURRENT MESSAGE,
- Facts should include entity names rather than pronouns whenever possible.

You may use information from the PREVIOUS MESSAGES only to disambiguate references or support continuity.

{custom_prompt}

# EXTRACTION RULES

1. **Entity ID Validation**: source_entity_id and target_entity_id must use only the id values from the ENTITIES list.
2. Each fact must involve two **distinct** entities.
3. Use a SCREAMING_SNAKE_CASE string as the relation_type. Choose specific, meaningful relationship types:

   **PREFERENCES & OPINIONS:**
   - LIKES, DISLIKES, PREFERS, LOVES, HATES
   - WANTS, NEEDS, INTERESTED_IN
   - FAVORITE_IS (e.g., "my favorite color is blue" → user FAVORITE_IS blue)

   **SOCIAL:**
   - KNOWS, FRIEND_OF, WORKS_WITH, COLLABORATES_WITH
   - REPORTS_TO, MENTORS, MANAGED_BY

   **ACTIONS & CREATION:**
   - CREATED, MAINTAINS, WORKS_ON, OWNS, USES
   - BUILT, DESIGNED, CONTRIBUTED_TO

   **ATTRIBUTES & SKILLS:**
   - HAS_PROPERTY, SKILLED_AT, EXPERT_IN
   - LOCATED_IN, MEMBER_OF, PART_OF

   Examples (User perspective):
   - "I like purple" → justin LIKES purple
   - "My favorite color is green" → justin FAVORITE_IS green
   - "I'm working on dere" → justin WORKS_ON dere
   - "You're neat" → justin LIKES tsun

   Examples (Bot perspective - when bot responds):
   - Bot says: "My favorite color is red" → {{personality}} FAVORITE_IS red
   - Bot says: "I like classical music" → {{personality}} LIKES classical_music
   - Bot says: "I prefer Python over JavaScript" → {{personality}} PREFERS Python

4. Do not emit duplicate or semantically redundant facts.
5. The fact should closely paraphrase the original source sentence(s).
6. Use REFERENCE_TIME to resolve vague or relative temporal expressions (e.g., "last week").
7. Do **not** hallucinate or infer temporal bounds from unrelated events.
8. Keep attributes conservative: only include fields that are explicitly stated or unambiguously implied.

# DATETIME RULES

- Use ISO 8601 with "Z" suffix (UTC) (e.g., 2025-04-30T00:00:00Z).
- If the fact is ongoing (present tense), set valid_at to REFERENCE_TIME.
- If a change/termination is expressed, set invalid_at to the relevant timestamp.
- Leave both fields null if no explicit or resolvable time is stated.
- If only a date is mentioned (no time), assume 00:00:00.
- If only a year is mentioned, use January 1st at 00:00:00.
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


# Prompts for Edge Dates
def extract_edge_dates(
    previous_episodes: list[str],
    current_episode: str,
    edge_fact: str,
    reference_timestamp: str,
) -> list[Message]:
    sys_prompt = """You are an AI assistant that extracts datetime information for graph edges, focusing only on dates directly related to the establishment or change of the relationship described in the edge fact."""

    user_prompt = f"""
<PREVIOUS MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS MESSAGES>

<CURRENT MESSAGE>
{current_episode}
</CURRENT MESSAGE>

<REFERENCE TIMESTAMP>
{reference_timestamp}
</REFERENCE TIMESTAMP>

<FACT>
{edge_fact}
</FACT>

IMPORTANT: Only extract time information if it is part of the provided fact.
If the relationship is not of spanning nature, but you are still able to determine the dates, set the valid_at only.

Definitions:
- valid_at: The date and time when the relationship described by the edge fact became true or was established.
- invalid_at: The date and time when the relationship described by the edge fact stopped being true or ended.

Task:
Analyze the conversation and determine if there are dates that are part of the edge fact.
Only set dates if they explicitly relate to the formation or alteration of the relationship itself.

Guidelines:
1. Use ISO 8601 format (YYYY-MM-DDTHH:MM:SS.SSSSSSZ) for datetimes.
2. Use the reference timestamp as the current time when determining dates.
3. If the fact is written in the present tense, use the Reference Timestamp for the valid_at date.
4. If no temporal information is found, leave the fields as null.
5. Do not infer dates from related events. Only use dates directly stated.
6. For relative time mentions, calculate the actual datetime based on the reference timestamp.
7. If only a date is mentioned without time, use 00:00:00 (midnight).
8. If only year is mentioned, use January 1st at 00:00:00.
9. Always include the time zone offset (use Z for UTC).
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


def extract_edge_dates_batch(
    previous_episodes: list[str],
    current_episode: str,
    edges: list[dict[str, Any]],
    reference_timestamp: str,
) -> list[Message]:
    """Extract datetime information for a list of edge facts."""
    sys_prompt = """You are an AI assistant that extracts datetime information for graph edges.
Focus only on dates directly related to the establishment or change of each relationship."""

    user_prompt = f"""
<PREVIOUS MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS MESSAGES>

<CURRENT MESSAGE>
{current_episode}
</CURRENT MESSAGE>

<REFERENCE TIMESTAMP>
{reference_timestamp}  # ISO 8601 (UTC); used to resolve relative time mentions
</REFERENCE TIMESTAMP>

<EDGES>
{edges}
</EDGES>

IMPORTANT:
- Only extract time information if it is part of the relationship described in the edge fact.
- Do NOT infer dates from related events. Only use dates directly stated or unambiguously implied.

Task:
- For EACH edge in EDGES, determine valid_at and invalid_at (or null).
- Use ISO 8601 format with Z suffix (UTC).
- If the fact is present tense and ongoing, set valid_at to REFERENCE TIMESTAMP.
- If no temporal information is found, leave fields null.

Output requirements:
- Return EXACTLY one entry per edge id in EDGES.
- Use the ids from EDGES.
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


# Prompts for Entity Deduplication
def dedupe_entities(
    extracted_nodes: list[dict[str, Any]],
    existing_nodes: list[dict[str, Any]],
    episode_content: str,
    previous_episodes: list[str],
) -> list[Message]:
    sys_prompt = """You are a helpful assistant that determines whether or not ENTITIES extracted from a conversation are duplicates of existing entities."""

    user_prompt = f"""
<PREVIOUS MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS MESSAGES>

<CURRENT MESSAGE>
{episode_content}
</CURRENT MESSAGE>

<ENTITIES>
{extracted_nodes}
</ENTITIES>

<EXISTING ENTITIES>
{existing_nodes}
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
ENTITIES contains {len(extracted_nodes)} entities with IDs 0 through {len(extracted_nodes) - 1}.
Your response MUST include EXACTLY {len(extracted_nodes)} resolutions with IDs 0 through {len(extracted_nodes) - 1}.

For every entity, return an object with:
- "id": integer id from ENTITIES
- "name": the best full name for the entity
- "duplicate_idx": the idx of the EXISTING ENTITY that is the best duplicate match, or -1 if no duplicate
- "duplicates": a sorted list of all idx values from EXISTING ENTITIES that are duplicates (empty list if none)

Only use idx values that appear in EXISTING ENTITIES.
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


# Prompts for Edge Deduplication
def dedupe_edges(
    new_edge: dict[str, Any],
    existing_edges: list[dict[str, Any]],
    edge_invalidation_candidates: list[dict[str, Any]],
) -> list[Message]:
    sys_prompt = """You are a helpful assistant that de-duplicates facts from fact lists and determines which existing facts are contradicted by the new fact."""

    user_prompt = f"""
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
{existing_edges}
</EXISTING FACTS>

<FACT INVALIDATION CANDIDATES>
{edge_invalidation_candidates}
</FACT INVALIDATION CANDIDATES>

<NEW FACT>
{new_edge}
</NEW FACT>
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


# Prompts for Community Summarization
def summarize_community(
    members: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[Message]:
    sys_prompt = """You are an expert at analyzing knowledge graphs and identifying common themes, relationships, and purposes within clusters of related entities."""

    user_prompt = f"""
<COMMUNITY MEMBERS>
{members}
</COMMUNITY MEMBERS>

<RELATIONSHIPS>
{edges}
</RELATIONSHIPS>

# TASK
Analyze the above entities and their relationships to create a concise summary of this community.

Your summary should:
1. Identify the main theme or purpose that connects these entities
2. Highlight key relationships and patterns
3. Be 2-4 sentences maximum
4. Be specific and informative

Focus on what makes this a cohesive community and what the entities have in common.
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]


def validate_extracted_entities(
    extracted_entities: list[dict[str, Any]],
    episode_content: str,
    previous_episodes: list[str],
) -> list[Message]:
    """Reflection prompt to validate and refine extracted entities.

    Multi-pass validation technique to:
    - Catch missed entities
    - Reduce hallucinations
    - Improve extraction coverage
    """
    sys_prompt = """You are an expert entity extraction validator. Your task is to review extracted entities and:
1. Identify any important entities that were missed
2. Flag any hallucinated entities that don't actually appear in the conversation
3. Suggest refinements to entity names or summaries for clarity

Be thorough but conservative - only suggest changes when clearly justified."""

    entities_str = "\n".join(
        [f"- {e['name']}: {e.get('summary', 'No summary')}" for e in extracted_entities]
    )

    user_prompt = f"""
<PREVIOUS MESSAGES>
{"\n".join(previous_episodes)}
</PREVIOUS MESSAGES>

<CURRENT MESSAGE>
{episode_content}
</CURRENT MESSAGE>

<EXTRACTED ENTITIES>
{entities_str}
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
- missed_entities: list of {{{{name, summary}}}} for missed entities
- hallucinated_entities: list of entity names that should be removed
- refinements: list of {{{{original_name, refined_name, refined_summary}}}} for improvements
"""
    return [
        Message(role="system", content=sys_prompt),
        Message(role="user", content=user_prompt),
    ]
