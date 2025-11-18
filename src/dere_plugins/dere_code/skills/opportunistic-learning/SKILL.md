---
name: opportunistic-learning
description: Auto-captures project knowledge when trigger events occur (corrections, bug fixes, decisions). Prevents forgetting to document discoveries.
---

# Opportunistic Learning

## Trigger Events (Write Memory Immediately)

### 1. User Corrects You About Stack/Patterns

**User says:** "No, we use tailwind not vanilla CSS"
**You write:** `write_memory('stack'): 'styling: tailwind only, no vanilla css'`

**User says:** "We use tRPC for API, not REST"
**You write:** `write_memory('stack'): 'api: tRPC in src/server/api, no REST'`

**User says:** "Check src/auth/middleware.ts for the pattern"
**You write:** `write_memory('pattern-auth'): 'auth: JWT middleware in src/auth/middleware.ts'`

### 2. Weird Bug Discovered

**You find:** vLLM rope_scaling breaks KV cache offloading
**You write:** `write_memory('footgun-vllm'): 'rope_scaling breaks kv cache offloading'`

**You find:** Prisma batch updates bypass row-level hooks
**You write:** `write_memory('footgun-prisma'): 'updateMany bypasses row hooks, use carefully'`

**You find:** Tailwind purge removes unused classes
**You write:** `write_memory('footgun-tailwind'): 'purge requires safelist for dynamic classes'`

### 3. Architectural Decision Made

**Discussion:** "Should we use Zustand or Redux?"
**Decision:** "Zustand for simplicity"
**You write:** `write_memory('decision-state'): 'zustand for state mgmt, no redux (team decision 2025-11-02)'`

**Discussion:** "Raw SQL or Prisma?"
**Decision:** "Prisma with typed queries"
**You write:** `write_memory('decision-db'): 'prisma ORM, no raw SQL except perf-critical queries'`

### 4. Pattern Discovered Through Exploration

**After exploring auth code:**
`write_memory('pattern-auth'): 'JWT in middleware, 1hr expiry, refresh in /api/refresh'`

**After exploring error handling:**
`write_memory('pattern-errors'): 'Result<T,E> pattern in lib/, exceptions in routes only'`

## Don't Ask "Should I Document?" - Just Do It

**Bad:** "Hmm, should I write this down?"
**Good:** Detect trigger event → write immediately

**Bad:** "Let me think about whether this is important"
**Good:** User corrected me → write_memory()

## When NOT to Write

- General best practices (already in your training)
- Obvious stuff ("use semicolons in JS")
- Temporary decisions ("try this for now")
- One-time fixes that won't recur

## Format Reminder

```
write_memory('category-topic'): 'single line fact, explain only if non-obvious'
```

Categories: stack, footgun-X, pattern-X, decision-X, antipattern-X

## Remember

- Trigger events = write immediately
- Don't wait for permission
- 1 line per fact
- Project-specific only
