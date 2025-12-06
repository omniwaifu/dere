---
name: project-knowledge-base
description: Capture project-specific patterns, stack decisions, and footguns using Serena memories. Triggers when learning codebase context.
---

# Project Knowledge Base

## What to Capture

- **Stack:** styling, data fetching, ORM, state management choices
- **Footguns:** library gotchas, performance issues, config pitfalls
- **Patterns:** auth flow, error handling, file structure, testing approach
- **Decisions:** why X over Y, constraints, team agreements

## Format

**One line per fact. No prose.**

```
write_memory('stack'): 'styling: tailwind only'
write_memory('stack'): 'api: tRPC in src/server/api'
write_memory('footgun-vllm'): 'rope_scaling breaks kv cache offloading'
write_memory('pattern-auth'): 'JWT middleware in src/auth/check.ts, 1hr expiry'
```

Only explain if non-obvious:
```
write_memory('footgun-prisma'): 'batch updates bypass row-level hooks, use updateMany carefully'
```

## Categories

`stack`, `footgun-X`, `pattern-X`, `decision-X`, `antipattern-X`

## Rules

- Project-specific only, not general knowledge
- 1 line per fact
- Write when you learn, not later
- Read memories at session start
