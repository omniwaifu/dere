# Capture Reference

Technical specifications for daily notes and fleeting note capture.

## Frontmatter Schema

```yaml
---
date: YYYY-MM-DD
created: YYYY-MM-DD HH:MM
tags:
  - daily
  - YYYY-MM
---
```

## Daily Note Structure

### File Naming
- Format: `YYYY-MM-DD.md`
- Location: `Journal/` directory
- Example: `2025-01-15.md`

### Template Sections

#### Morning
```markdown
## Morning

**Priority (1-3 tasks):**
- [ ] Concrete, finishable task
- [ ] Real outcome, not vague intention

**Intention:**
Brief focus statement for the day
```

#### Evening
```markdown
## Evening

**Reflection:**
- How the day went
- What was accomplished
- Unexpected learnings

**Notes & Thoughts:**
- Ideas captured throughout day
- Extract to permanent notes within 1-2 days
```

### Navigation
```markdown
← [[YYYY-MM-DD]] | [[YYYY-MM-DD]] →
```

## Processing Tags

Use tags to mark content for processing:

- `#process` - Needs review/extraction
- `#extract` - Candidate for permanent note
- `#todo` - Action item
- `#source` - URL/reference to process
- `#question` - Open question or uncertainty

## Processing Workflow

**Within 1-2 days**, categorize content:

1. **Tasks** → Keep or move to project note
2. **Ideas** → Extract to permanent notes
3. **URLs** → Create literature notes (source skill)
4. **Observations** → Link to existing notes

## Reflection Prompts

Guide user with:
- What surprised you today?
- What connection did you notice?
- What do you want to remember?
- What question emerged?
- What needs follow-up?
