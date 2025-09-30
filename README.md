# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

Layered AI assistant with composable personalities for Claude CLI, featuring conversation memory via embeddings, intelligent message summarization, LLM-based entity extraction, and comprehensive mental health and wellness tracking.

**Why:** I use Claude Code for everything and want it "in character" when I load up a terminal, e.g. `dere --personality tsun --mcp=spotify`

## Features

- **Personality layers**: Tsundere, kuudere, yandere, deredere, and more
- **Mental health modes**: Specialized modes for checkin, CBT, therapy, mindfulness, and goal tracking
- **Wellness data tracking**: Automatic mood, energy, and stress monitoring with structured data storage
- **ActivityWatch integration**: MCP server for real-time activity and behavior monitoring
- **Conversation memory**: Automatic embedding generation and similarity search
- **Entity extraction**: LLM-based semantic extraction of technologies, people, concepts, and relationships
- **Progressive summarization**: Zero-loss intelligent summarization for long conversations using dynamic context limits
- **Semantic session continuation**: Intelligent context building from previous conversations using similarity search
- **Intelligent summarization**: Long messages automatically summarized for better embeddings
- **Context awareness**: Time, date, weather, and activity tracking
- **MCP management**: Independent MCP server configuration with profiles and smart filtering
- **Output styles**: Orthogonal output style layer (e.g., teaching mode, verbose mode)
- **Custom personalities**: User-overridable TOML-based personality system with display customization
- **Custom prompts**: Add your own domain-specific knowledge
- **Vector search**: Turso/libSQL database with native vector similarity
- **Background processing**: Daemon with task queue for embeddings and summarization
- **Claude CLI compatibility**: Full passthrough support for Claude flags like `-p`, `--debug`, `--verbose`
- **Status line**: Real-time personality and queue status display

## Installation

### Requirements

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+ (for building)
- Python 3.8+ (for hook scripts)
- [Just](https://github.com/casey/just) (optional, for modern build commands)
- [Ollama](https://ollama.ai) (optional, for embeddings and summarization)
- [rustormy](https://github.com/yourusername/rustormy) (optional, for weather context)
- [ActivityWatch](https://activitywatch.net/) (optional, for activity monitoring and wellness tracking)

### Quick Install (Linux/macOS)

```bash
git clone https://github.com/yourusername/dere.git
cd dere
just install
```

This will:
- Build the main dere binary
- Install dere binary and Python hook scripts to ~/.local/bin (Linux) or ~/Library/Application Support (macOS)
- Set up conversation capture, session summarization, and daemon communication automatically

### Manual Setup

#### Linux/macOS

1. Build the project:
```bash
just build
```

2. Copy binaries and scripts to your PATH:
```bash
cp bin/dere ~/.local/bin/  # or /usr/local/bin/
cp hooks/python/*.py ~/.local/bin/
chmod +x ~/.local/bin/dere-*.py
```

#### Windows

1. Build the project:
```powershell
go build -o bin\dere.exe cmd\dere\main.go
```

2. Add `bin` directory to your PATH, or copy to a location in PATH:
```powershell
copy bin\dere.exe %LOCALAPPDATA%\Programs\
copy hooks\python\*.py %LOCALAPPDATA%\Programs\
```

3. Ensure Python is associated with `.py` files, or use `python` prefix when Claude CLI invokes hooks

3. Configure Ollama (optional, for conversation embeddings):
```toml
# config.toml in config directory (see File Locations section)
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500  # Characters before attempting summarization
```

4. Configure Weather (optional):
```toml
# config.toml in config directory (see File Locations section)
[weather]
enabled = true
location = "London, UK"
units = "metric"  # or "imperial"
```

## Usage

### Basic Personalities
```bash
dere --personality tsun           # Tsundere mode (harsh but caring)
dere -P kuu                       # Kuudere (cold analytical)
dere --personality yan            # Yandere (overly helpful)
dere -P dere                      # Deredere (actually nice)
dere --personality ero            # Erodere (playfully teasing)
dere --bare                       # Plain Claude, no personality

# Multiple personalities
dere -P tsun,kuu                  # Combine tsundere + kuudere
dere --personality "yan,ero"       # Combine yandere + erodere
```

### Mental Health & Wellness Modes
```bash
dere --mode checkin               # Daily mental health check-in
dere --mode cbt                   # Cognitive behavioral therapy session
dere --mode therapy               # General therapy session
dere --mode mindfulness           # Mindfulness and meditation guidance
dere --mode goals                 # Goal setting and tracking

# Combine with personalities for different therapeutic styles
dere --mode therapy -P yan        # Overly caring therapist
dere --mode cbt -P kuu            # Clinical, analytical CBT approach
dere --mode checkin -P dere       # Warm, encouraging check-ins
```

### Advanced Features
```bash
dere --context                    # Add time/date/weather/activity context
dere -c                          # Continue previous conversation
dere --context-depth=10          # Control depth of semantic context search
dere --context-mode=smart        # Set context mode (summary/full/smart)
dere --prompts=rust,security     # Load custom prompts
dere --mcp=dev                   # Use MCP profile (e.g., dev, media)
dere --mcp="linear,obsidian"      # Use specific MCP servers
dere --mcp="tag:media"            # Use MCP servers by tag
dere --output-style=verbose      # Change Claude's output style

# Claude CLI passthrough (full compatibility)
dere -p "hello world"             # Print mode (non-interactive)
dere --debug api                 # Debug mode with filtering
dere --verbose                   # Verbose output mode
dere --output-format json        # JSON output format
```

### Combining Layers
```bash
dere -P tsun --context                    # Tsundere + context aware
dere --personality kuu --mcp=spotify     # Cold + Spotify control
dere -P yan --output-style=terse         # Yandere + brief responses
dere --prompts=go --context              # Go expertise + context
dere -P tsun,kuu -p "fix this code"      # Multiple personalities + print mode
```

## Configuration

### File Locations

dere follows platform conventions for storing configuration and data files:

**Linux/Unix:**
- Config: `~/.config/dere/`
- Data: `~/.local/share/dere/`

**macOS:**
- Config: `~/Library/Application Support/dere/`
- Data: `~/Library/Application Support/dere/`

**Windows:**
- Config: `%LOCALAPPDATA%\dere\`
- Data: `%LOCALAPPDATA%\dere\`

### Custom Personalities
Personalities are defined in TOML files with prompts, display colors, and icons.

**Built-in personalities** (embedded in binary):
- `tsun` (tsundere) - Harsh but caring, red
- `kuu` (kuudere) - Cold analytical, blue
- `yan` (yandere) - Obsessively helpful, magenta
- `dere` (deredere) - Genuinely sweet, green
- `ero` (erodere) - Playfully teasing, yellow

**Create custom personalities** in the config directory under `personalities/`:
```toml
# Linux: ~/.config/dere/personalities/custom.toml
# macOS: ~/Library/Application Support/dere/personalities/custom.toml
# Windows: %LOCALAPPDATA%\dere\personalities\custom.toml
[metadata]
name = "custom-personality"
short_name = "custom"
aliases = ["custom", "my-personality"]

[display]
color = "cyan"        # Status line color
icon = "●"            # Status line icon

[prompt]
content = """
# Personality: Custom

Your personality description here...

## Core Traits:
- Trait 1
- Trait 2
"""
```

Usage: `dere --personality custom`

### Custom Prompts
Add domain-specific knowledge as `.md` files in the config directory under `prompts/`:
- **Linux/Unix:** `~/.config/dere/prompts/rust.md`
- **macOS:** `~/Library/Application Support/dere/prompts/rust.md`
- **Windows:** `%LOCALAPPDATA%\dere\prompts\rust.md`

### MCP Servers
Managed independently in the config directory as `mcp_config.json`

```bash
# MCP management commands
dere mcp list                      # List configured servers
dere mcp profiles                  # Show available profiles
dere mcp add <name> <command>      # Add new server
dere mcp remove <name>             # Remove server
dere mcp copy-from-claude          # Import from Claude Desktop

# Using MCP servers
dere --mcp=dev                     # Use 'dev' profile
dere --mcp="linear,obsidian"       # Use specific servers
dere --mcp="*spotify*"             # Pattern matching
dere --mcp="tag:media"             # Tag-based selection
dere --mcp=activitywatch           # Enable ActivityWatch for wellness tracking
```

### Daemon & Queue Management
Background processing for embeddings, summarization, and other LLM tasks:

```bash
# Daemon management
dere daemon start                  # Start background task processor
dere daemon stop                   # Stop the daemon
dere daemon restart                # Restart daemon (hot reload)
dere daemon status                 # Show daemon status, PID, and queue stats
dere daemon reload                 # Reload configuration (SIGHUP, Linux/macOS only)

# Queue management
dere queue list                    # List pending tasks
dere queue stats                   # Show queue statistics
dere queue process                 # Manually process pending tasks
```

### Session Summaries
View and manage automatically generated session summaries:

```bash
# Summary management
dere summaries list                # List all session summaries
dere summaries list --project=/path  # Filter by project path
dere summaries show <id>           # Show detailed summary
dere summaries latest              # Show most recent summary
```

### Wellness Data Management
Track and analyze mental health data automatically extracted from sessions:

```bash
# Wellness data management
dere wellness history              # View wellness data history
dere wellness history --days=7     # Last 7 days of wellness data
dere wellness history --mode=cbt   # Filter by specific mode
dere wellness trends               # Show wellness trends and patterns
dere wellness export               # Export wellness data
```

### Entity Management
Extracted entities from conversations are automatically stored and can be managed with CLI commands:

```bash
# Entity management commands
dere entities list                 # List all extracted entities
dere entities list --type=technology  # Filter by entity type
dere entities list --project=/path    # Filter by project path
dere entities search "react"       # Search entities by value
dere entities graph                # Show entity relationship graph
dere entities graph React          # Show relationships for specific entity
```

### Conversation Database
Conversations are automatically stored in the data directory as `dere.db` using Turso/libSQL with vector embeddings for similarity search:
- **Linux/Unix:** `~/.local/share/dere/dere.db`
- **macOS:** `~/Library/Application Support/dere/dere.db`
- **Windows:** `%LOCALAPPDATA%\dere\dere.db`

#### Message Processing
- Messages under 500 characters: Stored directly
- Messages 500-2000 characters: Light summarization preserving key terms
- Messages over 2000 characters: Extractive summarization for semantic search
- All embeddings use 1024-dimensional vectors from mxbai-embed-large

## Development

### Project Structure
```
dere/
├── cmd/
│   └── dere/                    # Main CLI entry point
├── src/
│   ├── commands/                # Dynamic command generation
│   ├── composer/                # Prompt composition
│   ├── config/                  # Configuration management
│   ├── daemon/                  # Background daemon server
│   ├── database/                # Turso/libSQL with vector search
│   ├── embeddings/              # Ollama embedding client
│   ├── mcp/                     # MCP server management
│   ├── settings/                # Claude settings generation
│   ├── taskqueue/               # Background task processing
│   └── weather/                 # Weather context integration
├── hooks/
│   └── python/                  # Python hook scripts
│       ├── dere-hook.py         # Conversation capture hook
│       ├── dere-hook-session-end.py  # Session end hook
│       ├── dere-wellness-hook.py # Wellness data extraction hook
│       ├── dere-statusline.py   # Status line display
│       ├── dere-stop-hook.py    # Stop hook for capture
│       └── rpc_client.py        # RPC communication client
├── mcp/                         # MCP servers
│   └── dere_mcp/               # ActivityWatch MCP server
├── prompts/                     # Built-in personality prompts
│   ├── commands/               # Dynamic command prompts
│   └── modes/                  # Mental health mode prompts
└── scripts/                     # Installation scripts
```

### Building from Source
```bash
just build      # Build main binary
just clean      # Clean build artifacts
just install    # Build and install to ~/.local/bin
just test       # Run tests
just lint       # Run linting
just dev        # Start development daemon
just --list     # Show all available commands
```

Or use traditional make:
```bash
make build      # Build binaries
make clean      # Clean build artifacts
make install    # Build and install
```

### Database Schema
The conversation database uses libSQL's native vector type with progressive summarization support:
```sql
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    project_path TEXT,
    personality TEXT,
    prompt TEXT,
    embedding_text TEXT,
    processing_mode TEXT,
    prompt_embedding FLOAT32(1024),
    timestamp INTEGER,
    created_at TIMESTAMP
);

CREATE TABLE conversation_segments (
    id INTEGER PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id),
    segment_number INTEGER NOT NULL,
    segment_summary TEXT NOT NULL,
    original_length INTEGER NOT NULL,
    summary_length INTEGER NOT NULL,
    start_conversation_id INTEGER REFERENCES conversations(id),
    end_conversation_id INTEGER REFERENCES conversations(id),
    model_used TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, segment_number)
);

CREATE INDEX conversations_embedding_idx
ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'));

-- Wellness tracking tables
CREATE TABLE wellness_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    mode TEXT NOT NULL,
    mood INTEGER,
    energy INTEGER,
    stress INTEGER,
    key_themes TEXT,
    notes TEXT,
    homework TEXT,
    next_step_notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

## Notes

- Database and embeddings are created automatically on first use
- Ollama is optional but enables conversation similarity search and progressive summarization
- Works alongside existing Claude CLI configuration without modifying global settings
- Dynamic settings generation via `--settings` flag keeps Claude config clean
- Personalities are TOML-based and user-overridable (see File Locations section)
- Cross-platform support for Linux, macOS, and Windows with proper directory conventions
- MCP configuration is independent from Claude Desktop for better control
- Progressive summarization uses dynamic context length querying for zero information loss
- Background daemon processes tasks efficiently with model switching optimization and PID-based status monitoring
- Daemon cleans up stale files on startup and manages processes properly
- Context caching system with 30-minute TTL
- Session continuation uses embeddings and similarity search to find relevant context
- Full Claude CLI compatibility through passthrough flag support
- Status line shows real-time personality, daemon status, and queue statistics
- Vector search uses cosine similarity for finding related conversations
- **Python hooks**: Conversation capture and processing now use Python scripts instead of Go binaries for easier development and customization
- **RPC communication**: Hooks communicate with the daemon via RPC for efficient background processing
- **Stop hook**: New stop hook captures Claude responses for improved conversation continuity
- **Mental health modes**: Specialized prompts and workflows for therapeutic interactions with automatic wellness data extraction
- **Wellness tracking**: Automatic mood, energy, and stress monitoring with structured data storage and trend analysis
- **ActivityWatch integration**: MCP server provides real-time activity monitoring for comprehensive wellness insights
- **Session continuity**: Mental health sessions automatically reference previous sessions for continuity of care

