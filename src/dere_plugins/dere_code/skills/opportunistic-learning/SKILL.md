---
name: opportunistic-learning
description: Auto-captures project knowledge when trigger events occur (corrections, bug fixes, decisions). Prevents forgetting to document discoveries.
---

# Opportunistic Learning

Trigger event → evaluate → write_memory() OR suggest rule

## Decision: Memory or Rule?

**Write memory immediately:**

- Bug/footgun discovered during work
- Pattern found exploring code
- Decision made with user rationale
- Session-specific learning

**Suggest rule to user (don't auto-create):**

- User states a permanent convention
- Static coding standard mentioned
- "We always do X" / "Never do Y" statements

## Triggers → Memory

**Bug Discovery:**

```
write_memory('footgun-vllm'): 'rope_scaling breaks kv cache offloading'
write_memory('footgun-prisma'): 'updateMany bypasses row hooks'
```

**Pattern Discovery:**

```
write_memory('pattern-auth'): 'JWT in middleware, 1hr expiry, refresh via /api/refresh'
```

**Architecture Decision:**

```
write_memory('decision-state'): 'zustand, no redux (team decision)'
```

## Triggers → Suggest Rule

**User states convention:**

- "We use tailwind not vanilla CSS"
  → Suggest: "Consider adding to `.claude/rules/styling.md`: 'Use Tailwind only'"

**Permanent antipattern:**

- "Never use any in TypeScript here"
  → Suggest: "Consider adding to `.claude/rules/typescript.md`"

**Build/test command:**

- "Always run just lint before committing"
  → Suggest: "Consider adding to `.claude/rules/commands.md`"

## Categories

`stack`, `footgun-X`, `pattern-X`, `decision-X`, `antipattern-X`

## Format

`write_memory('category-topic'): 'single line fact'`

## When NOT to Write

- General best practices (already in training)
- Obvious conventions (already in rules)
- Temporary decisions
- One-time fixes

## When NOT to Suggest Rules

- Bug discoveries (too specific, use memory)
- Session-specific context
- Evolving understanding
