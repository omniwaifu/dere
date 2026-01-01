# Good README Example

Based on the dere project README that follows documentation standards.

````markdown
# dere

Wrapper for Claude Code that adds personality, context awareness, and a plugin system.

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
````

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

## Configuration

Config file: `~/.config/dere/config.toml`

```toml
[plugins.dere_core]
mode = "always"

[plugins.dere_productivity]
mode = "never"  # "always", "never", or "auto"

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
```

```

## Why This Works

### Factual Opening
- First line states exactly what it is
- No "Welcome to" or vision statements
- No marketing adjectives

### Clear What It Does
- Bullet list of actual functionality
- Concrete features, not vague promises
- Technical accuracy

### Practical Install
- Prerequisites with version numbers
- Links to required tools
- Copy-pasteable commands

### Real Usage Examples
- Actual commands that work
- Multiple use cases shown
- Comments explain variants

### Configuration Format
- Shows actual config file path
- Uses real TOML format
- Comments explain options

### Concise Structure
- Under 150 lines total
- Each section focused
- No walls of text
```
