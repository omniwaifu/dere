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

Use MCP tools directly - do NOT run shell scripts.

**For searching memories:**

```
mcp__plugin_dere-core_knowledge__recall_search(query: "zombie movies")
```

**For entity/fact search:**

```
mcp__plugin_dere-core_knowledge__search_knowledge(query: "zombie movies")
```

**For specific entity details:**

```
mcp__plugin_dere-core_knowledge__get_entity(name: "Justin")
```

**For timeline context:**

```
mcp__plugin_dere-core_knowledge__recall_context(around_date: "2025-12-15")
```

## Integration Style

**Don't say:**

- "According to the database..."
- "The API shows..."
- "The MCP tool returned..."

**Instead:**

- "Oh yeah, we were working on X a few weeks ago..."
- "Last time you mentioned them, you were dealing with..."
- "That reminds me of when you were..."

## Example

User: "Do you remember when we talked about zombie movies?"

1. Call `mcp__plugin_dere-core_knowledge__recall_search(query: "zombie movies")`
2. Integrate results naturally into response

Focus on relevant memories, not dumping everything.
