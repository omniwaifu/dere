---
name: task-breakdown-specialist
description: Break complex multi-step tasks into focused subtasks with clear dependencies. Triggers when handling large features, complex refactorings, or multi-file changes.
---

# Task Breakdown Specialist

## When to Decompose Tasks

- Implementing features touching >3 files
- Refactorings with multiple dependencies
- Complex workflows requiring specific order
- Tasks that will take >10 tool calls

## Decomposition Pattern

**1. Analyze Dependencies**
```
# What needs to happen first?
# What can run in parallel?
# What blocks other steps?
```

**2. Create Focused Subtasks**
```
# Each subtask should:
# - Have clear input/output
# - Be testable independently
# - Take <10 tool calls
```

**3. Execute in Order**
```
# Handle dependencies first
# Verify each subtask before next
# Document progress
```

## Example: Adding Authentication

**Bad (monolithic):**
"Add authentication to the app"

**Good (decomposed):**
1. Find existing auth patterns (`find_symbol("auth")`)
2. Create user model/schema
3. Implement login endpoint
4. Add middleware for protected routes
5. Update frontend to use auth
6. Test authentication flow

## Remember

- Smaller tasks = easier debugging
- Clear dependencies = correct order
- Verification between steps = catch errors early
