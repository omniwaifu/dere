---
name: Zettelkasten Daily Notes
description: Create and process daily journal entries for task tracking, thoughts, and knowledge capture. Use when creating daily notes or reviewing/extracting insights from daily entries.
---

# Zettelkasten Daily Notes

Create atomic daily notes following Zettelkasten principles for capturing fleeting thoughts and extracting permanent knowledge.

## When to Use

- User requests daily note creation
- User asks to "process today's notes" or review daily entries
- User mentions daily journal or task tracking
- Morning planning or evening reflection

## Daily Note Purpose

Daily notes serve four core functions:
1. **Capture** - Fleeting thoughts and tasks throughout the day
2. **Track** - Daily priorities and accomplishments
3. **Document** - What was learned
4. **Source** - Material for permanent notes

## Frontmatter (Required)

```yaml
---
type: daily
created: YYYY-MM-DD HH:MM
tags:
  - daily
  - YYYY-MM
---
```

## Structure

### Morning Section
**Priority (1-3 tasks max):**
- Concrete, finishable tasks
- Real outcomes, not vague intentions
- Checkbox format for tracking

**Intention:**
- Brief focus statement for the day
- Theme, question, or goal

### Evening Section
**Reflection:**
- How the day went
- What was accomplished
- Unexpected learnings

**Notes & Thoughts:**
- Ideas and observations captured throughout day
- No formatting requirements
- Extract to permanent notes when ready

## Workflow

### Creating Daily Notes
1. Use consistent title format: `YYYY-MM-DD`
2. Add complete frontmatter
3. Create priority section with 1-3 tasks
4. Set clear intention
5. Include navigation links to yesterday/tomorrow

### Processing Daily Notes
When user asks to "process" or "review" daily notes:

1. **Read** the daily note
2. **Categorize**:
   - Tasks → keep or move to project
   - Ideas → extract to permanent notes
   - URLs → create literature notes
   - Observations → link to existing notes
3. **Suggest**:
   - Permanent note on [concept]
   - Literature note from [URL]
   - Link to [[existing-note]]
   - Update [[MOC]] with connection

### Reflection Questions
Help user reflect:
- What surprised you today?
- What connection did you notice?
- What do you want to remember?
- What question emerged?
- What worked/didn't work?

## Linking

**During the day:**
- Link to permanent notes when referencing concepts
- Link to project notes for context
- Use tags: #insight, #question, #idea

**During review:**
- Create backlinks from permanent notes
- Tag themes for pattern analysis
- Link related days

## Pattern Recognition

Look for over time:
- Recurring themes → suggest MOC or permanent note
- Repeated questions → signal for deep dive
- Tasks never done → suggest reprioritize
- High-energy topics → guide exploration

## Quality Standards

### Good Daily Entry Example
```markdown
---
type: daily
created: 2025-10-14 08:00
tags:
  - daily
  - 2025-10
---

# Today
## Beginning
### Priority
- [ ] Process research notes on [[agent-architectures]]
- [ ] Outline permanent note on [[emergence-vs-engineering]]

Want to clarify thinking on when to engineer vs let emerge.

## End
Realized [[emergence-vs-engineering]] connects to [[alita-paper]] philosophy. Created [[emergence-vs-engineering-tradeoffs]] permanent note.

Question: How does this relate to [[robust-agents-causality]]?
```

## Integration

Daily notes connect to:
- Permanent notes (extract concepts)
- Project notes (track tasks)
- Literature notes (source summaries)
- MOCs (topic organization)

## Best Practices

- **Capture freely** - Don't self-censor during the day
- **Link liberally** - Connections create value
- **Review regularly** - Weekly is ideal
- **Extract promptly** - Don't let insights get stale
- **Stay honest** - Document what didn't work too

Remember: Daily notes are for capture. Extract useful concepts into permanent notes when ready.
