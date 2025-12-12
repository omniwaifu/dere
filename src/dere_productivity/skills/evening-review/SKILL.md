---
name: evening-review
description: End-of-day reflection and review ritual. Compare planned vs actual, capture wins and learnings, prepare for tomorrow. Use when user ends their work day or invokes /review-day command.
---

# Evening Review Skill

Close the day with structured reflection, accountability, and preparation for tomorrow.

## When to Use

- User says "review my day" or "end of day review"
- Triggered by `/review-day` command
- Daily ritual at work session end
- Before signing off for the day

## Guided Review Flow

Conversational reflection ritual that creates closure and learning.

### Step 1: Gather Today's Data

```
Pull comprehensive day data:
- Activity summary (ActivityWatch actual time)
- Tasks completed (Taskwarrior done today)
- Calendar events attended
- Morning plan (if available)
```

### Step 2: Compare Planned vs Actual

```
If morning plan exists:
"Today's Plan vs Reality:

Planned Focus:
 🎯 Database optimization (3h estimated)

Actually Did:
 ✓ Critical bug fix (1.5h) ← Took longer than planned
 ✓ Team standup (30min)
 ✓ Database optimization (2h) ← 66% of planned time
 ✗ Code reviews ← Didn't get to this
 ✓ Design review meeting (1h)
 ✓ 1:1 with manager (30min)
 + Unplanned: Emergency production issue (1h)

Total Work Time: 6h 30m (planned: 7h)"
```

### Step 3: Activity Analysis

```
activity_data = get_activity_summary(timeRange="today")

"How You Spent Your Time:

By Application:
- VS Code: 4h 15m (65% - coding & debugging)
- Chrome: 1h 30m (23% - docs, meetings)
- Slack: 45min (12% - communication)

By Focus Quality:
- Deep work: 3h 45m (58%)
- Collaboration: 2h (31%)
- Distractions: 45min (11%)

Peak Productivity:
- 10am-12pm: Highest focus (DB optimization work)
- 2pm-3pm: Meeting (design review)
- 3pm-4pm: Context switching (multiple small tasks)

Context Switches: 34 (avg every 11.5min)
Better than yesterday (47 switches)"
```

### Step 4: Capture Wins

Ask user to reflect:
```
"What went well today?

(User may share, or you prompt):
- What are you proud of completing?
- Any breakthroughs or learnings?
- What worked well in your process?"

Example:
User: "Fixed that nasty bug, felt good. DB work went smoothly once I started."

You: "Recorded:
 🏆 Wins:
    - Fixed critical production bug under pressure
    - Made solid progress on database optimization
    - Morning deep work block was productive
    - Good focus during 10am-12pm window"
```

### Step 5: Identify Challenges

```
"What didn't go as planned?

- Code reviews got dropped (emergency took priority)
- DB work took less time than allocated (maybe overestimated?)
- Afternoon had too many context switches"

Optional deeper reflection:
"Why did the emergency happen? Could it have been prevented?
 → Need better monitoring alerts
 → Add task: Improve production monitoring"
```

### Step 6: Capture Learnings

```
"What did you learn today?

Technical:
- PostgreSQL query optimization pattern for joins
- Production debugging workflow under pressure

Process:
- Need to protect deep work time better (emergency interrupted)
- Morning energy is best for complex work (confirmed again)
- 3-hour blocks might be too long, 2h feels better

Personal:
- Low energy after 3pm (need afternoon break?)
- Slack notifications break flow (use DND more)"
```

### Step 7: Tomorrow's Preview

```
Quick look ahead:
"Tomorrow (November 20):

Calendar:
- 9am: Sprint planning (2h)
- 2pm: Client demo (1h)
- Busy meeting day

Pending Tasks:
- Database optimization (finish remaining 1h)
- Code review backlog (still pending)
- Feature planning doc (due Wed)

Suggestion for Tomorrow's Plan:
- Morning before sprint planning: Finish DB work (1h)
- Afternoon after client demo: Code reviews (1.5h)
- Protect time: Block Thurs morning for feature planning

Want to pre-plan tomorrow now, or wait until morning?"
```

### Step 8: Incomplete Tasks Handling

```
Unfinished from today:
- Code reviews (estimated 1.5h)

Options:
a) Reschedule to tomorrow
b) Adjust priority (maybe not urgent?)
c) Delete (not actually needed?)
d) Defer to later this week

User: "Reschedule to tomorrow afternoon"
modify_task(task_id, due="tomorrow")

"Moved to tomorrow. You'll see it in morning planning."
```

### Step 9: Gratitude/Closure

```
"Before signing off:

Accomplishments Today:
✓ 3 tasks completed
✓ 6h 30m productive work
✓ Critical bug resolved
✓ Good progress on major project

You did solid work. Rest well, see you tomorrow.

[Optional: Stop any running tasks]
Running task: Database optimization (2h 15m tracked)
Stop task? (yes/no)"
```

## Daily Review Checklist

```
✓ Planned vs actual compared
✓ Activity data reviewed
✓ Wins celebrated
✓ Challenges identified
✓ Learnings captured
✓ Incomplete tasks processed
✓ Tomorrow previewed
✓ Running tasks stopped
✓ Closure achieved
```

## Data Capture

Important learnings get stored:
```
# To project memory
if user shares significant learning:
    write_memory("productivity_patterns", learning)

# To task system
if new task identified:
    add_task(title, project, tags)

# To future planning
if pattern emerges:
    "You've noted 3 times this week that afternoons are low energy.
     Recommend scheduling deep work only in mornings?"
```

## Integration Points

### Feeds from:
- `activity-summary`: Actual time spent
- `morning-plan`: Original plan for comparison
- Taskwarrior: Completed/pending tasks
- Calendar: Meetings attended

### Feeds into:
- `morning-plan`: Tomorrow's planning uses today's learnings
- `activity-summary`: Patterns over time
- Project memory: Long-term insights

## Output Format

Markdown summary for user's journal:

```markdown
# Daily Review - November 19, 2024

## Accomplishments
- ✅ Fixed critical production bug (1.5h)
- ✅ Database optimization progress - 2h of 3h planned (67%)
- ✅ All meetings attended

## Time Analysis
- Total work: 6h 30m
- Deep work: 3h 45m (58%)
- Peak performance: 10am-12pm

## Wins 🏆
- Solved that nasty bug under pressure
- Good deep work session on DB optimization
- Stayed focused during morning block

## Challenges 😅
- Emergency interrupted planned work
- Didn't get to code reviews
- Afternoon context switching

## Learnings 💡
- Morning energy is real - schedule complex work then
- Need better production monitoring
- 2-hour deep work blocks > 3-hour blocks
- Slack DND is essential

## Tomorrow's Focus
- Finish DB optimization (1h remaining)
- Code review backlog
- Sprint planning meeting

## Carried Over
- Code reviews → Tomorrow afternoon
- Feature planning → Thursday morning

---
*Reviewed with dere-productivity evening-review skill*
```

## Psychology of Review

Good evening review:
- **Creates closure**: Finish the workday mentally
- **Builds learning**: Convert experience into insight
- **Maintains accountability**: Honest look at what happened
- **Prevents carryover stress**: Process unfinished work
- **Improves planning**: Data for better estimates
- **Tracks progress**: See cumulative wins

## Weekly Review Integration

Evening review feeds into weekly review:
```
7 daily reviews → Weekly patterns:
- "You consistently have high energy 9-11am"
- "Wednesday afternoons are always meeting-heavy"
- "You underestimate debugging time by ~30%"
- "Focus time average: 4.2h/day this week"
```

## Variations

### Quick Review (5 minutes)
```
- Just completed tasks
- Quick wins/challenges
- Stop running tasks
- Done
```

### Deep Review (15 minutes)
```
- Full plan vs actual
- Detailed activity analysis
- Thorough reflection
- Learning capture
- Tomorrow pre-planning
```

### Weekly Review
```
- Aggregate all daily reviews
- Weekly goals vs actual
- Pattern analysis
- Next week planning
```

This completes the daily productivity cycle:
**Morning → Plan → Execute → Evening → Review → Repeat**

The "omniscient assistant" knows what you planned, what you did, and helps you improve.
