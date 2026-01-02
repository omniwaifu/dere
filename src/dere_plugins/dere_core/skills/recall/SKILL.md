---
name: recall
description: Queries entity timeline and conversation history. Use when user references past discussions, mentions known entities, or asks 'remember when'.
---

# Recalling Past Context

Query memory system to recall relevant past conversations and entity relationships.

## When to Use

- User says "like we talked about before"
- User mentions a person, project, or topic from history
- "Do you remember when..." questions
- Context from previous sessions would be helpful

## Workflow

**For entity mentions:**

1. Run `bun scripts/entity_search.ts <entity>` for timeline
2. Run `bun scripts/related_entities.ts <entity>` for connections
3. Integrate naturally into response

**For session history:**

1. Run `bun scripts/session_history.ts <session_id>`
2. Pull relevant context

## Integration Style

**Don't say:**

- "According to the database..."
- "The API shows..."

**Instead:**

- "Oh yeah, we were working on X a few weeks ago..."
- "Last time you mentioned them, you were dealing with..."
- "That reminds me of when you were..."

## Example

```bash
bun ./scripts/entity_search.ts "authentication"
# Returns sessions where authentication was discussed

bun ./scripts/related_entities.ts "authentication" 5
# Returns: JWT, OAuth, sessions, etc.
```

Focus on relevant memories, not dumping everything.
