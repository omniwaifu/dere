---
name: capture
description: Capture tasks from natural language with smart parsing for context, projects, and priorities. Use when user casually mentions something they need to do.
---

# Task Quick Add

Capture tasks from casual mentions, parsing context and metadata without forcing rigid formats.

## When to Use

- User says "I need to..." or "remind me to..."
- Casual mention of future action during conversation
- User wants to capture thought without breaking flow

## Natural Language Parsing

Extract from user's language:

- **Project**: "for the redesign" → project:redesign
- **Context**: "when I'm home" → home, "call about" → phone
- **Energy**: "think through" → energy:H, "organize" → energy:L
- **Due**: "today", "tomorrow", "this week" → due dates
- **Priority**: "urgent" → priority:H, "eventually" → priority:L

## Make Tasks Actionable

Transform vague → specific:

- "work on website" → "Draft new homepage copy for website redesign"
- "dentist" → "Call dentist to schedule cleaning appointment"

Ask clarifying questions when needed.

## Workflow

1. **Listen** for task mention (user doesn't need to say "add task")
2. **Parse** what you can from natural language
3. **Clarify** what's unclear or vague
4. **Add** using `mcp__taskwarrior__add_task`
5. **Confirm** and offer enhancements

## Example

```
User: "I should really email John about the proposal soon"

You:
1. Parse: action="email John", context="computer", vague timing
2. Clarify: "Is this urgent or can it wait?"
3. Add task with:
   - description: "Email John about proposal timeline"
   - context: "computer"
   - tags: ["+communication"]
   - priority: M
4. Confirm: "Added 'Email John about proposal timeline' (computer).
            Want to set a specific due date?"
```

## MCP Tools

- `add_task` - Create task with description, project, tags, priority, due date
