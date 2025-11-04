---
name: Task Focus Session
description: Start focused work session by selecting best task for current context, energy, and time available. Use when user asks "what should I work on" or wants to start working.
---

# Task Focus Session

Help user select and start the optimal task based on their current context, energy level, and available time.

## When to Use

- User asks "what should I work on?"
- User wants to start a work/focus session
- User has limited time and needs quick wins
- User mentions their energy level (tired, energized, etc.)
- User wants to be productive but feels stuck

## Getting the Right Task

### Step 1: Understand Context
Ask user:
- Where are you? (home, office, traveling)
- How much time do you have?
- What's your energy level? (high, medium, low)
- Any specific project/area to focus on?

### Step 2: Query Next Actions
Use MCP tool with context filters:
```
mcp__taskwarrior__get_next_actions
Parameters:
  - context: "@home", "@computer", "@errands", etc.
  - energy_level: "H", "M", "L"
  - time_available: "15m", "1h", "2h+", etc.
  - limit: 5
```

Returns: Top-ranked tasks with urgency scores, metadata, insights

### Step 3: Present Options
Show user 3-5 tasks with:
- Task description
- Why it's a good fit (context/energy/time match)
- Estimated time
- Project context
- Dependencies (if any)

### Step 4: Start Task
When user selects:
```
mcp__taskwarrior__start_task (task_id)
```
This tracks active time and sets task as current focus.

## Context Tags

Help user filter by location/tool needed:

**Location:**
- @home - at home
- @office - at office
- @computer - needs computer
- @phone - phone calls
- @errands - out and about
- @anywhere - can do anywhere

**Tools:**
- @online - needs internet
- @offline - can work offline

**People:**
- @waiting - waiting for someone
- @agenda - discuss at meeting

## Energy Level Matching

**High Energy (H):**
- Creative work
- Complex problem-solving
- Writing/planning
- Learning new concepts
- Important decisions

**Medium Energy (M):**
- Regular coding/dev work
- Meetings
- Moderate focus tasks
- Routine planning

**Low Energy (L):**
- Administrative tasks
- Organizing/filing
- Simple edits
- Reading/research
- Email processing

## Time Availability Matching

**< 15 minutes:**
- Quick reviews
- Email responses
- Simple task completion
- Organizing next actions

**15-30 minutes:**
- Focused work chunks
- Meeting prep
- Quick research
- Short coding tasks

**30-60 minutes:**
- Deep work sessions
- Complex task progress
- Writing/documentation
- Significant problem-solving

**1-2 hours:**
- Major project work
- Flow state tasks
- Complete features
- Deep research

**2+ hours:**
- Large projects
- Multi-step work
- Deep creative work
- Major milestones

## Presenting Recommendations

### Good Format
```
Based on your context (@home, medium energy, 1 hour), here are your best options:

1. **Draft API documentation for auth system**
   Project: backend-redesign
   Why: Medium focus work, at computer, 45-60min estimate
   Urgency: High (due tomorrow)

2. **Review pull request #234**
   Project: code-quality
   Why: Can do at home, moderate energy needed, 30min
   Urgency: Medium (team blocked)

3. **Refactor user service tests**
   Project: testing-improvements
   Why: Good for available time, clear scope
   Urgency: Low (cleanup work)

Which feels like the right fit right now?
```

## During Focus Session

Once task started:
- Acknowledge task selection
- Remind user of estimated time
- Suggest timer if helpful
- Note any blocking dependencies
- Connect to wellness if long session (suggest breaks)

## After Session

When task complete or paused:
```
mcp__taskwarrior__stop_task (task_id)
```

Ask user:
- Want to mark as done?
- Make progress note?
- Identify any blockers?
- Ready for next task?

## Integration with Other Skills

**Wellness Integration:**
- Suggest breaks for sessions > 90min
- Note if user seems tired (suggest low-energy tasks)
- Encourage healthy work rhythm

**Pattern Analysis:**
- Track which tasks user procrastinates
- Notice peak productivity times
- Identify energy-mismatch patterns

**Inbox Processing:**
- After processing inbox, suggest first focus task
- Connect newly clarified tasks to focus session

## Best Practices

### Ask Before Assuming
Don't guess context - ask user where they are and what their constraints are.

### Respect Energy Levels
If user says they're tired, don't suggest high-energy creative work.

### Provide Options
Give 3-5 choices, not just one. Let user feel in control.

### Explain Ranking
Help user understand WHY a task is recommended.

### Track Time
Use start/stop for realistic time tracking and planning.

## Common Scenarios

**Morning Planning:**
```
User: "What should I work on this morning?"
You: "Let's find you a good task. Are you at home or office?
      How much time do you have before your first meeting?"
```

**Low Energy Day:**
```
User: "I'm tired but want to be productive"
You: "Perfect - let's find some low-energy wins. Any admin tasks
      or simple cleanup work that's been piling up?"
```

**Got 15 Minutes:**
```
User: "I have 15 minutes before my call"
You: "Great for quick wins. Let me find tasks you can complete
      in under 15 minutes..."
```

**Deep Work Time:**
```
User: "I have 3 hours of uninterrupted time"
You: "Excellent! This is perfect for deep work. What project has
      been needing focused attention?"
```

Remember: The goal is to reduce friction between "I want to work" and "I'm working on the right thing."
