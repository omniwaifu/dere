---
name: project-knowledge-base
description: Capture project-specific patterns, stack decisions, and footguns using Serena memories. Triggers when learning codebase context.
---

# Project Knowledge Base

## Rules vs Memories

This project has two knowledge systems. Use the right one:

| Static (Rules)      | Dynamic (Serena)              |
| ------------------- | ----------------------------- |
| Coding standards    | Discovered footguns           |
| File conventions    | Patterns found exploring      |
| Build/test commands | Decisions made with rationale |
| "Never do X" rules  | Bug fixes and learnings       |

### Decision Tree

```
Is it static/permanent?
├─ YES → Suggest adding to .claude/rules/
│        (User creates rule, not Claude)
└─ NO  → write_memory() immediately
         Categories: stack, footgun-X, pattern-X, decision-X
```

### When to Suggest Rules

User says:

- "We always..." / "Never..."
- "Everyone should know..."
- "Add to project standards"

→ Suggest: "Consider adding to `.claude/rules/code-style.md`"

### When to Write Memories

You discover:

- Bug/footgun while working
- Pattern while exploring code
- Decision rationale with user

→ Write immediately: `write_memory('footgun-X'): 'one line fact'`

## Serena Memory Categories

- **stack**: technology choices discovered
- **footgun-X**: gotchas, bugs, pitfalls learned
- **pattern-X**: code patterns observed
- **decision-X**: rationale for choices made
- **antipattern-X**: things to avoid (session-discovered)

## Format

**One line per fact. No prose.**

```
write_memory('stack'): 'styling: tailwind only'
write_memory('footgun-vllm'): 'rope_scaling breaks kv cache offloading'
write_memory('pattern-auth'): 'JWT middleware in src/auth/check.ts, 1hr expiry'
```

Only explain if non-obvious:

```
write_memory('footgun-prisma'): 'batch updates bypass row-level hooks, use updateMany carefully'
```

## DO NOT Write Memories For

- Static conventions (suggest adding to `.claude/rules/`)
- Build commands (should be in rules or README)
- Code style (should be in rules)
- General knowledge (not project-specific)

## Rules

- Project-specific only
- 1 line per fact
- Write when you learn, not later
- Read memories at session start
