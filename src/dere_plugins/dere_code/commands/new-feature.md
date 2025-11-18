---
description: Plan a new feature with codebase analysis and critical review
allowed-tools: Task, TodoWrite, Read, mcp__plugin_workforce-assistant_serena__read_memory, mcp__plugin_workforce-assistant_serena__list_memories
argument-hint: <feature description>
---

# New Feature Planning Workflow

Plan and validate a new feature through multi-agent analysis and critical review.

## Feature Description

User wants: **$ARGUMENTS**

## Execution Workflow

Execute the following steps in sequence:

### 1. Feature Planning Phase

Delegate to the `feature-planner` agent with this prompt:

```
Analyze the codebase and create a detailed implementation plan for this feature:

Feature: $ARGUMENTS

Please:
1. Review relevant codebase architecture and patterns (check .serena/memories)
2. Identify existing code that needs modification
3. Determine new code/files to create
4. Break down into step-by-step implementation tasks
5. Identify risks, dependencies, and potential blockers
6. Suggest appropriate tech stack/libraries (query Context7 if needed)

Return a structured plan with:
- Feature overview and scope
- Files to modify (with specific changes)
- New files to create
- Implementation steps (ordered by dependency)
- Testing strategy
- Risk assessment
```

Wait for the feature-planner agent to complete and return its analysis.

### 2. Critical Review Phase

Take the plan from step 1 and delegate to the `cynical-reviewer` agent with this prompt:

```
Review this feature implementation plan with a critical eye:

[Insert the complete plan from feature-planner here]

As an experienced developer who's seen features go wrong, provide:
1. Critical assessment: What could go wrong?
2. Edge cases and failure scenarios not considered
3. Complexity analysis: Is this overengineered? Underengineered?
4. Maintenance burden: What pain will this cause in 6 months?
5. Alternatives: Is there a simpler way?
6. Verdict: Green light (good to go), Yellow flag (proceed with caution), or Red flag (needs rethinking)

Be harsh but fair. If something seems problematic, say so clearly.
```

Wait for the cynical-reviewer agent to complete and return its critique.

### 3. Synthesize and Create Todos

After receiving both the plan and the critique:

1. **Present both to the user:**
   - Show the feature plan from the planner agent
   - Show the critical review from the cynical agent
   - Highlight any major concerns (Red flags or Yellow flags)

2. **Create implementation todos** using TodoWrite:
   - Convert the approved plan into actionable todo items
   - Include reviewer concerns as separate warning/consideration items
   - Format: `[Action] - [Details]` for plan items
   - Format: `REVIEW: [Concern] - [Mitigation]` for critique items
   - Order by dependencies (what must happen first)

3. **Ask the user:**
   - "Do you want to proceed with implementation?"
   - "Should any concerns be addressed first?"
   - "Would you like to refine the plan based on the review?"

## Example Todo Structure

```
Pending todos:
- Review current authentication system architecture
- Implement OAuth2 provider configuration
- Add user session management
- Create login UI components
- Write integration tests for auth flow
- REVIEW: Session storage might leak memory - consider TTL strategy
- REVIEW: OAuth redirect vulnerable to CSRF - add state parameter
- Document authentication setup
```

## Important Notes

- Both agents run in sequence (planner first, then reviewer)
- The cynical review ALWAYS runs (no skipping)
- Reviewer has full context of the planner's output
- Final todos include BOTH plan steps AND review concerns
- User decides whether to proceed after seeing both perspectives
