---
name: calendar-context
description: Query upcoming calendar events for context and scheduling. Use when user asks about their schedule, upcoming events, or availability.
---

# Calendar Context Skill

Query and display upcoming calendar events to provide context for planning and scheduling decisions.

## When to Use

- User asks "what's on my calendar" or "what's coming up"
- Planning tasks around existing commitments
- Checking availability for scheduling
- Getting context before suggesting work blocks

## Workflow

1. **Query calendar**: Use `mcp__google-calendar__list_events` to get upcoming events
   - Default: next 7 days
   - Can filter by time range, calendar ID

2. **Format and present**: Show events in readable format with:
   - Time (relative: "in 30min", "tomorrow 2pm")
   - Title
   - Duration (if relevant)
   - Location (if set)

3. **Extract insights**: Highlight relevant patterns:
   - Free blocks available
   - Busy periods to avoid
   - Conflicts or overlaps

## Example Usage

```
User: "What's on my calendar today?"

You:
1. list_events(timeMin=today, timeMax=tomorrow)
2. Present: "Today's schedule:
   - Now: Team standup (until 9:30am)
   - 11am-12pm: Design review with Sarah
   - 2pm-3pm: 1:1 with manager
   - 4pm-5pm: Sprint planning

   Free blocks: 9:30-11am (1.5h), 12-2pm (2h), 3-4pm (1h)"
```

## MCP Tools

- `list_events` - Get calendar events for time range
- `get_event` - Get detailed info for specific event
- `search_events` - Find events matching query

## Integration with Other Skills

- **focus-planning**: Check calendar before suggesting work blocks
- **schedule-planning**: Find gaps for new commitments
- **morning-plan**: Review day's schedule during planning
