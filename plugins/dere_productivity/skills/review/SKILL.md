---
name: review
description: Guide through GTD weekly review process with project health checks, habit tracking, and stalled work identification. Use when user wants to do weekly review or feels stuck/overwhelmed.
---

# GTD Weekly Review

Systematic weekly review using GTD methodology with insights and recommendations.

## Workflow

1. **Get review data**: Use `mcp__taskwarrior__weekly_review`
2. **Process inbox**: If count > 0, suggest processing first
3. **Celebrate wins**: Review completed tasks from week
4. **Review projects**:
   - Use insights to identify stalled projects
   - Ask about projects with no recent activity
   - Ensure each active project has clear next action
5. **Review waiting for**: Use `mcp__taskwarrior__get_waiting_for`
   - Identify items needing follow-up
6. **Review someday/maybe**: Use `mcp__taskwarrior__get_someday_maybe`
   - Ask if anything ready to promote to active
7. **Review habits**: Use `mcp__taskwarrior__get_recurring_tasks`
   - Note broken streaks, discuss if habit needs adjustment
8. **Generate summary**: Recap wins, stalled areas, recommendations

## Example

```
1. weekly_review shows:
   - 15 completed tasks (celebrate!)
   - 2 stalled projects (no activity in 14+ days)
   - 3 waiting items (one overdue for follow-up)
   - Inbox: 0 (good)

2. Discuss stalled projects:
   "Project 'website-redesign' hasn't had activity in 3 weeks.
    What's blocking it? Should we break it down or pause it?"

3. Check waiting items:
   "You've been waiting on Bob's feedback for 10 days.
    Time to follow up?"

4. Summary:
   "Strong week - 15 tasks done. Two areas need attention:
    website redesign (stalled) and Bob follow-up (overdue)."
```

## MCP Tools

- `weekly_review` - Primary review data with insights
- `get_project_status` - Individual project health
- `get_waiting_for` - Delegated/blocked items
- `get_someday_maybe` - Aspirational tasks
- `get_recurring_tasks` - Habit completion stats
