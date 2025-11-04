# dere-vault

Claude Code plugin providing Zettelkasten knowledge vault skills.

## What is this?

This plugin teaches Claude Code how to work with Zettelkasten-style knowledge vaults (like Obsidian). Instead of using CLAUDE.md files scattered throughout your vault, the plugin provides structured skills that guide Claude on creating and managing different note types.

## Skills Provided

### zettelkasten-daily-notes
Create and process daily journal entries for task tracking and thought capture.

**Use when:**
- Creating daily notes
- Processing daily entries
- Extracting insights from daily reflections

### zettelkasten-literature-notes
Summarize and analyze external sources (papers, articles, books, videos).

**Use when:**
- Processing URLs or papers
- Creating research summaries
- Building literature review

### zettelkasten-permanent-notes
Create atomic, evergreen ideas that form your knowledge graph.

**Use when:**
- Extracting concepts from literature/daily notes
- Synthesizing original insights
- Building reusable knowledge

### zettelkasten-project-notes
Track active projects with goals, decisions, and learnings.

**Use when:**
- Starting new projects
- Documenting project progress
- Tracking decisions and learnings

### zettelkasten-technical-notes
Analyze technologies with honest trade-off evaluation.

**Use when:**
- Evaluating frameworks or tools
- Documenting technical decisions
- Creating implementation guides

### vault-research-synthesis
Search across vault, synthesize findings, create MOCs.

**Use when:**
- Researching topics across vault
- Finding connections between notes
- Creating Maps of Content

## Installation

1. The plugin is part of the dere monorepo
2. Install with: `uv pip install -e .`
3. Claude Code will auto-detect the plugin

## Helper Scripts

- `detect_vault.py` - Check if CWD is in a vault
- `get_vault_context.py` - Load vault context from CLAUDE.md (legacy)
- `config_reader.py` - Read personality/daemon settings

## Configuration (Optional)

Create `~/.config/dere/config.json`:

```json
{
  "default_personality": "tsun",
  "daemon_url": "http://localhost:8080",
  "enable_daemon": false,
  "vaults": {
    "/path/to/vault": {
      "personality": "kuudere",
      "enable_daemon": true
    }
  }
}
```

## Migrating from CLAUDE.md

This plugin replaces the need for CLAUDE.md files in your vault. The skills contain all the instructions that were previously in:

- `/CLAUDE.md` → `vault-research-synthesis` skill
- `/Daily/CLAUDE.md` → `zettelkasten-daily-notes` skill
- `/Research/CLAUDE.md` → `zettelkasten-literature-notes` skill
- `/Permanent/CLAUDE.md` → `zettelkasten-permanent-notes` skill
- `/Projects/CLAUDE.md` → `zettelkasten-project-notes` skill
- `/Tech/CLAUDE.md` → `zettelkasten-technical-notes` skill

After confirming the skills work, you can remove the CLAUDE.md files.

## How It Works

Claude Code loads skills from plugins and automatically applies them based on context. The skills teach Claude:

- Note structures and frontmatter requirements
- Quality standards for each note type
- Linking conventions and best practices
- When to use Read/Grep/Write tools
- How to synthesize across multiple notes

## vs dere-obsidian

- **dere-obsidian**: FastAPI server for Obsidian QuickAdd plugin integration
- **dere-vault**: Skills for Claude Code CLI/desktop

Both can coexist and serve different use cases.
