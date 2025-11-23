---
name: Zettelkasten Literature Notes
description: Create summaries and analysis of external sources (papers, articles, books, videos). Use when processing URLs, papers, or creating source summaries.
---

# Zettelkasten Literature Notes

Create literature notes as stepping stones to permanent notes - summarize external sources in your own words.

## When to Use

- User provides URL for summarization
- User mentions academic paper or article
- Creating research summaries
- Processing external content
- "Read this and create a note"

## Purpose

Literature notes serve as:
1. **Condensed summaries** of source material
2. **Understanding check** - Can I explain this?
3. **Stepping stones** to permanent notes
4. **Citation reference** for future work

## Frontmatter (Required)

```yaml
---
type: literature
status: [draft|processing|complete]
created: YYYY-MM-DD HH:MM
updated: YYYY-MM-DD HH:MM
source: https://full-url
author: Author Name(s)
title: Full Title
date_published: YYYY-MM-DD
date_accessed: YYYY-MM-DD
tags:
  - research
  - specific-domain
  - methodology
related:
  - "[[Related Note 1]]"
  - "[[Related Note 2]]"
---
```

### Academic Papers (additional)
```yaml
citekey: authorTitleYYYY
authors: Full institutional affiliation
```

## Structure

### Title Format
`# [Source Title] ([Year])`

### Summary (Required)
2-3 sentences capturing core contribution/argument in YOUR words.

### Key Ideas (Required)
Numbered list of main points:
1. **Concept Name**
   - Supporting details
   - Evidence or examples
   - Your interpretation

Aim for 3-7 key ideas. More? Split into multiple notes.

### Important Quotes (Optional)
Only quotes that:
- Are particularly well-stated
- You might cite later
- Crystallize complex ideas

Format:
> "Quote text with context"
> - Author, context/page

### My Thoughts (Critical)
Where YOU add value:
- What surprised you?
- What do you agree/disagree with?
- What connections do you see?
- What questions emerged?
- How does this change your thinking?

### Applications (Practical)
How could you use this?
- In projects
- In other research
- In understanding concepts

### Follow-up (Action Items)
What does this inspire?
- [ ] Research [related topic]
- [ ] Create permanent note on [concept]
- [ ] Compare with [[other-source]]
- [ ] Test/verify [claim]

### Related Notes
Link to:
- Other literature notes on same topic
- Permanent notes this connects to
- Project notes where relevant

## Workflow

### Creating from Web Content
If user provides URL:
1. Fetch and read content
2. Identify author, title, publication date
3. Create structured literature note with all sections
4. Generate appropriate tags based on content
5. Suggest related existing notes

### Creating from Academic Papers
If user provides paper:
1. Extract metadata (authors, institutions, year)
2. Summarize: problem, approach, results, contribution
3. Identify methodology, key findings, limitations
4. Create citekey: firstAuthorTitleYYYY
5. Link to related papers/concepts
6. Extract permanent note candidates

### Processing Existing Notes
If reviewing literature notes:
1. Check for missing sections (especially "My Thoughts")
2. Suggest permanent notes to extract
3. Identify connections to other notes
4. Flag if too long (>500 lines → split?)
5. Suggest Hub if >5 notes on topic

## Literature → Permanent Pipeline

Ask: "Is there an atomic concept here that stands alone?"

### Extraction Process
1. Identify atomic concept
2. Rewrite in your own words (not tied to source)
3. Create permanent note with clear title
4. Link permanent note back to literature note
5. Link literature note to permanent note

### Example
Literature note: "Alita: Generalist Agent" (paper summary)
→ Permanent notes:
- [[minimal-predefinition-maximal-self-evolution]]
- [[mcp-dynamic-tool-generation]]
- [[emergence-vs-engineered-capabilities]]

## Special Types

### Wikipedia/Encyclopedia
Format: `YYYYMMDD-wikipedia-topic.md`
- Shorter summary
- Focus on surprising/useful facts
- Include "eli5" section if helpful

### YouTube/Video
- Include timestamp links for key points
- Summarize visual elements
- Note: "See video at MM:SS for [concept]"

### Books
- May need multiple notes (one per chapter)
- Link chapter notes together
- Create Hub for book overview

### Blog Posts/Articles
- Standard format
- Note author's background/bias if relevant
- Check publication date (old vs new)

## Quality Standards

### Good Literature Notes
- **Standalone** - Understandable without reading source
- **Own words** - Not copy-paste (except quotes)
- **Critical** - Includes your analysis
- **Connected** - Links to related ideas
- **Actionable** - Clear follow-up steps

### Red Flags
- Pure copy-paste
- No "My Thoughts" section
- No links (orphan)
- Vague title
- Missing source URL/citation

## Citation & Attribution

Always include:
- Source URL (web content)
- Author name(s)
- Publication date
- Access date (web content changes)

## Integration

Use WebFetch tool to:
- Read URLs provided by user
- Extract content for summarization
- Verify source metadata

Remember: Literature notes are about understanding the source. Permanent notes are about building your own thinking. Both necessary.
