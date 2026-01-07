# Additional Files That Could Be Moved

After the initial refactoring, there are still ~40 files in the root. Here's what could be further organized:

## Files That Should Stay at Root (Core Infrastructure)
- `app.ts`, `index.ts` - Entry points
- `db.ts`, `db-types.ts`, `db-utils.ts` - Database core
- `logger.ts`, `events.ts`, `daemon-state.ts` - Core infrastructure
- `migrate.ts` - Migration script
- `*.test.ts` - Test files

## Potential Additional Namespaces

### 1. `agents/` (2 files)
- `agent.ts` - Agent management
- `agent-ws.ts` - Agent WebSocket handling

### 2. `memory/` or `recall/` (4 files)
- `core-memory.ts` - Core memory blocks
- `memory-consolidation.ts` - Memory consolidation
- `recall.ts` - Recall/search functionality
- `recall-embeddings.ts` - Embedding generation for recall

### 3. `context/` (3 files)
- `context.ts` - Context building
- `context-tracking.ts` - Context tracking
- `prompt-context.ts` - Prompt context building

### 4. `routes/` or `api/` (12 files)
These are all HTTP route handlers:
- `activity.ts`
- `dashboard.ts`
- `exploration.ts`
- `search.ts`
- `routing.ts`
- `queue.ts`
- `work-queue.ts`
- `notifications.ts`
- `presence.ts`
- `status.ts`
- `system.ts`
- `llm.ts`
- `taskwarrior.ts`

### 5. `personalities/` (2 files)
- `personalities.ts` - Personality management
- `personalities-api.ts` - Personality API routes

### 6. Other
- `engagement-kickoff.ts` - Could go in `ambient/` (it's ambient-related)
- `knowledge-graph.ts` - Could stay or go in `graph/`
- `metrics.ts` - Could stay (infrastructure)

## Recommendation

The most impactful moves would be:
1. **`memory/`** - Group memory/recall files (4 files)
2. **`agents/`** - Group agent files (2 files)  
3. **`personalities/`** - Group personality files (2 files)

The route files could stay at root since they're all individual route handlers, or be grouped into `routes/` if you want even more organization.

The `context/` files are a bit scattered - `prompt-context.ts` is used by missions, so it might make sense to keep it at root or move it to `missions/`.
