# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

Personality wrapper for Claude CLI with conversation memory, embeddings, and mental health tracking.

**Why:** I use Claude Code for everything and want it "in character" when I load up a terminal.

## Installation

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

**Requirements:**
- [Claude CLI](https://github.com/anthropics/claude-cli)
- Python 3.13+
- [uv](https://github.com/astral-sh/uv)
- [Ollama](https://ollama.ai) (optional, for embeddings)

## Usage

```bash
dere --personality tsun          # Tsundere (harsh but caring)
dere -P kuu                      # Kuudere (cold analytical)
dere --personality yan           # Yandere (overly helpful)
dere -P dere                     # Deredere (actually nice)
dere --bare                      # Plain Claude

# Mental health modes
dere --mode checkin              # Daily check-in
dere --mode cbt                  # CBT session
dere --mode therapy              # Therapy session

# Features
dere --context                   # Add time/date/weather context
dere -c                          # Continue previous conversation
dere --prompts=rust,security     # Load custom prompts
dere --mcp=dev                   # Use MCP profile
```

## Discord Bot (Experimental)

```bash
uv run dere-discord --persona tsun
```

Configure via `~/.config/dere/config.toml`:

```toml
[discord]
token = "your-discord-bot-token"
default_persona = "tsun"
allowed_guilds = ""
allowed_channels = ""
idle_timeout_seconds = 1200
summary_grace_seconds = 30
context_enabled = true
```

## Ambient Monitoring

Dere can proactively reach out based on your activity patterns using [ActivityWatch](https://activitywatch.net/).

**Features:**
- Monitors your activity and idle time
- Decides when to check in based on context
- Routes notifications to Discord, desktop, or other mediums
- Uses conversation history to provide contextual engagement

**Configuration:**

```toml
[ambient]
enabled = true
check_interval_minutes = 30      # How often to check activity
idle_threshold_minutes = 60      # Min idle time before engaging
notification_method = "both"     # "notify-send", "daemon", or "both"
```

**Note:** Requires daemon to be running (`dere daemon start`)

## Configuration

**Config:** `~/.config/dere/` (Linux), `~/Library/Application Support/dere/` (macOS)
**Data:** `~/.local/share/dere/` (Linux), `~/Library/Application Support/dere/` (macOS)

### Custom Personalities

Create `~/.config/dere/personalities/custom.toml`:

```toml
[metadata]
name = "custom"
aliases = ["custom"]

[display]
color = "cyan"
icon = "●"

[prompt]
content = """
Your personality description here...
"""
```

### Custom Prompts

Add `.md` files to `~/.config/dere/prompts/` for domain-specific knowledge.

### Daemon

```bash
dere daemon start                # Start background processor
dere daemon status               # Show status
dere queue list                  # List pending tasks
```

## Development

```bash
just build      # Build with uv
just test       # Run tests
just lint       # Lint with ruff
just fmt        # Format code
```
