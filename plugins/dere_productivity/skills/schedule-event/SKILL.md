---
name: schedule-event
description: Create calendar events from natural language requests. Use when user wants to schedule meetings, appointments, or time blocks.
---

# Schedule Event Skill

Create and manage calendar events through natural language interaction.

## When to Use

- User says "schedule a meeting" or "add to my calendar"
- Creating time blocks for focused work
- Setting up appointments or reminders
- Adding events from task estimates

## Workflow

1. **Gather event details**:
   - Title/summary
   - Date and time (parse natural language: "tomorrow 2pm", "next Monday 10am")
   - Duration (default 1 hour if not specified)
   - Description (optional)
   - Location (optional)
   - Attendees (optional, for meetings)

2. **Check for conflicts**: Use `list_events` to check existing calendar

3. **Create event**: Use `mcp__google-calendar__create_event`

4. **Confirm**: Show created event details with calendar link

## Natural Language Time Parsing

Support flexible time expressions:

- "tomorrow at 2pm"
- "next Monday 10am-11am"
- "Friday afternoon" (interpret as 2pm)
- "in 2 hours"
- "30 minutes from now"

## Example Usage

```
User: "Schedule a meeting with Sarah tomorrow at 2pm about the design review"

You:
1. Parse: tomorrow 2pm, 1h duration, title "Design review with Sarah"
2. Check conflicts: list_events(timeMin=tomorrow 2pm, timeMax=tomorrow 3pm)
3. If free: create_event({
     summary: "Design review with Sarah",
     start: "2024-11-19T14:00:00",
     end: "2024-11-19T15:00:00",
     description: "Design review discussion"
   })
4. Confirm: "Created 'Design review with Sarah' tomorrow 2-3pm"
```

## Time Blocking for Tasks

```
User: "Block time for the API refactoring task"

You:
1. Get task details: get_task_details(task_id)
2. Suggest time: "This task is estimated at 4 hours. When would you like to work on it?"
3. User: "Tomorrow morning"
4. Create 2-hour blocks: "Tomorrow 9-11am" and "Tomorrow 11am-1pm"
5. create_event for each block, linking to task in description
```

## MCP Tools

- `create_event` - Add new event to calendar
- `update_event` - Modify existing event
- `delete_event` - Remove event
- `list_events` - Check for conflicts

## Smart Defaults

- **Duration**: 1 hour for meetings, match task estimate for work blocks
- **Location**: Suggest "Remote" or last used location
- **Time**: Suggest next available slot during work hours
- **Description**: Include task ID and project for work blocks
