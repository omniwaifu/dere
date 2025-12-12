# dere

Personality-layered wrapper for Claude Code with optional daemon services (memory/emotions/knowledge graph) and plugins for different workflows (coding, productivity, vaults).

Core thesis: squeeze real utility out of the subscription (coding, tasks, research, notes) without the default assistant voice.

## What it does

- Wraps Claude Code CLI and injects personality + context via plugins
- Optionally runs a daemon for persistence (sessions, emotions, graph, missions)
- Enables workflow-specific behaviors via plugins (auto/always/never)

## Quickstart

### Prereqs

- Python 3.13+, `uv`, `just`
- Claude Code CLI installed and working
- `bun` (required by `just install`; also used for UI + some MCP tooling)
- PostgreSQL (daemon state)
- Docker (optional; used for FalkorDB via `just falkordb`)

### Install

```bash
just install
```

### Run

```bash
# CLI wrapper (passes through to Claude Code unless you use subcommands)
dere

# Daemon + services
just dev                    # daemon only
just dev-all                # daemon + discord bot (+ UI via Procfile)

# Configuration
dere config show
dere config edit
```

## Configuration

- Config file: `~/.config/dere/config.toml`
- Example: `config.toml.example`

Common gotchas:
- `DATABASE_URL` / `[database].url` must point at your Postgres instance
- Knowledge graph requires `OPENAI_API_KEY` (embeddings) and FalkorDB running

## Plugins

- `dere-core`: personality + baseline context (always)
- `dere-code`: coding workflow automation (auto; Serena + Context7)  
  Docs: `src/dere_plugins/dere_code/README.md`
- `dere-productivity`: GTD tasks/calendar/activity tooling (opt-in)  
  Setup: `src/dere_plugins/dere_productivity/CALENDAR_SETUP.md`
- `dere-vault`: Obsidian/Zettelkasten workflows (opt-in)  
  Docs: `src/dere_plugins/dere_vault/README.md`
- `dere-graph-features`: graph extraction/visualization affordances (auto when daemon)

## Repo layout

```
src/
├── dere_cli/          # CLI wrapper (entry: `dere`)
├── dere_daemon/       # FastAPI daemon (state, missions, graph init)
├── dere_discord/      # Discord bot
├── dere_ambient/      # Proactive monitoring/notifications
├── dere_graph/        # Knowledge graph library (FalkorDB + OpenAI embeddings)
├── dere_shared/       # Shared config/utilities
├── dere_ui/           # React/Vite UI
└── dere_plugins/      # Claude Code plugins (modes, agents, commands, output styles)
```

## Dev commands

```bash
just test       # pytest
just lint       # ruff check
just fmt        # ruff format
just dev        # run daemon
just dev-all    # daemon + discord (+ UI via Procfile)
just ui         # UI dev server
just falkordb   # graph DB in docker
```

## Docs

- Graph: `src/dere_graph/README.md`
- UI: `src/dere_ui/README.md`
