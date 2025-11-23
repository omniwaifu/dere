# Source Reference

Technical specifications for literature notes and bibliographic metadata.

## Frontmatter Schema

### Basic (All Sources)
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
  - source/article  # or /paper /book /video
  - domain-tag
related:
  - "[[Related Note 1]]"
  - "[[Related Note 2]]"
---
```

### Academic Papers (Additional)
```yaml
citekey: authorTitleYYYY
authors: Full institutional affiliation
doi: 10.xxxx/xxxxx
journal: Journal Name
volume: XX
issue: XX
pages: XX-XX
```

### Books (Additional)
```yaml
isbn: XXXXXXXXXXXX
publisher: Publisher Name
edition: X
```

## BibTeX Integration

If using Zotero with Better BibTeX exporting to `library.bib` in vault root, you can look up citation metadata automatically instead of manual entry.

### Searching library.bib

Find entries by citekey, title, or author:

```bash
# By citekey
grep -A 20 "@.*{citekey," library.bib

# By title (case-insensitive)
grep -i -A 20 "title = {.*search term" library.bib

# By author
grep -i -A 20 "author = {.*lastname" library.bib
```

### Available Fields

BibTeX entries provide:
- `author` - Author name(s)
- `title` - Full title
- `year` / `date` - Publication year
- `doi` - Digital Object Identifier
- `url` / `urldate` - Web source
- `abstract` - Paper abstract
- `journal` / `booktitle` - Publication venue
- `isbn` - Book identifier
- `publisher` - Publisher name
- `keywords` - Subject tags

### Workflow with Zotero

1. Check if `library.bib` exists in vault root
2. Search for entry by title, author, or citekey
3. Extract metadata fields from BibTeX entry
4. Auto-populate frontmatter instead of manual entry
5. Proceed with standard literature note creation

### Fallback

If library.bib doesn't exist or entry not found:
- Manual metadata entry (standard workflow)
- Note to add source to Zotero for future

## Title Format

`# [Source Title] ([Year])`

Examples:
- `# How to Take Smart Notes (2017)`
- `# The Zettelkasten Method - Carter (2021)`

## Note Structure

### Summary (Required)
2-3 sentences capturing core contribution/argument in your own words.

### Key Ideas (Required)
Numbered list of 3-7 main points:

```markdown
1. **Concept Name**
   - Supporting details
   - Evidence or examples
   - Your interpretation
```

If >7 key ideas, split into multiple notes.

### Important Quotes (Optional)
Only quotes that:
- Are particularly well-stated
- You might cite later
- Crystallize complex ideas

Format:
```markdown
> "Quote text with context"
> - Author, context/page number
```

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
```markdown
- [ ] Research [related topic]
- [ ] Create permanent note on [concept]
- [ ] Read [[cited-work]]
```

## Citation Formats

### In-text Citation
`[[Author - Title (Year)]]` or `[[Author (Year)]]`

### Bibliography Entry
Generated from frontmatter metadata.

## Quality Checklist

**Good literature note:**
- [ ] Written in your own words
- [ ] Demonstrates understanding
- [ ] Identifies reusable concepts
- [ ] Links to related notes
- [ ] Includes critical thinking
- [ ] Complete bibliographic metadata

**Bad literature note:**
- [ ] Copy-pasted content
- [ ] No personal interpretation
- [ ] Orphaned (no links)
- [ ] Missing metadata
- [ ] No follow-up actions
