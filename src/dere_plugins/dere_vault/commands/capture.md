---
name: capture
description: Create literature note from URL with Zotero integration
---

Create metadata-only literature note from URL with automatic Zotero integration.

**IMPORTANT: Use MCP tools directly, NOT bash commands.**

**Workflow:**

1. **Check Zotero**: Use `search_zotero` MCP tool with `search_type="url"`
   - If found: Use `create_literature_note` with item key, done
   - If not found: continue to step 2

2. **Fetch content**: Fetch URL to extract metadata (title, author, abstract)

3. **Add to Zotero**: Use `add_zotero_item` MCP tool
   - Determine item type: academic paper = `journalArticle`, blog/webpage = `blogPost`
   - Include title, url, author, abstract

4. **Get existing taxonomy**: Use `list_collections()` and `list_all_tags()` to see what exists

5. **Categorize**:
   - Collection: Max 2-3 levels with spaces (e.g., `Computer Science/Programming Languages`)
   - Tags: 2-4 hierarchical tags with slashes (e.g., `algorithms/consensus/raft`, `architecture/distributed/actor-model`)
   - NO paper-specific details, author names, or broad topics
   - Use `add_item_to_collection(item_key, collection_path)` and `add_tags_to_item(item_key, tags)`

6. **Get citekey**:
   - Find and read the BibTeX file in vault root
   - Match entry by URL
   - Extract citekey from entry header

7. **Create note**: Use `create_literature_note` MCP tool with item key

8. **Add citekey to note**: Edit the created note's frontmatter to add the citekey line after url/doi

Done. Note contains frontmatter (with citekey) + title + abstract only. User fills in analysis.
