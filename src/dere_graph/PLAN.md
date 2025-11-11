# dere_graph Implementation Plan

Minimal Graphiti clone using Claude Agent SDK + Neo4j only. Steal all useful features, skip multi-provider bloat.

---

## Core Philosophy

- **One LLM**: Claude Agent SDK only (no OpenAI/Gemini/Groq)
- **One Database**: Neo4j only (no FalkorDB/Kuzu/Neptune)
- **One Embedder**: OpenAI embeddings (simplest integration)
- **No Telemetry**: Skip PostHog tracking
- **No Tracing**: Skip OpenTelemetry
- **All Features**: Communities, bulk ops, edge invalidation, hybrid search

---

## Day 1 MVP (8 hours)

### 1. Data Models (~1 hour)
**Steal from:** `graphiti_core/nodes.py`, `graphiti_core/edges.py`

```python
# Nodes
- EntityNode: name, summary, embedding, created_at, group_id
- EpisodeNode: content, valid_at, created_at, source, group_id
- CommunityNode: name, summary, created_at, group_id

# Edges
- RELATES_TO (entity → entity): fact, valid_at, invalid_at, embedding, episodes
- MENTIONS (episode → entity): created_at
- IN_COMMUNITY (entity → community): created_at
```

**Adapt:**
- Keep Pydantic BaseModel validation
- Skip custom entity/edge type system (for now)

**Files to create:**
- `dere_graph/models.py` (~300 LOC)

---

### 2. Neo4j Driver (~1 hour)
**Steal from:** `graphiti_core/driver/neo4j_driver.py`, `graphiti_core/driver/driver.py`

**Core operations:**
- Connection management
- Index creation (vector, fulltext, constraints)
- Cypher query execution
- Batch operations

**Adapt:**
- Remove driver abstraction (no need for multi-database)
- Use Neo4j 5.x vector indexes directly
- Simplify to single `Neo4jDriver` class

**Files to create:**
- `dere_graph/driver.py` (~400 LOC)

---

### 3. Claude Agent SDK Integration (~1.5 hours)
**Steal from:** `graphiti_core/llm_client/anthropic_client.py`, `graphiti_core/llm_client/client.py`

**Core pattern:**
- Create tool from Pydantic response model
- Force tool use via allowed_tools + prompting
- Extract validated data from ToolUseBlock
- Retry on validation errors

**Key differences:**
- Use `claude_agent_sdk.query()` instead of `anthropic.messages.create()`
- Create tools with `@tool` decorator + `model_json_schema()`
- Extract from `ToolUseBlock.input` instead of message.content

**Files to create:**
- `dere_graph/llm_client.py` (~350 LOC)

---

### 4. Extraction Prompts (~1.5 hours)
**Steal from:** `graphiti_core/prompts/`

**Extract these prompts:**
1. `extract_nodes.py` - Entity extraction with context
2. `extract_edges.py` - Relationship extraction
3. `extract_edge_dates.py` - Temporal information
4. `dedupe_nodes.py` - Entity deduplication
5. `dedupe_edges.py` - Relationship deduplication

**Adapt:**
- Convert Message protocol to simple dict format
- Keep prompt text and Pydantic response models
- Simplify to f-strings (skip versioning system)

**Files to create:**
- `dere_graph/prompts.py` (~600 LOC)

---

### 5. Ingestion Pipeline (~2 hours)
**Steal from:** `graphiti_core/utils/node_operations.py`, `graphiti_core/utils/edge_operations.py`

**Core flow:**
```python
1. Save episode to Neo4j
2. Extract entities (with previous episode context)
3. Deduplicate entities (embedding + LLM)
4. Extract relationships between entities
5. Deduplicate relationships
6. Extract temporal dates (valid_at, invalid_at)
7. Generate embeddings (batch)
8. Save to Neo4j with MENTIONS edges
```

**Adapt:**
- Replace semaphore_gather with asyncio.gather
- Use Claude SDK for all LLM calls
- Keep embedding similarity thresholds

**Files to create:**
- `dere_graph/operations.py` (~600 LOC)

---

### 6. Search (~2 hours)
**Steal from:** `graphiti_core/search/`, `graphiti_core/search_utils.py`

**Core components:**
- Vector similarity search (cosine distance)
- BM25 keyword search (Neo4j fulltext)
- Graph traversal (BFS from entities)
- RRF (Reciprocal Rank Fusion)

**Adapt:**
- Single search config (skip config classes)
- Keep RRF algorithm
- Keep MMR (Maximal Marginal Relevance) for diversity

**Files to create:**
- `dere_graph/search.py` (~700 LOC)

---

### 7. Main API (~30 min)
**Steal from:** `graphiti_core/graphiti.py`

**Core interface:**
```python
class DereGraph:
    async def add_episode(content, source, group_id)
    async def search(query, limit, filters)
    async def get_entity(name)
    async def get_timeline(entity_name, start, end)
```

**Files to create:**
- `dere_graph/graph.py` (~300 LOC)

---

## Day 2+ Advanced Features

### 8. Community Detection
**Steal from:** `graphiti_core/utils/community_operations.py`

**Algorithm:**
- Label propagation clustering
- Hierarchical communities
- Community summaries via LLM

**Files to create:**
- `dere_graph/communities.py` (~350 LOC)

---

### 9. Bulk Operations
**Steal from:** `graphiti_core/utils/bulk_utils.py`

**Features:**
- Batch episode ingestion
- Parallel processing
- Progress tracking

**Adapt:**
- Replace semaphore limits with TaskGroup
- Keep batching logic

**Files to create:**
- `dere_graph/bulk.py` (~400 LOC)

---

### 10. Edge Invalidation
**Steal from:** `graphiti_core/prompts/invalidate_edges.py`, edge invalidation logic

**Features:**
- Detect contradicting facts
- Set invalid_at timestamp
- Keep history for temporal queries

**Files to create:**
- `dere_graph/invalidation.py` (~250 LOC)

---

### 11. Embeddings
**Steal from:** `graphiti_core/embedder/openai.py`

**Keep simple:**
- OpenAI embeddings only
- Batch generation
- Caching

**Files to create:**
- `dere_graph/embeddings.py` (~150 LOC)

---

### 12. Utilities
**Steal from:** `graphiti_core/helpers.py`, `graphiti_core/utils/datetime_utils.py`

**Core utilities:**
- Datetime parsing/validation
- Text chunking
- JSON serialization helpers

**Files to create:**
- `dere_graph/utils.py` (~200 LOC)

---

## Components to Skip

### ❌ Don't Steal These
- `llm_client/openai_*.py` - We only use Claude SDK
- `llm_client/gemini_client.py` - We only use Claude SDK
- `llm_client/groq_client.py` - We only use Claude SDK
- `driver/falkordb_driver.py` - Neo4j only
- `driver/kuzu_driver.py` - Neo4j only
- `driver/neptune_driver.py` - Neo4j only
- `embedder/gemini.py` - OpenAI only
- `embedder/voyage.py` - OpenAI only
- `telemetry/` - Skip entirely
- `tracer.py` - Skip OpenTelemetry
- `migrations/` - New project, no migrations needed

---

## Total Estimated LOC

```
models.py           300 LOC
driver.py           400 LOC
llm_client.py       350 LOC
prompts.py          600 LOC
operations.py       600 LOC
search.py           700 LOC
graph.py            300 LOC
communities.py      350 LOC
bulk.py             400 LOC
invalidation.py     250 LOC
embeddings.py       150 LOC
utils.py            200 LOC

TOTAL:            4,600 LOC
```

**vs Graphiti:** 16,000 LOC (71% reduction)

---

## Implementation Order

### Priority 1: Core Loop (Day 1)
1. models.py
2. driver.py
3. llm_client.py
4. prompts.py (entity/edge extraction only)
5. operations.py (basic ingestion)
6. search.py (vector + BM25 only)
7. graph.py

**Deliverable:** Can ingest episodes and search

### Priority 2: Deduplication (Day 2)
1. Finish prompts.py (dedup prompts)
2. Add dedup logic to operations.py
3. Test entity/edge merging

**Deliverable:** Clean graph without duplicates

### Priority 3: Advanced Features (Day 3-4)
1. communities.py
2. bulk.py
3. invalidation.py
4. embeddings.py (batch optimization)

**Deliverable:** Full feature parity

### Priority 4: Polish (Day 5)
1. Error handling
2. Logging
3. Type hints
4. Documentation

**Deliverable:** Production-ready

---

## Key Adaptations for Claude Agent SDK

### Pattern: Structured Output via Tools

**Graphiti does:**
```python
# Standard Anthropic SDK
response = await client.messages.create(
    messages=messages,
    tools=[tool],
    tool_choice={'type': 'tool', 'name': tool_name}
)
return response.content[0].input
```

**We do:**
```python
# Claude Agent SDK
@tool(model_name, description, model.model_json_schema())
async def extraction_tool(args):
    return {"content": [{"type": "text", "text": "Received"}]}

server = create_sdk_mcp_server(tools=[extraction_tool])
options = ClaudeAgentOptions(
    mcp_servers={"extract": server},
    allowed_tools=[f"mcp__extract__{model_name}"]
)

prompt = format_messages(messages) + f"\n\nUse {model_name} tool."
async for msg in query(prompt=prompt, options=options):
    if isinstance(msg, AssistantMessage):
        for block in msg.content:
            if isinstance(block, ToolUseBlock):
                return block.input  # Already validated
```

### Pattern: Message Format Conversion

**Graphiti uses:**
```python
messages = [
    Message(role='user', content='...'),
    Message(role='assistant', content='...'),
]
```

**We convert to:**
```python
def format_messages(messages: list[Message]) -> str:
    parts = []
    for msg in messages:
        if msg.role == 'user':
            parts.append(f"User: {msg.content}")
        elif msg.role == 'assistant':
            parts.append(f"Assistant: {msg.content}")
    return '\n\n'.join(parts)
```

### Pattern: Retry on Validation Error

**Keep Graphiti's pattern:**
```python
max_retries = 2
for attempt in range(max_retries):
    try:
        result = await llm_call(...)
        validated = ResponseModel.model_validate(result)
        return validated
    except ValidationError as e:
        if attempt < max_retries - 1:
            error_msg = f"Invalid response. Error: {e}. Please retry."
            # Add to conversation and retry
        else:
            raise
```

---

## Dependencies

**Add to pyproject.toml:**
```toml
[project]
name = "dere-graph"
version = "0.1.0"
dependencies = [
    "pydantic>=2.11.5",
    "neo4j>=5.26.0",
    "claude-agent-sdk>=0.1.0",
    "openai>=1.0.0",  # For embeddings only
    "numpy>=1.0.0",
]
```

---

## Testing Strategy

**Steal test patterns from:** `tests/`

**Key tests:**
1. Entity extraction accuracy
2. Deduplication correctness
3. Search relevance
4. Temporal query accuracy
5. Community detection quality

**Use pytest + real Neo4j instance**

---

## Notes

- Graphiti's prompts are well-tuned - copy verbatim
- RRF fusion algorithm is solid - keep as-is
- Dedup thresholds (0.95 similarity) work well - don't change
- Community detection parameters are tuned - keep defaults
- Search weights are optimized - start with their values

---

## Questions to Answer During Build

1. Can Claude Agent SDK force tool choice? (If not, rely on prompting + allowed_tools)
2. What's the success rate of tool-based structured output vs standard SDK?
3. Does subscription auth work for agent SDK? (Or need API key?)
4. Performance: agent SDK overhead vs standard SDK?

---

## Success Metrics

**MVP is successful if:**
- Can ingest 100 episodes
- Entities extracted with >90% accuracy
- Dedup works (no obvious duplicates)
- Search returns relevant results
- Total time < 2 days

**Full build is successful if:**
- Feature parity with Graphiti
- <5000 LOC total
- Uses subscription (not API pay-per-token)
- Maintainable codebase

---

## Next Steps

1. Read through Graphiti source for each component
2. Copy Pydantic models first
3. Build Neo4j driver
4. Implement Claude SDK wrapper with tool pattern
5. Copy prompts verbatim
6. Wire up ingestion pipeline
7. Test with real data
8. Iterate
