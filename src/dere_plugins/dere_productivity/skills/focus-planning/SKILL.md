---
name: focus-planning
description: Intelligent task selection combining tasks, calendar, activity patterns, and current context. Use when user asks "what should I work on now" with comprehensive context awareness.
---

# Focus Planning Skill (Orchestration)

Enhanced version of the `focus` skill that considers calendar, activity patterns, and environmental context to suggest optimal work.

## When to Use

- User asks "what should I work on now"
- Starting a work session and needs guidance
- Has multiple tasks and wants smart prioritization
- Wants AI to consider full context (not just task priority)

## Orchestration Flow

This skill coordinates multiple data sources:

1. **Task context** (Taskwarrior MCP)
2. **Calendar context** (Google Calendar MCP)
3. **Activity patterns** (ActivityWatch historical data)
4. **Time/energy context** (from core context)

### Step-by-Step Workflow

**1. Gather Current Context**

```
- Current time and day of week
- Energy level (ask user: high/medium/low)
- Location (ask user: home/office/mobile)
- Time available (ask user OR infer from next calendar event)
```

**2. Query Calendar for Constraints**

```
calendar_events = list_events(timeMin=now, timeMax=end_of_day)

- Next commitment time (hard deadline)
- Free blocks available
- Meeting-heavy vs focus-heavy day
```

**3. Query Tasks with Context Filters**

```
tasks = get_next_actions(
    context=user_location,
    limit=10
)

Filter by:
- Can be done in available time
- Matches energy level
- Due soon or high priority
- Project alignment
```

**4. Analyze Activity Patterns** (optional enhancement)

```
activity_data = get_activity_context()

Historical insights:
- Most productive time of day for this type of work
- Average context switch frequency
- Typical focus session duration
- Common distractions at this time
```

**5. Score and Rank Options**

Consider multiple factors:
- **Urgency**: Due date, dependencies
- **Energy match**: Task complexity vs current energy
- **Time fit**: Will it finish before next meeting?
- **Momentum**: Related to recent work?
- **Pattern match**: Historically productive at this time for this work?

**6. Present Recommendations**

Show top 3-5 tasks with reasoning:

```
"Based on your context (2 hours until next meeting, medium energy, at home):

1. **Implement calendar integration** (Priority)
   - Time: ~2h (perfect fit)
   - Energy: Medium complexity
   - Why now: Due tomorrow, you're most productive on coding 10am-12pm
   - Related: Continues yesterday's backend work

2. **Review PR comments** (Good fallback)
   - Time: 30-45min
   - Energy: Low-medium
   - Why now: Can finish well before meeting
   - Momentum: You often review PRs in morning

3. **Update documentation** (Alternative)
   - Time: 1-1.5h
   - Energy: Low
   - Why now: No dependencies, flexible timing
   - Pattern: You write docs well in mornings

Not recommended now:
- API refactoring (4h est, not enough time)
- Team sync prep (wait until closer to meeting)
```

**7. Start Focus Session**

After user selects:
```
- start_task(task_id)
- Optionally: create_calendar_event for time blocking
- Set timer/reminder for next commitment
- Suggest: "Focus mode: disable Slack until 11:30am?"
```

## Smart Filtering Logic

### Time-Based Filtering

```python
available_time = time_until_next_commitment()

if available_time < 30min:
    suggest_quick_wins()  # Admin tasks, reviews
elif available_time < 2h:
    suggest_medium_tasks()  # Discrete chunks
else:
    suggest_deep_work()  # Complex, high-value tasks
```

### Energy-Based Filtering

```python
energy_map = {
    "high": ["creative", "complex", "planning", "writing"],
    "medium": ["coding", "debugging", "meetings", "reviews"],
    "low": ["admin", "organizing", "email", "simple_edits"]
}

filter_tasks_by_tags(energy_map[user_energy])
```

### Pattern-Based Boosting

```python
# If ActivityWatch shows high productivity for coding at this time
if is_historically_productive(task_type="coding", time=current_time):
    boost_score(coding_tasks, multiplier=1.5)

# If calendar shows meeting-heavy afternoon ahead
if upcoming_meetings > 2:
    prioritize_deep_work_now()  # Get it done before interruptions
```

## Example Interaction

```
User: "What should I work on? I'm tired and have meetings soon"

You:
[1. Query calendar]
calendar = list_events(timeMin=now, timeMax=today_end)
→ Next meeting: 2pm (1 hour from now)
→ Then: 3pm, 4pm (meeting-heavy afternoon)

[2. Assess energy and time]
energy = "low" (user said tired)
time_available = 1 hour
recommendation = "quick wins before meetings"

[3. Query tasks]
tasks = get_next_actions(context="computer", limit=10)

[4. Filter and rank]
suitable = [
    t for t in tasks
    if t.estimate <= 60min
    and t.energy_level == "low"
]

[5. Present]
"You have 1 hour before your 2pm meeting, and you're low energy. Here are good quick wins:

1. **Organize project notes** (30min, low energy)
   - Perfect for current state
   - Clears mental clutter before meetings

2. **Review and merge simple PR** (45min, low effort)
   - Can finish before meeting
   - Feels productive

3. **Prep for 2pm meeting** (20min)
   - Timely, reduces stress

Not recommended:
- Deep coding work (you're tired, meetings coming)
- New feature (needs 2+ hours uninterrupted)

Pick one and I'll start tracking?"
```

## Integration Points

### With `calendar-context` skill:
- Pull upcoming events
- Identify free blocks
- Calculate available time

### With `activity-summary` skill:
- Historical productivity patterns
- Best times for different work types
- Typical focus session length

### With `focus` skill (base):
- Enhanced version that adds calendar + activity intelligence
- Falls back to simple focus if data unavailable

### With `schedule-planning` skill:
- If no good tasks for now, suggest scheduling future blocks
- "You don't have time for deep work now, want to block tomorrow morning?"

## Configuration

Optional user preferences:
```toml
[productivity.focus_planning]
work_hours_start = 9
work_hours_end = 17
default_focus_duration = 90  # minutes
context_switch_penalty = 0.8  # reduce score for context switches
energy_weight = 1.5  # how much to weight energy matching
```

## Advanced Features

### Proactive Suggestions

If enabled, could proactively suggest during context injection:
```
[Productivity Context]
Tasks: 5 pending, 2 due today
Calendar: Free until 2pm (3 hours)
Suggestion: Great time for deep work on API refactoring (est: 2.5h)
```

### Learning Over Time

Track what suggestions user accepts:
- Which factors matter most to this user
- Typical task duration accuracy
- Energy level patterns by time of day
- Adjust scoring weights accordingly

This is the "omniscient assistant" - combining all available data intelligently.
