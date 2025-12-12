---
description: Creates a handoff plan for continuing work in a new session
allowed-tools: Write, Read
argument-hint: <purpose>
---

# Session Handoff

**Purpose:** $ARGUMENTS

**STOP if no purpose provided.** Ask user for the purpose before continuing.

## Output Sections

1. **Primary Request:** User's explicit requests and intents
2. **Key Concepts:** Technologies, frameworks, patterns discussed
3. **Files Changed:** For each file: why important, changes made, code snippets
4. **Problems Solved:** Issues resolved and ongoing troubleshooting
5. **Pending Tasks:** Explicit remaining work
6. **Current Work:** Exactly what was being worked on (files, code)
7. **Next Step:** Only if directly aligned with user's explicit request

## Process

1. Analyze conversation chronologically
2. Extract technical details: file names, code snippets, function signatures
3. Focus on most recent messages for current work
4. Create slug (e.g., `implement-auth`, `fix-issue-42`)

## Output Format

```markdown
# [Readable Summary]

## 1. Primary Request
[Detailed user requests]

## 2. Key Concepts
- [Concept 1]
- [Concept 2]

## 3. Files
### [filename]
- **Why:** [importance]
- **Changes:** [what changed]
- **Code:** [snippet]

## 4. Problems Solved
[Issues and status]

## 5. Pending
[Remaining tasks]

## 6. Current Work
[Exactly what was in progress]

## 7. Next Step
[Only if aligned with explicit request]
```

## Final Step

Write to `.claude/handoffs/[YYYY-MM-DD]-[slug].md`

Tell user: Use `/pickup [filename]` to continue.
