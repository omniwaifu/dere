---
name: morning-plan
description: Comprehensive daily planning ritual combining tasks, calendar, and yesterday's patterns. Use when user starts their day or invokes /plan-day command.
---

# Morning Planning Skill

Start the day with a structured planning session that reviews context and creates an intentional plan.

## When to Use

- User says "plan my day" or "morning planning"
- Triggered by `/plan-day` command
- Daily ritual at work session start
- After checking tasks/calendar, wants comprehensive plan

## Guided Planning Flow

This is a conversational, step-by-step ritual (not automated).

### Step 1: Review Yesterday (if available)

```
Pull activity-summary data:
- What did you actually work on yesterday?
- Completed tasks vs planned tasks
- Productivity patterns observed
- Wins and challenges

Present quick summary:
"Yesterday:
 ✓ Completed 3 tasks (API work, PR reviews, docs)
 - Actual time: 6h 20m
 - Most productive: Morning (9-11:30am)
 - Distraction: Afternoon Slack notifications
 - Carried over: Database optimization task"
```

### Step 2: Review Today's Calendar

```
calendar = list_events(timeMin=today_start, timeMax=today_end)

Present schedule:
"Today's Calendar:
 9:30am: Team standup (30min)
 2:00pm: Design review (1h)
 4:00pm: 1:1 with manager (30min)

 Free blocks:
 - 10am-2pm (4 hours) ← Deep work opportunity
 - 3-4pm (1 hour)
 - After 4:30pm (flexible)"
```

### Step 3: Review Task Context

```
tasks = get_tasks(status="pending")
urgent = get_tasks(due_before="today")
important = get_tasks(priority="H")

Present:
"Task Landscape:
 🔴 Due today: 2 tasks
    - Fix critical bug (est: 1h)
    - Submit expense report (est: 20min)

 🔥 High priority: 3 tasks
    - Database optimization (est: 3h, due tomorrow)
    - Feature planning (est: 2h, due this week)
    - Code review backlog (est: 1.5h)

 📋 Also available: 8 other tasks"
```

### Step 4: Set Daily Intention

Ask user:

```
"What's your main goal for today?
 a) Make progress on one big thing
 b) Clear multiple small things
 c) Balance of both
 d) Mostly meetings/communication"

Optional: "Any energy or time constraints today?"
```

### Step 5: Propose Daily Plan

Based on intention + constraints:

```
User chose: "Make progress on one big thing"

You propose:
"Recommended Plan:

🎯 Primary Focus: Database optimization (your 4-hour morning block)

 Morning (9-10am):
 ⚡ Quick wins before standup:
    - Submit expense report (20min)
    - Fix critical bug (1h) ← Due today, get it done
    - Buffer/email (10min)

 10am-2pm: DEEP WORK BLOCK
 🚀 Database optimization (3h allocated)
    - 10-11: Profiling and analysis
    - 11-12:30: Implementation
    - 12:30-1: Testing
    - 1-2: Buffer/refinement

 Afternoon:
 2-3pm: Design review meeting
 3-4pm: Code review backlog (1h)
 4-4:30pm: 1:1 with manager
 4:30-5pm: Wrap up, plan tomorrow

 🛡️ Protection Strategy:
    - Slack DND: 10am-2pm
    - No new meetings before 2pm
    - If interrupted, resume DB work first

 Success Criteria:
 ✓ Critical bug fixed
 ✓ DB optimization 80% complete
 ✓ Code reviews cleared
 ✓ All meetings attended

 What do you think?"
```

### Step 6: Refine and Confirm

User can adjust:

```
User: "Actually I'm low energy today, can't do deep work"

You: "Revised Plan:

 Morning:
 - Bug fix (1h)
 - Code reviews (1.5h) ← Lower energy, still productive
 - Admin tasks (email, expense, organize) (1h)

 Afternoon:
 - Meetings
 - Light refactoring or docs

 Save DB optimization for tomorrow when you're fresh?
 Or break it into smaller chunks?"
```

### Step 7: Create Time Blocks (Optional)

```
User: "Yes, create calendar blocks for this"

You:
create_event("🚀 Deep Work: Database Optimization", 10am-2pm)
create_event("📝 Code Reviews", 3pm-4pm)

"Calendar updated. Time blocks created with reminders."
```

### Step 8: Start Focus Session

```
User: "Let's start with the bug fix"

You:
start_task(bug_fix_task_id)

"Bug fix task started. Timer running.
 After this, you have the expense report (quick win),
 then your deep work block at 10am.

 You've got this. Focus mode: ON."
```

## Daily Planning Checklist

Ensures nothing is missed:

```
✓ Yesterday reviewed (what worked, what didn't)
✓ Calendar checked (meetings, commitments)
✓ Tasks prioritized (urgent, important, due dates)
✓ Energy assessed (how do you feel?)
✓ Primary goal set (what matters most today?)
✓ Time allocated (specific blocks for specific work)
✓ Protection strategy (how to maintain focus)
✓ Success criteria (what does "done" look like?)
```

## Integration Points

### Feeds from:

- `activity-summary`: Yesterday's actual work
- `calendar-context`: Today's commitments
- Taskwarrior: Pending tasks, due dates, priorities

### Feeds into:

- `focus-planning`: "What to work on now" uses today's plan
- `schedule-planning`: Creates calendar time blocks
- `evening-review`: Compare plan vs actual

## Variations

### Quick Plan (5 minutes)

```
- Skip yesterday review
- Just show: calendar + top 3 urgent tasks
- Pick primary focus
- Go
```

### Deep Plan (15 minutes)

```
- Full yesterday review
- Consider weekly goals
- Energy/context assessment
- Detailed time blocking
- Backup plans
```

### Weekly Planning

```
Same process but for the week:
- Review last week's patterns
- This week's calendar
- Project milestones
- Allocate major tasks to specific days
```

## Output Format

Deliver plan as markdown for user to keep:

```markdown
# Daily Plan - November 19, 2024

## Today's Focus
🎯 Database optimization (primary goal)

## Schedule
- 9-10am: Quick wins (bug fix, expense report)
- 10am-2pm: 🚀 DEEP WORK - Database optimization
- 2-3pm: Design review meeting
- 3-4pm: Code reviews
- 4-4:30pm: 1:1 with manager
- 4:30-5pm: Wrap-up

## Success Criteria
- [ ] Critical bug fixed and deployed
- [ ] Database optimization 80% complete
- [ ] Code review backlog cleared
- [ ] Prep done for tomorrow's planning meeting

## Focus Protection
- Slack DND: 10am-2pm
- No meetings before 2pm
- Phone in another room during deep work

---
*Created with dere-productivity morning-plan skill*
```

User can copy this to their notes, refer back during day.

## Psychology of Planning

Good daily planning:

- **Reduces decision fatigue**: Know what to work on at each moment
- **Manages energy**: Right work for right time
- **Creates accountability**: Explicit commitments
- **Enables focus**: Protected time, clear priorities
- **Provides satisfaction**: Check off completed items

This is the "Aoi" assistant experience - comprehensive daily guidance.
