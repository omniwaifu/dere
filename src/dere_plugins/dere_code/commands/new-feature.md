---
description: Plan a new feature with codebase analysis and critical review
allowed-tools: Task, TodoWrite, Read, mcp__plugin_dere-code_serena__read_memory, mcp__plugin_dere-code_serena__list_memories
argument-hint: <feature description>
---

# New Feature Planning

**Feature:** $ARGUMENTS

## Workflow

### 1. Delegate to feature-planner agent

```
Analyze codebase and create implementation plan for: $ARGUMENTS

1. Review architecture and patterns (check .serena/memories)
2. Identify code to modify and new files to create
3. Break into ordered implementation steps
4. Identify risks and dependencies
5. Suggest tech stack (query Context7 if needed)

Return: Overview, files to modify, new files, implementation steps, testing strategy, risks.
```

### 2. Delegate to cynical-reviewer agent

```
Review this plan critically:

[Insert plan from step 1]

Provide:
1. What could go wrong?
2. Edge cases not considered
3. Overengineered or underengineered?
4. Maintenance burden in 6 months
5. Simpler alternatives
6. Verdict: Green/Yellow/Red

Be harsh but fair.
```

### 3. Synthesize and create todos

1. Present both plan and critique to user
2. Create TodoWrite items:
   - Plan steps: `[Action] - [Details]`
   - Review concerns: `REVIEW: [Concern] - [Mitigation]`
3. Ask user: Proceed? Address concerns first? Refine plan?

## Notes

- Agents run sequentially (planner → reviewer)
- Cynical review always runs
- User decides after seeing both perspectives
