---
name: library-docs-fetcher
description: Query Context7 MCP for up-to-date library/framework documentation instead of web searching or guessing APIs. Triggers when encountering questions about library usage, API syntax, or framework features.
---

# Library Documentation Fetcher

## When to Use Context7

**Before WebSearch for library questions:**
- How to use a library API
- Framework-specific patterns
- Current version syntax
- Official code examples

**Libraries Context7 knows:**
- Frontend: React, Next.js, Vue, Angular, Svelte
- Backend: Express, FastAPI, Django, Rails
- Databases: MongoDB, PostgreSQL, Prisma
- Tools: Vite, Webpack, TypeScript, etc.

## Workflow

**1. Resolve Library ID**
```
mcp__context7__resolve-library-id(libraryName="react")
# Returns: /facebook/react
```

**2. Get Documentation**
```
mcp__context7__get-library-docs(
  context7CompatibleLibraryID="/facebook/react",
  topic="hooks",  # Optional: focus on specific topic
  tokens=5000     # Optional: control detail level
)
```

## Advantages Over WebSearch

- **Authoritative:** Official documentation, not blog posts
- **Current:** Up-to-date API references
- **Focused:** Topic-specific queries
- **Code examples:** Real usage patterns

## Remember

- Use for library/framework questions
- Falls back to WebSearch if library not available
- Can specify version: `/vercel/next.js/v14.3.0`
- Topic parameter focuses results (e.g., "routing", "authentication")
