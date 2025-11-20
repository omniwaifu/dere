---
name: activity-summary
description: Analyze ActivityWatch data to provide productivity insights, time tracking, and pattern analysis. Use when user asks about time spent, productivity patterns, or daily summaries.
---

# Activity Summary Skill

Query and analyze ActivityWatch time tracking data to provide insights into actual work patterns and productivity.

## When to Use

- User asks "how did I spend my time today"
- Generating daily/weekly productivity reports
- Comparing planned vs actual time on tasks
- Identifying productivity patterns and distractions
- Accountability check during evening review

## Workflow

1. **Query ActivityWatch**: Use `dere_shared.activitywatch` functions:
   - `get_activity_context()` - Current/recent activity
   - Could extend with time-range queries for historical data

2. **Analyze patterns**:
   - Time distribution by application/project
   - Focus vs distraction time
   - Most productive hours
   - Context switching frequency

3. **Present insights**: Format as human-readable summary:
   - Total productive time
   - Breakdown by project/task
   - Notable patterns (e.g., "Most focused: 9-11am")
   - Distractions or time sinks

4. **Compare with plans**: Cross-reference with:
   - Taskwarrior completed tasks
   - Calendar time blocks
   - Intended vs actual work

## Example Usage

```
User: "How did I spend my time today?"

You:
1. Query ActivityWatch for today's data
2. Analyze and format:
   "Today's Activity Summary:

   Total Screen Time: 7h 23m

   By Application:
   - VS Code: 4h 12m (56%)
   - Chrome: 2h 8m (29%)
   - Slack: 47m (11%)
   - Other: 16m (4%)

   By Project (based on window titles):
   - dere codebase: 3h 45m
   - Documentation: 1h 20m
   - Email/communication: 52m

   Productivity Patterns:
   - Most focused: 9-11:30am (deep work on dere)
   - Afternoon lull: 2-3pm (mostly Slack)
   - Evening focus: 7-9pm (documentation)

   Context switches: 47 (about every 9 minutes)"
```

## Daily Summary Report

```
User: "Give me my daily summary"

You:
1. Get ActivityWatch data
2. Get completed tasks from Taskwarrior
3. Get calendar events
4. Compare and present:
   "Daily Summary for Nov 18, 2024:

   Planned vs Actual:
   - Scheduled: 6h (3 calendar time blocks)
   - Actually worked: 7h 23m
   - Variance: +1h 23m

   Completed Tasks:
   ✓ Implement calendar integration (est: 4h, actual: ~4h 15m)
   ✓ Fix header parsing bug (est: 1h, actual: ~45m)
   ✓ Team standup (30m)

   Focus Quality:
   - Deep work time: 5h 12m (70% of work time)
   - Communication: 1h 40m
   - Context switches: 47 (frequent)

   Recommendation: Try longer focus blocks tomorrow"
```

## Weekly Patterns

```
User: "Show me my productivity patterns this week"

You:
1. Aggregate ActivityWatch data for week
2. Identify patterns:
   "Weekly Productivity Analysis:

   Most Productive Days:
   1. Tuesday: 8h 45m (85% deep work)
   2. Thursday: 7h 30m (70% deep work)
   3. Monday: 6h 20m (interrupted by meetings)

   Most Productive Hours:
   - Morning (9-12): Avg 92% focus
   - Afternoon (1-4): Avg 65% focus
   - Evening (7-9): Avg 78% focus

   Distraction Patterns:
   - Peak distractions: 2-3pm daily
   - Main time sinks: Slack, Twitter
   - Avg context switch interval: 8-12 minutes

   Suggestions:
   - Schedule deep work 9-12am
   - Block Slack 9-11am
   - Use afternoon for meetings/comms"
```

## Integration with Other Skills

- **evening-review**: Provide actual time data for reflection
- **morning-plan**: Show yesterday's patterns to inform today
- **focus-planning**: Suggest optimal times based on historical productivity

## Data Sources

1. **ActivityWatch**:
   - Window titles (application + document)
   - Active time vs idle time
   - Application categories
   - Timestamps for all activity

2. **Enrichment** (future):
   - Git commits (correlate with coding time)
   - Task time tracking (compare estimates vs actual)
   - Calendar (meeting time vs focus time)

## Privacy Note

All ActivityWatch data stays local. Never send full activity logs to external services. Only use aggregated summaries.
