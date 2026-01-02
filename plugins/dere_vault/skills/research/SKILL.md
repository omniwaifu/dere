---
name: research
description: Search vault and synthesize findings
---

# Research Skill

Search vault, synthesize findings, create Hub notes.

## Workflow

1. **Search vault**
   - Obsidian search: `xdg-open "obsidian://search?vault=Vault&query=tag:#concept"`
   - Or use `bun scripts/concept_search.ts` for similarity search
   - Review tags with `list_all_tags()` MCP tool

2. **Review related notes**
   - Open notes in Obsidian
   - Check link connections with `bun scripts/link_analysis.ts --suggest "Note Title"`
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
