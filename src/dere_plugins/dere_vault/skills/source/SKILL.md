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

**CRITICAL: Literature notes are METADATA ONLY. DO NOT write summaries, key concepts, or connections. After creating the note, STOP. Do not read or edit it.**

1. **Fetch and read** source material
2. **Check Zotero library** - Does this URL/title already exist?
   - Use `search_zotero` MCP tool with appropriate search_type
   - If found → Use `create_literature_note` MCP tool with item key (skip to step 7)
   - If not found → Continue to step 3
3. **Ask user about Zotero** - Should this be added to your Zotero library?
   - Use `AskUserQuestion` tool with options:
     - "Yes (article/paper)" → Use `add_zotero_item` MCP tool with `item_type="journalArticle"`
     - "Yes (blog/webpage)" → Use `add_zotero_item` MCP tool with `item_type="blogPost"`
     - "No (just create note)" → Continue to step 5
   - If added to Zotero → Continue to step 4
4. **Categorize in Zotero** - Analyze and organize automatically
   - Use `list_collections()` and `list_all_tags()` to see existing taxonomy
   - **Analysis priority**: Abstract (primary) → Title → Authors/venue
   - Propose collection path (max 3 levels: Field/Subfield/Topic)
   - Propose 2-5 tags (reuse existing when possible)
   - Show proposed categorization to user for approval
   - Use `add_item_to_collection(item_key, collection_path)` to categorize
   - Use `add_tags_to_item(item_key, tags)` to tag
   - Only create new collections/tags if no existing ones fit
   - Then use `create_literature_note` MCP tool (skip to step 6)
5. **Create manual literature note** with metadata only:
   - Extract metadata from URL (Open Graph tags, HTML meta)
   - Use standard frontmatter format (see REFERENCE.md)
   - Structure: Title, Frontmatter, Abstract (if available)
   - **DO NOT** write summary, key concepts, or connections - user does this
6. **Log to daily note** - Automatically appended under "## Reading" section (handled by create_literature_note tool)

## Key Principles

- **Metadata only** - create empty note with frontmatter, title, and abstract
- **User writes content** - don't fill in summary, concepts, or connections
- **Source attribution** - full metadata in frontmatter
- **Proper categorization** - analyze content to suggest collection and tags

## Note Structure

Literature notes are minimal templates:
- Frontmatter: title, authors, year, url, doi, tags, date
- Title heading
- Abstract section (from Zotero, if available)
- User fills in the rest (summary, key concepts, connections)

## Integration

- After creating source → Use **extract** skill for permanent notes
- For daily captures → Use **capture** skill instead
- For synthesis → Use **research** skill to connect sources

## See Also

- REFERENCE.md for citation formats and metadata schemas
- examples/ for good/bad literature note patterns
