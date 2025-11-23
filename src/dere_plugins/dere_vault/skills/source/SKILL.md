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
2. **Check Zotero database** - Does this URL/title already exist?
   - Use `tools/zotero-lookup.py --url <url>` or `--title <title>`
   - If found → Use `tools/zotlit-create.py` to create note (skip to step 6)
   - If not found → Continue to step 3
3. **Ask user about Zotero** - Should this be added to your Zotero library?
   - Use `AskUserQuestion` tool with options:
     - "Yes (article/paper)" → Use `tools/zotero-add-item.py` with `--type journalArticle`
     - "Yes (blog/webpage)" → Use `tools/zotero-add-item.py` with `--type blogPost`
     - "No (just create note)" → Continue to step 4
   - After adding to Zotero, use `zotlit-create.py` to create note (skip to step 6)
4. **Summarize in your own words** - no copy-paste, demonstrate understanding
5. **Create manual literature note** with metadata:
   - Extract metadata from URL (Open Graph tags, HTML meta)
   - Use standard frontmatter format (see REFERENCE.md)
   - Structure: Title, Metadata, Summary, Key Concepts, Connections
6. **Log to daily note** - Automatically appended under "## Reading" section

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
