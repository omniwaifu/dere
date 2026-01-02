---
name: focus
description: Find best task for current context, energy, and time available, then start focus session. Use when user asks "what should I work on" or wants to start working.
---

# Task Focus Session

Help user select and start the optimal task based on current context, energy, and time.

## Workflow

1. **Ask context**:
   - Where are you? (home, computer, errands)
   - How much time? (15m, 1h, 2h+)
   - Energy level? (high, medium, low)

2. **Query tasks**: Use `mcp__taskwarrior__get_next_actions` with filters

3. **Present options**: Show 3-5 tasks with why each is a good fit

4. **Start task**: Use `mcp__taskwarrior__start_task` to track time

## Energy Matching

- **High (H)**: Creative work, complex problems, writing, planning
- **Medium (M)**: Regular coding, meetings, moderate focus
- **Low (L)**: Admin, organizing, simple edits, email

## Example

```
User: "What should I work on? I'm at home, have 1 hour, feeling tired"

You:
1. Use get_next_actions(context="home", energy_level="L", time_available="1h")
2. Present: "Here are good low-energy tasks for home:
   - Organize project files (30min, low energy)
   - Review PR comments (45min, can do anywhere)
   - Update documentation (1h, straightforward)"
3. User picks one
4. start_task(task_id)
```

## MCP Tools

- `get_next_actions` - Query with context/energy/time filters
- `start_task` - Begin tracking active time
- `stop_task` - Pause or finish session
