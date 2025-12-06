---
name: opportunistic-learning
description: Auto-captures project knowledge when trigger events occur (corrections, bug fixes, decisions). Prevents forgetting to document discoveries.
---

# Opportunistic Learning

Trigger event → write_memory() immediately. No deliberation.

## Triggers

**User Correction:**
- "We use tailwind not vanilla CSS" → `write_memory('stack'): 'styling: tailwind only'`
- "Check src/auth/middleware.ts" → `write_memory('pattern-auth'): 'JWT middleware in src/auth/middleware.ts'`

**Bug Discovery:**
- vLLM rope_scaling breaks KV cache → `write_memory('footgun-vllm'): 'rope_scaling breaks kv cache offloading'`
- Prisma batch bypasses hooks → `write_memory('footgun-prisma'): 'updateMany bypasses row hooks'`

**Architecture Decision:**
- "Zustand for simplicity" → `write_memory('decision-state'): 'zustand, no redux (team decision)'`

**Pattern Discovery:**
- After exploring auth → `write_memory('pattern-auth'): 'JWT in middleware, 1hr expiry, refresh via /api/refresh'`

## Categories

`stack`, `footgun-X`, `pattern-X`, `decision-X`, `antipattern-X`

## Format

`write_memory('category-topic'): 'single line fact'`

## When NOT to Write

- General best practices (already in training)
- Obvious conventions
- Temporary decisions
- One-time fixes
