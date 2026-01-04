---
name: research
description: Search vault and synthesize findings
---

# Research Skill

Search vault, synthesize findings, create Hub notes.

## Workflow

1. **Search vault**
   - Obsidian search: `xdg-open "obsidian://search?vault=Vault&query=tag:#concept"`
   - Similarity search: `mcp__plugin_dere-vault_vault__search_vault_concepts(query: "topic")`
   - Review tags with `mcp__plugin_dere-vault_zotero__list_all_tags()`

2. **Review related notes**
   - Open notes in Obsidian
   - Suggest connections: `mcp__plugin_dere-vault_vault__suggest_vault_connections(note_title: "Note Title")`
   - Find orphans: `mcp__plugin_dere-vault_vault__find_vault_orphans(min_links: 3)`
   - Vault stats: `mcp__plugin_dere-vault_vault__get_vault_stats()`
   - Identify patterns and gaps

3. **Synthesize findings**
   - Create new permanent note with synthesis
   - Or expand existing Hub note

4. **Create Hub note** (when many related notes exist)
   - Overview of topic area
   - Categorized links to related notes
   - Identify knowledge gaps

## Hub vs Synthesis

**Hub Note:**

- Index/map of topic area
- Links organized by category
- Example: "Distributed Systems Concepts"

**Synthesis Note:**

- Original insight combining sources
- Atomic permanent note
- Example: "Trade-offs Between Consistency Models"
