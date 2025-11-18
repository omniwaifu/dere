---
name: project-knowledge-base
description: Captures project-specific patterns, stack decisions, and footguns using Serena's memory system. Triggers when learning about THIS codebase's unique context.
---

# Project Knowledge Base

## What to Capture

**Stack Decisions** (mutually exclusive choices)
- Styling approach: tailwind vs css-in-js vs vanilla
- Data fetching: tRPC vs REST vs GraphQL
- ORM: Prisma vs raw SQL vs Drizzle
- State management: Zustand vs Redux vs Context

**Footguns** (edge cases that bit you)
- Library-specific bugs or gotchas
- Performance issues in your stack
- Configuration pitfalls
- Non-obvious constraints

**Patterns** (how THIS codebase does things)
- Auth flow implementation
- Error handling approach
- File structure conventions
- Testing patterns

**Decisions** (architectural choices made)
- Why X over Y
- Constraints driving choices
- Team agreements

## Format Rules

**One line per fact. No prose.**

Good:
```
write_memory('stack'): 'styling: tailwind only, no vanilla css/styled-components'
write_memory('stack'): 'api: tRPC in src/server/api, no REST endpoints'
write_memory('footgun-vllm'): 'rope_scaling breaks kv cache offloading'
write_memory('pattern-auth'): 'JWT middleware in src/auth/check.ts, 1hr expiry'
```

Bad:
```
write_memory('stack'): 'This project uses Tailwind CSS which is a utility-first...'
write_memory('decisions'): 'We decided to use tRPC because it provides...'
```

**Only explain if non-obvious:**
```
write_memory('footgun-prisma'): 'batch updates bypass row-level hooks, use updateMany carefully'
```

## Memory Categories

- `stack` - tech choices
- `footgun-{topic}` - edge cases
- `pattern-{topic}` - implementation patterns
- `decision-{topic}` - architectural decisions
- `antipattern-{topic}` - what NOT to do

## Remember

- Capture project-specific context, not general knowledge
- 1 line per fact, explanations only for non-obvious footguns
- Write when you learn, not when you feel like it
- Read memories at session start to avoid repeating mistakes
