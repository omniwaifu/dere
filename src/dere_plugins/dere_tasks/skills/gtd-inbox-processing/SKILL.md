---
name: GTD Inbox Processing
description: Process taskwarrior inbox items using GTD principles. Use when user has +inbox tasks to clarify, organize, or process.
---

# GTD Inbox Processing

Process inbox items systematically using the GTD clarification workflow to determine what each task really is and what to do about it.

## When to Use

- User asks to "process inbox" or "clear inbox"
- User mentions having too many tasks
- User says "what should I work on"
- Morning planning or weekly review
- When user feels overwhelmed by tasks

## GTD Clarification Questions

For each inbox item, help user answer:

1. **What is it?** - What does this task actually mean?
2. **Is it actionable?** - Can you take action on this?
   - If NO → Delete, Reference, or Someday/Maybe
   - If YES → Continue to next question
3. **What's the next action?** - What's the very next physical step?
4. **Will it take <2 minutes?** - Can you do it now?
   - If YES → Do it immediately
   - If NO → Defer, delegate, or schedule
5. **Is it a project?** - Does it require multiple steps?
   - If YES → Create project with dependencies

## Using MCP Tools

### Get Inbox Items
```
Use mcp__taskwarrior__process_inbox
Returns: tasks tagged +inbox with metadata
```

### Clarify & Organize
For each task, use:
- `mcp__taskwarrior__modify_task` - Add context, project, due date
- `mcp__taskwarrior__add_dependency` - Link project steps
- `mcp__taskwarrior__mark_task_done` - Complete 2-minute tasks
- `mcp__taskwarrior__delete_task` - Remove non-actionable items
- `mcp__taskwarrior__add_annotation` - Capture clarifications

## Processing Workflow

### Step 1: Get Inbox Count
Ask MCP for inbox tasks. Let user know how many items to process.

### Step 2: Process Top Item
Present one task at a time:
```
Task: "email client about proposal"

Is this actionable? What's the next physical action?
```

### Step 3: Guide Decision
Based on user response:

**Not Actionable:**
- Delete: "I don't need to do this anymore"
- Someday/Maybe: "Good idea but not now" → tag +someday -inbox
- Reference: "Info to keep" → suggest moving to notes/vault

**Actionable (<2min):**
- Do now: mark as started, user does it, mark done

**Actionable (>2min):**
- Add context: "@computer", "@home", "@errands"
- Add energy level: energy:H/M/L
- Add time estimate: est:30m
- Add project if multi-step
- Remove +inbox tag

### Step 4: Repeat
Move to next inbox item until inbox is empty.

## Best Practices

### Make Tasks Specific
Bad: "email"
Good: "draft email to client about proposal timeline"

### Add Context Tags
- @computer - requires computer
- @home - do at home
- @errands - out and about
- @phone - phone calls
- @waiting - waiting for someone

### Set Energy Levels
- energy:H - creative, complex work
- energy:M - moderate focus
- energy:L - routine, simple tasks

### Create Projects for Multi-Step
If task has multiple steps:
1. Create project with clear outcome
2. Break into next actions
3. Link with dependencies

## Common Patterns

**Vague Task → Clarify**
```
User: "work on website"
You: "What's the very next action? For example:
     - Draft new homepage copy
     - Find three example sites for inspiration
     - Email designer about layout"
```

**Should Do → Decide**
```
User: "I should learn Python"
You: "Is this something you're committed to now, or more of a
      someday/maybe idea? If now, what's the next action?"
```

**Big Project → Break Down**
```
User: "plan vacation"
You: "This sounds like a project. Let's break it into steps:
     - Research destinations (3 options)
     - Check budget limits
     - Compare flight prices
     - Book accommodations
     Want to set these up with dependencies?"
```

## Integration

Inbox processing connects to:
- **Focus sessions** - Next actions become focus tasks
- **Weekly review** - Process inbox as part of review
- **Patterns** - Identify recurring procrastination
- **Wellness** - Suggest breaks during processing

## Success Metrics

Good processing session achieves:
- Inbox at zero
- Every task has clear next action
- Tasks have context/energy/project
- User knows what to work on next
- No vague or ambiguous items

Remember: The goal isn't just to clear the inbox - it's to transform unclear commitments into clear, actionable next steps.
