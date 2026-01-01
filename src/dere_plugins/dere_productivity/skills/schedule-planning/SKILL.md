---
name: schedule-planning
description: Interactive time blocking and schedule optimization. Finds optimal calendar slots for tasks based on estimates, priorities, and existing commitments. Use when user wants to plan their week or schedule specific tasks.
---

# Schedule Planning Skill

Help user create an optimized schedule by finding ideal time blocks for tasks and commitments.

## When to Use

- User says "help me plan my week"
- "When should I work on this task?"
- "Block time for these tasks"
- Weekly planning sessions
- Scheduling around existing commitments

## Orchestration Flow

Coordinates tasks, calendar, and activity patterns for optimal scheduling.

### Workflow

**1. Identify Tasks to Schedule**

```
Options:
a) User specifies: "Schedule the API refactoring task"
b) High-priority tasks: get_tasks(status="pending", priority="H")
c) Due soon: get_tasks(due_before="+7days")
d) All unscheduled tasks with time estimates
```

**2. Get Task Details**

For each task:

```
- Title
- Estimated duration
- Energy level required (H/M/L)
- Dependencies (must come after other tasks)
- Due date (hard deadline)
- Preferred context (office/home/either)
```

**3. Query Calendar for Availability**

```
calendar = list_events(timeMin=now, timeMax=+7days)

Identify:
- Free blocks (no events)
- Duration of each block
- Time of day for each block
- Context (location if specified in events)
```

**4. Find Optimal Slots**

Match tasks to slots based on:

- **Time fit**: Block long enough for task + buffer
- **Energy match**: High-energy tasks → morning blocks (if that's user's pattern)
- **Context match**: Home tasks → blocks at home
- **Dependencies**: Task B after Task A
- **Due date**: Work backwards from deadline
- **Pattern fit**: Historical productivity data

**5. Present Proposed Schedule**

Show visual weekly plan:

```
"Proposed Schedule:

Monday:
  9:00-11:30am: API refactoring (2.5h) [deep work]
  11:30am-12pm: Team standup [existing]
  1:00-3:00pm: Documentation updates (1.5h) [writing]
  3:00-4:00pm: 1:1 with manager [existing]

Tuesday:
  9:00-12:00pm: Testing framework (3h) [deep work]
  2:00-3:30pm: Review PRs (1h) [medium energy]

...

Free blocks remaining:
- Tuesday 3:30-5pm (1.5h)
- Thursday morning (3h) - PROTECTED FOR DEEP WORK
- Friday afternoon (2h)
```

**6. Create Calendar Blocks**

After user approval:

```
for task in approved_tasks:
    create_event({
        summary: f"[Work] {task.title}",
        start: allocated_time.start,
        end: allocated_time.end,
        description: f"Task: {task.id}\nEstimate: {task.estimate}",
        colorId: "9"  # Work time color
    })
```

## Smart Scheduling Logic

### Energy-Based Placement

```python
# Map task energy to optimal times based on user patterns
energy_schedule = {
    "high": ["9-11am", "10-12pm"],      # Peak cognitive hours
    "medium": ["2-4pm", "7-9pm"],       # Moderate focus
    "low": ["11am-12pm", "4-5pm"]       # Lower energy periods
}

# Place high-energy tasks in high-energy blocks
if task.energy == "high" and block.time in energy_schedule["high"]:
    score += 10
```

### Buffer Time

```python
# Add buffer between blocks
actual_block_size = task.estimate * 1.2  # 20% buffer
# Prevents back-to-back scheduling fatigue
```

### Protected Time

```python
# Reserve prime focus time for most important work
protected_blocks = ["Mon 9-12", "Thu 9-12"]  # User-configured

# Don't schedule meetings here, only deep work
if block in protected_blocks and task.type == "deep_work":
    score += 20
```

### Dependency Ordering

```python
# Ensure tasks happen in order
if task.depends_on:
    dependency_task = get_task(task.depends_on)
    ensure_scheduled_before(dependency_task, task)
```

## Example Interaction

```
User: "Help me schedule my tasks for this week"

You:
[1. Get tasks]
pending_tasks = get_tasks(status="pending", has_estimate=True)
→ 8 tasks, total 18 hours estimated

[2. Get calendar]
calendar = list_events(timeMin=this_week_start, timeMax=this_week_end)
→ 12 existing meetings, 23 hours free time

[3. Analyze]
"You have 8 tasks (18h estimated work) and 23h of free time this week.
 Meetings are clustered Mon/Wed afternoons.
 Best deep work windows: Tue/Thu mornings (6h available).

 I recommend:
 - Schedule 2 large tasks in Tue/Thu morning blocks
 - Fill Mon/Wed mornings with smaller tasks
 - Use afternoon gaps for admin/reviews
 - Keep Friday afternoon flexible"

[4. Propose specific schedule]
"Proposed allocation:

Priority Deep Work (Morning blocks):
- Tuesday 9-12: API refactoring (3h est)
- Thursday 9-11: Database optimization (2h est)

Medium Tasks (Mon/Wed mornings):
- Monday 9-11: Documentation (1.5h est)
- Wednesday 9-10:30: Testing (1h est)

Quick Wins (Afternoon gaps):
- Monday 2-3pm: Code review (45min est)
- Wednesday 4-5pm: Bug fixes (1h est)

Flexible/Buffer:
- Friday afternoon: Catch-up or new work

Should I create these calendar blocks?"
```

## Interactive Adjustment

```
User: "Actually, I prefer to code in the evenings"

You:
[Adjust energy patterns]
Updated schedule:
- Move deep work → evening slots
- Use mornings → planning, meetings, reviews
- Evenings 7-9pm → coding tasks

"Revised:
- Monday 7-9pm: API refactoring
- Tuesday 7-9pm: Database optimization
- Mornings freed for async work and meetings"
```

## Integration Points

### With `focus-planning`:

- Current moment: "what to work on now?"
- Schedule planning: "when to work on everything?"
- Feed into each other

### With `activity-summary`:

- Learn actual productivity patterns
- "You historically code best 9-11am, scheduling deep work then"

### With existing `plan` skill:

- `plan` = decide what to do
- `schedule-planning` = decide when to do it
- Use together for comprehensive planning

## Calendar Event Format

```
Title: "[Work] Task Title"
Description:
  Task ID: 123
  Project: dere
  Estimate: 2h
  Energy: High

  Context: Deep work block

Start: 2024-11-19T09:00:00
End: 2024-11-19T11:00:00
Color: Blue (work blocks)
Reminders: 10min before
```

## Advanced Features

### Weekly Optimization

```
Optimize week based on:
1. Minimize context switches
2. Group similar tasks
3. Respect energy curves
4. Protect deep work time
5. Leave buffers for unexpected
```

### Rescheduling

```
User: "The API task is taking longer, reschedule the rest"

You:
1. Get current task progress
2. Update remaining estimate
3. Find new slot
4. Shift dependent tasks
5. Update calendar blocks
```

### Recurring Blocks

```
User: "Block every Tuesday morning for deep work"

You:
create_recurring_event({
    summary: "[Protected] Deep Work",
    recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TU",
    start_time: "09:00",
    duration: 3h
})
```

This is time-blocking automation - take task list, calendar constraints, and generate optimal schedule.
