# dere

Personality-layered wrapper for Claude Code with conversation persistence.

## Structure

```
src/
├── dere_cli/          # Main CLI wrapper
├── dere_daemon/       # Background processing
├── dere_discord/      # Discord bot
├── dere_obsidian/     # Obsidian integration
├── dere_ambient/      # Proactive monitoring
├── dere_shared/       # Shared utilities
└── dere_plugins/      # Claude Code plugins
    ├── dere_personality/   # Core skills (emotion, memory, wellness)
    └── dere_vault/    # Zettelkasten skills
```

## Install

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

Requires Python 3.13+, [uv](https://github.com/astral-sh/uv), and [Claude CLI](https://github.com/anthropics/claude-cli).

## Build

```bash
just build      # Build with uv
just test       # Run tests
just lint       # Lint with ruff
just fmt        # Format code
```
