---
name: Vault Research & Synthesis
description: Search across vault, synthesize findings from multiple notes, and create comprehensive research. Use when researching topics, finding connections, or creating MOCs.
---

# Vault Research & Synthesis

Search across your Zettelkasten vault, synthesize information from multiple notes, and discover connections.

## When to Use

- User asks to research a topic across vault
- User wants to find connections between notes
- Creating Maps of Content (MOCs)
- Identifying orphan notes
- Finding missing connections
- "What do I know about X?"

## Core Philosophy

This vault follows Zettelkasten principles:
- **One idea per note** - Atomic and focused
- **Link liberally** - Connections create knowledge
- **Write in your own words** - Understanding over copying

## Research Workflow

### 1. Search for Information
Use Grep tool to search vault:
- Full text search across all notes
- Tag filtering: `tag:#ai/agents`
- Path filtering: `path:Research/`
- Content matching: `"exact phrase"`
- Combined queries

### 2. Read Relevant Notes
Use Read tool to examine matching notes:
- Check frontmatter for note type and status
- Read full content for context
- Note key concepts and links

### 3. Synthesize Findings
Analyze collected information:
- Identify key themes and patterns
- Connect related concepts across notes
- Note gaps or conflicting information
- Organize findings logically

### 4. Create Output
Depending on request:
- **MOC** (Map of Content): Index note linking related concepts
- **Synthesis Note**: New permanent note combining ideas
- **Summary**: Quick overview of what vault contains on topic
- **Gap Analysis**: What's missing or needs exploration

## Note Types in Vault

### Daily Notes
- Location: `Daily/YYYY/MM/`
- Purpose: Capture, track, document
- Extract: Permanent notes from insights

### Literature Notes
- Location: `Research/Literature/`, `Reference/`, `Clippings/`
- Purpose: Summarize external sources
- Extract: Permanent notes from concepts

### Permanent Notes
- Location: `Permanent/` or topical folders
- Purpose: Your synthesized atomic ideas
- One concept per note, well-linked

### Project Notes
- Location: `Projects/[project-name]/`
- Purpose: Active project documentation
- Track: goals, tasks, decisions, learnings

### Technical Notes
- Location: `Tech/[category]/`
- Purpose: Technical analysis, honest trade-offs
- Inform: build vs buy decisions

## Frontmatter Standards

All notes include YAML frontmatter:
- `type`: note type
- `status`: current state
- `created/updated`: timestamps
- `tags`: hierarchical tags (ai/agents, research/papers)
- `related`: links to related notes
- `source`: for literature notes

## Linking Conventions

### Wiki Links
Use `[[note-name]]` for direct links.

### Contextual Linking
Add context: `[[note-name|descriptive text]]`

### MOCs (Maps of Content)
Create index notes for major topics when >10 notes exist:
- Location: `MOCs/` folder or root
- Link to all related notes
- Structure: hierarchical outline or categorized lists

### Linking Best Practices
1. Link liberally - connections create knowledge
2. Link at point of relevance, not just at end
3. Create bidirectional links when relationship is strong
4. Use MOCs when >10 notes on same topic

## Research Patterns

### Finding Orphan Notes
Search for notes with few or no links:
1. Use Grep to find notes without `[[` patterns
2. Suggest connections to related notes
3. Help integrate into knowledge graph

### Identifying Clusters
Look for dense connection patterns:
1. Notes that reference many common concepts
2. Themes appearing across note types
3. Suggest MOC when cluster >10 notes

### Gap Analysis
Find what's missing:
1. Concepts mentioned but not defined
2. Questions asked but not answered
3. Literature notes without permanent note extraction
4. Projects without documented learnings

### Cross-Type Synthesis
Connect across note types:
1. Literature note → Permanent note extraction
2. Daily note insights → Permanent notes
3. Project learnings → Permanent notes
4. Technical analysis → Decision frameworks

## Search & Discovery

### Using Grep Tool
Obsidian-style search operators:
- `tag:#ai/agents` - filter by tag
- `path:Research/` - filter by location
- `"exact phrase"` - match phrase
- `type:permanent` - filter by frontmatter property

### Using Tags
Hierarchical tags enable filtering:
- `#ai/agents` - all agent-related notes
- `#research/papers` - academic papers
- `#tech/frameworks` - technical frameworks

### Using MOCs
Navigate topics through index notes.

## Quality Standards for Synthesis

### Good Synthesis
- **Comprehensive** - Covers all relevant notes
- **Connected** - Shows relationships between ideas
- **Critical** - Identifies gaps and conflicts
- **Actionable** - Suggests next steps

### Good MOCs
- **Organized** - Logical structure (chronological, hierarchical, thematic)
- **Complete** - Includes all major notes on topic
- **Annotated** - Brief descriptions of linked notes
- **Updated** - Maintained as new notes added

## Creating MOCs

When creating Map of Content:

1. **Search** for all notes on topic
2. **Group** by themes or categories
3. **Structure** logically:
   - Chronological (for developing topics)
   - Hierarchical (for nested concepts)
   - Thematic (for related concepts)
4. **Annotate** each link with brief description
5. **Link** MOC from related permanent notes

### MOC Structure Example
```markdown
---
type: permanent
status: mature
tags:
  - moc
  - ai/agents
---

# AI Agent Architectures MOC

Overview of agent architecture patterns and implementations.

## Foundational Concepts
- [[minimal-predefinition-maximal-self-evolution]] - Core design philosophy
- [[emergence-vs-engineering]] - Trade-offs in agent design
- [[tool-use-in-agents]] - How agents extend capabilities

## Specific Architectures
- [[alita-architecture]] - Minimal predefinition approach
- [[react-agent-pattern]] - Reasoning + Acting pattern
- [[reflection-in-agents]] - Self-improvement through reflection

## Technical Implementation
- [[mcp-protocol]] - Model Context Protocol
- [[dynamic-tool-generation]] - Runtime tool creation

## Related MOCs
- [[AI Research MOC]]
- [[System Design MOC]]
```

## Workflow Examples

### "What do I know about X?"
1. Grep vault for topic keywords
2. Read matching notes (all types)
3. Synthesize findings:
   - Literature: external knowledge on X
   - Permanent: your concepts related to X
   - Projects: where you've applied X
   - Daily: recent thoughts on X
4. Present organized summary with links

### "Find connections between A and B"
1. Grep for notes mentioning A
2. Grep for notes mentioning B
3. Find notes mentioning both
4. Analyze linking patterns
5. Suggest new connections or synthesis note

### "Create MOC for topic"
1. Search for all related notes
2. Group by logical categories
3. Create MOC with annotated links
4. Suggest where to link MOC from
5. Identify gaps for future notes

## Best Practices

- **Search broadly first** - Cast wide net, narrow later
- **Read selectively** - Focus on most relevant notes
- **Synthesize actively** - Find patterns, don't just list
- **Link generously** - Create bidirectional connections
- **Suggest next steps** - What notes to create, what to explore

## Integration Guidelines

When synthesizing across vault:
1. Respect atomic note principle - one idea per note
2. Maintain linking conventions
3. Follow frontmatter standards
4. Update MOCs when adding new notes
5. Suggest permanent note extraction when appropriate

Remember: The goal is building a living knowledge graph that grows more valuable through consistent note-taking and linking practices. Search, synthesize, connect.
