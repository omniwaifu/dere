---
name: gtd-project-planning
description: Plan and troubleshoot projects using GTD methodology with next action verification and breakdown guidance. Use when defining new project or existing project is stalled.
---

# GTD Project Planning

Define projects properly and ensure they stay actionable using insights.

## Workflow

1. **Define outcome**: Ask user to clarify the successful outcome
2. **Check existing status**: Use `mcp__taskwarrior__get_project_status` if project exists
3. **Verify next action exists**:
   - Use `mcp__taskwarrior__get_next_actions` filtered by project
   - If no next actions, project will stall
4. **Break down if needed**:
   - If project feels overwhelming, ask about natural phases
   - Create next action for each phase or milestone
   - Ensure first next action is clear and doable
5. **Set context/energy**: Use insights to ensure actions are filterable
6. **Review dependencies**: Identify waiting/blocked items early

## Example

```
User: "I need to plan the website redesign project"

1. Clarify outcome:
   "What does 'done' look like? New design launched on production?"

2. Check status:
   get_project_status("website-redesign")
   - Shows: 0 next actions (RED FLAG)
   - Shows: Last activity 3 weeks ago

3. Break down:
   "Let's identify phases. Maybe:
    - Research competitor sites
    - Create wireframes
    - Get feedback
    - Implement design

   What's the very first action you could take today?"

4. Create actions:
   - "Review 3 competitor sites" (@computer, energy:L)
   - "Schedule feedback meeting with team" (@work, energy:M)

5. Result:
   Project now has 2 next actions, unblocked
```

## MCP Tools

- `get_project_status` - Check project health, activity
- `get_next_actions` - Verify actionable tasks exist
- `add_task` - Create new next actions
- `get_waiting_for` - Identify dependencies
