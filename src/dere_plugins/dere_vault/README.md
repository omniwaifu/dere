# dere-vault Plugin

Zettelkasten knowledge vault skills for working with Obsidian-style markdown vaults.

## Skills

### capture
Quick capture of thoughts, tasks, and daily reflections for later processing.

**Use when:**
- Creating daily notes
- Journaling
- Tracking daily work
- Morning/evening planning

### source
Summarize articles, papers, books, and videos in your own words with proper citations.

**Use when:**
- Processing URLs or external content
- Creating literature notes
- Building research bibliography

### extract
Extract atomic concepts from daily notes and sources into densely-linked evergreen notes.

**Use when:**
- Identifying reusable ideas
- Creating permanent notes
- Processing fleeting notes
- Synthesizing insights

### research
Search vault, synthesize findings, analyze technologies, track projects, and create Hubs.

**Use when:**
- Researching topics across vault
- Creating Hubs (overview notes)
- Documenting technical decisions
- Finding connections between notes

## Installation

This plugin is included with dere. Activate vault output style:

```bash
dere --output-style vault
```

## Configuration

Vault detection is automatic via `scripts/detect_vault.py`. Override in `~/.config/dere/config.toml`:

```toml
[vault]
path = "/path/to/your/vault"
```

## Skill Structure

Each skill includes:
- **SKILL.md** - Core workflow and activation triggers
- **REFERENCE.md** - Technical specifications (frontmatter, formats)
- **examples/** - Good/bad pattern examples
- **tools/** - Helper scripts (research skill only)

## Zettelkasten Workflow

1. **Capture** → Quick daily notes (fleeting thoughts)
2. **Source** → Literature notes from external content
3. **Extract** → Permanent notes (atomic concepts)
4. **Research** → Cross-vault synthesis and Hubs

Process fleeting notes within 1-2 days to maintain flow.

## Quality Guidelines

**Good permanent notes:**
- Atomic (one concept)
- Autonomous (makes sense alone)
- Linked (5-10+ connections)
- Example-rich (2+ concrete instances)
- Searchable titles

**Avoid:**
- Multiple concepts bundled
- Copy-paste without understanding
- Orphaned notes (no links)
- Vague abstractions without examples

## Tools

### link_analysis.py
Analyze knowledge graph health:

```bash
# Show vault statistics
./scripts/link_analysis.py --stats

# Find orphaned notes (< 3 links)
./scripts/link_analysis.py --orphans

# Suggest connections for a note
./scripts/link_analysis.py --suggest "Note Title"
```

### concept_search.py
Search for similar permanent notes:

```bash
./scripts/concept_search.py "concept name"
```

## References

- Ahrens, Sönke. *How to Take Smart Notes* (2017)
- [Zettelkasten Method](https://zettelkasten.de/)
