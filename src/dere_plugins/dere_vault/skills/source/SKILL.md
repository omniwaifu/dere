---
name: source
description: Summarize articles, papers, books, and videos in your own words with proper citations. Use when processing URLs, reading external content, creating literature notes, or building research references.
---

# Source Skill

Create literature notes from external sources (articles, papers, books, videos) with proper citations and summaries in your own words.

## When to Activate

- User provides URL or mentions: "summarize this", "read", "paper", "article", "book", "video"
- Processing external content
- Building research bibliography
- Creating reference notes

## Core Workflow

1. **Fetch and read** source material
2. **Summarize in your own words** - no copy-paste, demonstrate understanding
3. **Add bibliographic metadata** (choose one method):
   - **Zotero SQLite** (recommended): Use `tools/zotlit-create.py` to query Zotero database directly
   - **BibTeX file**: If library.bib exists, use `tools/bib-lookup.py` to extract metadata
   - **Manual entry**: Author, title, date, URL
4. **Extract key concepts** - what ideas are reusable?
5. **Link to related notes** - what does this connect to?
6. **Log to daily note** - Automatically appended by zotlit-create.py (or manually via Advanced URI)

## Key Principles

- **Own words only** - if you copy, you don't understand
- **Source attribution** - always cite with full metadata
- **Concept extraction** - identify atomic ideas for permanent notes
- **Critical thinking** - note agreements, disagreements, questions

## Note Structure

- Title: Author - Title (Year)
- Type: #source/article, #source/paper, #source/book, #source/video
- Summary: 2-3 paragraphs in your words
- Key concepts: Bullet list of main ideas
- Connections: Links to related notes

## Integration

- After creating source → Use **extract** skill for permanent notes
- For daily captures → Use **capture** skill instead
- For synthesis → Use **research** skill to connect sources

## See Also

- REFERENCE.md for citation formats and metadata schemas
- examples/ for good/bad literature note patterns
