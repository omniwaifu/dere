---
name: research
description: Search vault, synthesize findings, analyze technologies, track projects, and create Hubs. Use when researching topics across vault, documenting technical decisions, managing projects, or finding connections between notes.
---

# Research Skill

Search across vault, synthesize findings from multiple notes, analyze technologies, track projects, and create Hub overview notes.

## When to Activate

- User mentions: "search vault", "what do I know about", "Hub", "analyze [tech]"
- Researching topics across vault
- Documenting technical decisions
- Project tracking and documentation
- Finding connections between notes
- Identifying orphan notes or gaps

## Core Workflow

1. **Search** - Find relevant notes via tags, links, or content search
2. **Review** - Read connected notes, identify patterns
3. **Synthesize** - Combine insights, note gaps
4. **Create output** - Hub, project note, tech analysis, or synthesis note

## Use Cases

### Cross-Vault Research
- Search by topic/tag
- Identify connections
- Note what's missing
- Create Hub if >10 related notes

### Technology Analysis
- Document tech evaluation
- Trade-offs and decisions
- Implementation notes
- Links to related concepts

### Project Tracking
- Project scope and status
- Technical decisions
- Links to relevant notes
- Next steps and blockers

## Output Types

**Hub (Overview Note):**
- Links to 10+ related notes
- Categorized/hierarchical structure
- Overview of topic area
- Gaps and open questions

**Tech Note:**
- Technology evaluation
- Trade-offs analysis
- When to use / avoid
- Implementation references

**Project Note:**
- Status and scope
- Technical decisions
- Progress tracking
- Related permanent notes

## Integration

- Uses permanent notes from **extract** skill
- References literature notes from **source** skill
- Identifies fleeting notes to process with **capture**/**extract**

## See Also

- REFERENCE.md for Hub patterns and search syntax
- examples/hub-example.md for Hub structure
- tools/create-hub.py for Hub generation
- tools/find-orphans.py for link analysis
