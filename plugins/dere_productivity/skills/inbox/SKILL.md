---
name: inbox
description: Process taskwarrior inbox using GTD clarification workflow. Use when user asks to process inbox, clear +inbox tasks, or feels overwhelmed by tasks.
---

# GTD Inbox Processing

Process inbox items using the GTD clarification workflow.

## Workflow

1. **Get inbox count**: Use `mcp__taskwarrior__process_inbox`
2. **Process one at a time**: Present each task and ask clarifying questions
3. **Apply GTD logic**:
   - Not actionable? → Delete or tag +someday
   - <2 minutes? → Do now
   - > 2 minutes? → Add context (home, computer), energy (H/M/L), project
4. **Remove +inbox tag** after processing
5. **Repeat** until inbox empty

## GTD Questions

For each task:

- Is this actionable?
- What's the next physical action?
- Will it take <2 minutes?
- Is it part of a project?

## Example

```
Task: "email client about proposal"

Questions to ask:
- What specifically needs to be in the email?
- When does this need to happen?

Actions:
- Use mcp__taskwarrior__modify_task to add:
  - context: computer
  - project: client-proposal
  - energy: M
- Remove +inbox tag
```

## MCP Tools

- `process_inbox` - Get inbox tasks
- `modify_task` - Add context/project/energy
- `mark_task_done` - Complete 2-min tasks
- `delete_task` - Remove non-actionable
- `add_dependency` - Link project steps
