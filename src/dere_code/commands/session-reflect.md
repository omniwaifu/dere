---
description: Capture session knowledge to project memory
allowed-tools: mcp__plugin_workforce-assistant_serena__write_memory
---

Review this session for project-specific knowledge worth capturing.

## Review Trigger Events

**User Corrections:**
- Did user correct assumptions about stack/patterns?
- Example: "No we use tailwind" → `write_memory('stack'): 'styling: tailwind only'`

**Footguns Discovered:**
- Edge cases, bugs, or gotchas found?
- Example: vLLM rope_scaling issue → `write_memory('footgun-vllm'): 'rope_scaling breaks kv cache'`

**Patterns Implemented:**
- How did we implement X in THIS codebase?
- Example: Auth flow → `write_memory('pattern-auth'): 'JWT in src/auth/check.ts'`

**Architectural Decisions:**
- What choices were made and why?
- Example: Zustand over Redux → `write_memory('decision-state'): 'zustand (simplicity)'`

## Output Format

List each capturable item as:
```
write_memory('category-topic'): 'single line fact'
```

If nothing project-specific learned: say "No project-specific knowledge captured this session."

## Purpose

Session-end knowledge capture. Run before ending work.

See: project-knowledge-base and opportunistic-learning skills.
