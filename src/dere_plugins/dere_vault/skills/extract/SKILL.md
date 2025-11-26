---
name: extract
description: Extract atomic concepts into permanent notes
---

# Extract Skill

Create atomic permanent notes from source material.

## Workflow

1. Review source (daily note, literature note)
2. Identify single atomic concept
3. **Search for duplicates** - Use concept_search.py to check if similar permanent note exists
4. Write in own words
5. Link to related permanent notes (use link_analysis.py --suggest for suggestions)
6. Done

## Rules

- One concept per note
- Self-contained (makes sense without source)
- Link to 3+ related notes
- Clear title
- Use hierarchical tags with slashes (e.g., `ai/language-models/emergence`, `economics/information/scarcity`)
- 2-4 tags per note, matching existing taxonomy where possible

## Helper Tools

Available in scripts/ directory:

- `concept_search.py [query]` - Search for similar permanent notes before creating new ones
- `link_analysis.py --suggest [note-title]` - Get connection suggestions based on tag overlap
