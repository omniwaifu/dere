---
name: task-breakdown-specialist
description: Break complex tasks into focused subtasks with dependencies. Triggers for large features or multi-file changes.
---

# Task Decomposition

## When to Decompose

- > 3 files affected
- Multiple dependencies
- > 10 tool calls expected

## Pattern

1. **Analyze dependencies:** What first? What parallel? What blocks?
2. **Create subtasks:** Clear input/output, testable, <10 tool calls each
3. **Execute in order:** Handle deps first, verify each step

## Example

**Bad:** "Add authentication to the app"

**Good:**

1. Find existing auth patterns (`find_symbol("auth")`)
2. Create user model/schema
3. Implement login endpoint
4. Add middleware for protected routes
5. Update frontend
6. Test flow

Smaller tasks = easier debugging. Clear deps = correct order.
