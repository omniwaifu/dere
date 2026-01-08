# dere

## NAME

dere - personality-layered Claude Code wrapper with daemon services

## SYNOPSIS

```
dere [claude-code-args...]
dere config show|edit
just dev|dev-all|ui|falkordb
```

## DESCRIPTION

Wraps Claude Code CLI with personality injection and optional daemon (sessions, emotions, knowledge graph). Plugins enable workflow-specific behaviors.

## DEPENDENCIES

- bun, uv, just
- Claude Code CLI
- PostgreSQL
- Docker (optional, for FalkorDB)

## INSTALL

```
just install
```

## COMMANDS

```
just dev          daemon only
just dev-all      daemon + discord + telegram + ui
just ui           ui dev server
just falkordb     start graph db
just test         run tests
just lint         oxlint
just fmt          oxfmt
```

## FILES

```
~/.config/dere/config.toml    main config
config.toml.example           template
```

## ENVIRONMENT

```
DERE_PROJECT_PATH    path to dere repo (required for MCP servers)
DATABASE_URL         postgresql connection string
OPENAI_API_KEY       knowledge graph embeddings
```

## PLUGINS

```
dere-core           personality + context (always)
dere-code           coding workflow, Serena + Context7 (auto)
dere-productivity   GTD/calendar/tasks (opt-in)
dere-vault          Obsidian/Zettelkasten (opt-in)
```

## LAYOUT

```
packages/
  daemon/           hono server
  daemon-client/    trpc + ws client
  discord/          discord bot
  telegram/         telegram bot
  dere-graph/       falkordb service
  shared-*/         config, llm, runtime
  ui/               react/vite
plugins/
  dere_*/           claude code plugins
```

## SEE ALSO

- `plugins/dere_code/README.md`
- `plugins/dere_productivity/CALENDAR_SETUP.md`
- `plugins/dere_vault/README.md`
- `packages/ui/README.md`
