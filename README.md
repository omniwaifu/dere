# dere

Wrapper for Claude Code that adds personality, plugins, knowledge graph, and prompts for different workflows. The core thesis of this project is 'I pay for a subscription, I might as well wring every dollar of value I can' while utilizing it for things such as task management, note-taking (anki, obsidian, etc.), news analysis, etc. - all in a 'personality' that's less grating than default.

## What it does

- Wraps Claude Code CLI with emotional context and conversation persistence
- Plugin system for conditional features (productivity tools, Zettelkasten vault, symbol-aware coding)
- Background daemon for conversation memory, emotion tracking, and knowledge graph
- MCP servers for Taskwarrior, Google Calendar, ActivityWatch, Zotero, and library documentation

## Install

Requires Python 3.13+, [uv](https://github.com/astral-sh/uv), and [Claude Code](https://github.com/anthropics/claude-cli).

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

## Usage

```bash
# Basic (core personality only)
dere

# Start background daemon
just dev                    # daemon only
just dev-all                # daemon + discord bot

# Daemon management
dere daemon start
dere daemon stop
dere daemon status

# Configuration
dere config show            # view config
dere config path            # show config file location
dere config edit            # edit in $EDITOR
```

## Plugins

Plugins are enabled based on mode or directory context.

### dere-core (Always Active)

Kuudere personality with environmental context.

- Time, weather, and recent files tracking
- OCC emotion model (requires daemon)
- Knowledge graph integration (requires daemon)
- Conversation memory and recall

### dere-productivity (Opt-in)

GTD task management, calendar, and activity tracking.

- Taskwarrior integration
- Google Calendar (OAuth setup required)
- ActivityWatch time tracking
- Daily planning/review workflows

Enable: `dere --mode productivity` or in config.

See [CALENDAR_SETUP.md](src/dere_plugins/dere_productivity/CALENDAR_SETUP.md) for Google Calendar setup.

### dere-code (Auto)

Symbol-aware code navigation and refactoring via Serena LSP.

- Symbol-level navigation and refactoring
- Codebase onboarding and analysis
- Up-to-date library docs via Context7
- Project knowledge persistence

Auto-enabled in configured directories (default: `/mnt/data/Code`).

### dere-vault (Opt-in)

Zettelkasten workflows for Obsidian vaults.

- Literature notes with Zotero integration
- Permanent notes and concept extraction
- Backlink analysis and note linking
- Research hub creation

Enable: `dere --mode vault` or when in vault directory.

### dere-graph-features (Auto)

Knowledge graph visualization. Auto-enabled when daemon is running.

## Configuration

Config file: `~/.config/dere/config.toml`

```toml
[plugins.dere_core]
mode = "always"

[plugins.dere_productivity]
mode = "never"  # "always", "never", or "auto"

[plugins.dere_code]
mode = "auto"
directories = ["/mnt/data/Code"]

[plugins.dere_vault]
mode = "never"

[context]
time = true
weather = true
recent_files = true
knowledge_graph = true  # requires daemon
```

## Development

```bash
just build      # sync dependencies
just test       # run tests
just lint       # run ruff
just fmt        # format code
just dev        # run daemon
just dev-all    # run all services
```

## Project Structure

```
src/
├── dere_cli/          # CLI wrapper
├── dere_daemon/       # Background daemon (FastAPI)
├── dere_discord/      # Discord bot
├── dere_ambient/      # Proactive monitoring
├── dere_graph/        # Knowledge graph (pgvector)
├── dere_shared/       # Shared utilities
├── dere_ui            # React/Vite UI 
└── dere_plugins/      # Claude Code plugins
    ├── dere_core/         # Core personality (always-on)
    ├── dere_productivity/ # Productivity suite
    ├── dere_code/         # Symbol-aware coding
    ├── dere_vault/        # Zettelkasten integration
    └── dere_graph_features/
```
