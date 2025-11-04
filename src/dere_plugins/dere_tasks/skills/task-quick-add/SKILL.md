---
name: Task Quick Add
description: Quickly capture tasks from natural language with smart parsing for context, projects, priorities, and due dates. Use when user casually mentions something they need to do.
---

# Task Quick Add

Capture tasks quickly from natural language, intelligently parsing context, energy, projects, and due dates without forcing user into rigid formats.

## When to Use

- User mentions "I need to..." or "remind me to..."
- User casually states a todo
- During conversation, user mentions future action
- User wants to capture thought without breaking flow
- Brainstorming or planning sessions

## Natural Language Parsing

Listen for signals in user's language and extract:

### Project Clues
- "for the redesign" → project:redesign
- "part of the backend work" → project:backend
- "related to the website" → project:website

### Context Clues
- "when I'm home" → @home
- "next time I'm at computer" → @computer
- "call about..." → @phone
- "pick up..." → @errands
- "email..." → @computer

### Energy Level Clues
- "think through..." → energy:H (requires thought)
- "organize..." → energy:L (routine work)
- "write..." → energy:M or H (depends on complexity)
- "quick..." → energy:L

### Due Date Clues
- "today" → due:today
- "tomorrow" → due:tomorrow
- "this week" → due:eow
- "next Monday" → due:monday
- "by Friday" → due:friday

### Priority Clues
- "urgent", "asap", "critical" → priority:H
- "when I get a chance", "eventually" → priority:L
- No signal → priority:M (default)

## MCP Tool Usage

```
mcp__taskwarrior__add_task
Parameters:
  description: string (cleaned, actionable)
  project: string (optional)
  tags: array (context tags, etc.)
  priority: H|M|L (optional)
  due: string (optional, taskwarrior format)
  annotations: array (optional, for extra context)
```

## Workflow

### Step 1: Listen for Task Mention
User doesn't have to explicitly say "add task" - catch natural mentions:
```
User: "I should really email John about the proposal soon"
You: (recognize task, extract details)
```

### Step 2: Parse & Clarify
Extract what you can, ask for what's unclear:
```
You: "I'll add that. Quick clarification - is this urgent, or can it wait?
      Also, is this for a specific project?"
```

### Step 3: Add Task with Intelligence
```
Add task:
- Description: "Email John about proposal timeline"
- Context: @computer
- Priority: M (user said "soon" not "urgent")
- Tag: +communication
```

### Step 4: Confirm & Offer Enhancement
```
You: "Added: 'Email John about proposal timeline' (@computer, normal priority).
      Want me to set a specific due date, or link to a project?"
```

## Making Tasks Actionable

Transform vague statements into clear next actions:

**Vague → Actionable**
- "work on website" → "Draft new homepage copy for website redesign"
- "Python" → "Complete chapter 3 exercises in Python tutorial"
- "dentist" → "Call dentist to schedule cleaning appointment"
- "mom's birthday" → "Order birthday gift for mom (due: March 10)"

**Ask clarifying questions when needed:**
- "What's the first step?"
- "What does 'work on' mean specifically?"
- "What outcome are you aiming for?"

## Smart Defaults

When information is missing, use intelligent defaults:

**No context given:**
- If mentions "email/call/draft" → @computer
- If mentions "buy/pick up" → @errands
- If mentions "discuss/ask" → @agenda
- Otherwise → +inbox (process later)

**No priority:**
- If urgent language → priority:H
- If someday language → priority:L
- Otherwise → priority:M

**No project:**
- Look for recent project mentions in conversation
- Ask if unclear
- Add +inbox tag if no project

## Batch Capture

When user lists multiple tasks:
```
User: "I need to email the client, review the PR, and buy groceries"
You: "Got it, I'll add all three:
     1. Email client about [clarify topic?]
     2. Review PR #[number?]
     3. Buy groceries (@errands)

     Want to set any due dates or priorities?"
```

## Integration with Conversation Context

### During Planning
```
User: "So for the launch next week, I need to finalize copy,
       test the forms, and email the team"
You: (captures 3 tasks, sets project:launch, due:eow)
```

### During Retrospective
```
User: "I keep forgetting to update the documentation"
You: "Let me add that as a recurring task. How often - weekly?"
```

### From Insights
```
User: "I always procrastinate on writing"
You: "Want me to add 'write for 30 min' with @morning tag
      and energy:H so it shows up when you're fresh?"
```

## Best Practices

### Don't Interrupt Flow
If user is in middle of explanation, don't stop to capture tasks. Wait for natural pause.

### Confirm Understanding
Repeat back in your own words to ensure accuracy.

### Suggest Improvements
"I added that. Since it requires focused time, want me to tag it energy:H?"

### Link Related Tasks
"This relates to your 'launch-prep' project. Should I link them?"

### Stay Humble About Parsing
If unclear, ask. Don't guess at important details.

## Common Patterns

**Morning Brain Dump:**
```
User: "Okay, today I need to respond to emails, prep for the
       meeting, finish that report, and call the vendor"
You: (captures all 4, asks about priorities, sets energy levels)
```

**Reminder Request:**
```
User: "Remind me to check in with Sarah next week"
You: "Added 'check in with Sarah' due next Monday. Want to specify
      what to check in about?"
```

**Project Brainstorm:**
```
User: "For the redesign, we need to audit the current site, create
       wireframes, and get feedback from users"
You: (creates project:redesign with 3 linked tasks, suggests dependencies)
```

**Casual Mention:**
```
User: "Oh, I should probably update those docs sometime"
You: "Want me to add 'update docs' to your inbox? We can clarify
      which docs and when during your next review."
```

## Integration

Quick Add connects to:
- **Inbox Processing** - Add to +inbox for later clarification
- **Focus Sessions** - Newly added tasks appear in next-action queries
- **Pattern Analysis** - Track what gets added but never done
- **Wellness** - Smart scheduling based on energy patterns

Remember: The goal is frictionless capture. Don't make the user format things - do the smart parsing for them.
