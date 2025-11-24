# Source Reference

Technical specifications for literature notes and bibliographic metadata.

## Frontmatter Schema

### Basic (All Sources)
```yaml
---
type: literature
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

## Zotero Integration

### Method 1: Zotero SQLite (Recommended)

Query Zotero database directly for full metadata including abstracts, tags, and attachments.

**Tool:** `tools/zotlit-create.py`

**Database:** `~/Zotero/zotero.sqlite`

**Usage:**
```bash
# Quick title search
zotlit-create.py "Computational Complexity"

# Specific author
zotlit-create.py --author "Aaronson"

# Title + author
zotlit-create.py --title "Quantum" --author "Aaronson"

# By citekey (Better BibTeX)
zotlit-create.py --citekey "aaronson2011"

# Override vault location
zotlit-create.py "Search" --vault ~/my-vault

# Use @citekey.md naming
zotlit-create.py "Search" --citekey-naming

# Skip daily note logging
zotlit-create.py "Search" --no-daily-log
```

**Features:**
- Queries Zotero's SQLite database directly
- Extracts full metadata (title, authors, year, abstract, DOI, URL)
- Includes tags and attachments from Zotero
- Auto-generates formatted markdown note
- Auto-logs to daily note under "## Reading"
- Interactive picker for multiple matches

**Output:**
- Creates note: `Literature/Author - Title (Year).md`
- Appends to daily note (path from .obsidian/daily-notes.json)

### Method 2: BibTeX Export

Use exported library.bib for lightweight metadata lookup without full Zotero database.

**Tool:** `tools/bib-lookup.py`

**File:** `library.bib` (exported via Better BibTeX)

**Searching library.bib:**

```bash
# By citekey
grep -A 20 "@.*{citekey," library.bib

# By title (case-insensitive)
grep -i -A 20 "title = {.*search term" library.bib

# By author
grep -i -A 20 "author = {.*lastname" library.bib
```

**Available Fields:**
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

### Comparison

| Feature | Zotero SQLite | BibTeX Export |
|---------|---------------|---------------|
| Full metadata | ✓ | ✓ |
| Abstracts | ✓ | Limited |
| Tags | ✓ | Via keywords |
| Attachments | ✓ | ✗ |
| Daily logging | Auto | Manual |
| Requires Zotero | ✓ | ✗ |

**Recommendation:** Use `zotlit-create.py` if Zotero database exists. Fallback to `bib-lookup.py` if only library.bib is available.

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

## Daily Note Integration

After creating a literature note, automatically log it to today's daily note for tracking reading progress.

### Using Advanced URI

Append to daily note's "Reading" section:

```bash
xdg-open "obsidian://advanced-uri?vault=VaultName&daily=true&heading=Reading&data=- [[Note Title]]&mode=append"
```

### Configuration

**Vault name:**
- Read from vault detection (`.obsidian` directory name)
- Or override in `~/.config/dere/config.toml`:
  ```toml
  [vault]
  name = "MyVault"
  ```

**Daily note format:**
- Appends under "## Reading" heading
- Creates heading if it doesn't exist
- Format: `- [[Literature Note Title]] - Brief summary`

### Fallback

If daily note doesn't exist yet (Advanced URI limitation):
- Note still created successfully
- Daily logging skipped gracefully
- User can manually add link later or create daily note first

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
