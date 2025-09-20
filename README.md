# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

Layered AI assistant with composable personalities for Claude CLI, featuring conversation memory via embeddings, intelligent message summarization, and LLM-based entity extraction.

**Why:** I use Claude Code for everything and want it "in character" when I load up a terminal, e.g. `dere --personality tsun --mcp=spotify`

## Features

- **Personality layers**: Tsundere, kuudere, yandere, deredere, and more
- **Conversation memory**: Automatic embedding generation and similarity search
- **Entity extraction**: LLM-based semantic extraction of technologies, people, concepts, and relationships
- **Progressive summarization**: Zero-loss intelligent summarization for long conversations using dynamic context limits
- **Intelligent summarization**: Long messages automatically summarized for better embeddings
- **Context awareness**: Time, date, weather, and activity tracking
- **MCP management**: Independent MCP server configuration with profiles and smart filtering
- **Output styles**: Orthogonal output style layer (e.g., teaching mode, verbose mode)
- **Dynamic commands**: Personality-specific slash commands auto-generated per session
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

### Quick Install

```bash
git clone https://github.com/yourusername/dere.git
cd dere
just install  # or 'make install' if you prefer make
```

This will:
- Build the main dere binary
- Install dere binary and Python hook scripts to ~/.local/bin
- Set up conversation capture, session summarization, and daemon communication automatically

### Manual Setup

1. Build the project:
```bash
just build  # or 'make build'
```

2. Copy or link binaries and scripts to your PATH:
```bash
cp bin/dere ~/.local/bin/  # or /usr/local/bin/
cp hooks/python/dere-hook.py ~/.local/bin/dere-hook
cp hooks/python/dere-hook-session-end.py ~/.local/bin/dere-hook-session-end
cp hooks/python/dere-statusline.py ~/.local/bin/dere-statusline
cp hooks/python/dere-stop-hook.py ~/.local/bin/dere-stop-hook
cp hooks/python/rpc_client.py ~/.local/bin/
chmod +x ~/.local/bin/dere-*
```

3. Configure Ollama (optional, for conversation embeddings):
```toml
# ~/.config/dere/config.toml
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500  # Characters before attempting summarization
```

4. Configure Weather (optional):
```toml
# ~/.config/dere/config.toml
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

### Advanced Features
```bash
dere --context                    # Add time/date/weather/activity context
dere -c                          # Continue previous conversation
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

### Custom Prompts
Place `.md` files in `~/.config/dere/prompts/`:
```bash
~/.config/dere/prompts/rust.md     # --prompts=rust
~/.config/dere/prompts/security.md # --prompts=security
```

### MCP Servers
Managed independently in `~/.config/dere/mcp_config.json`

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
```

### Daemon & Queue Management
Background processing for embeddings, summarization, and other LLM tasks:

```bash
# Daemon management
dere daemon start                  # Start background task processor
dere daemon stop                   # Stop the daemon
dere daemon restart                # Restart daemon (hot reload)
dere daemon status                 # Show daemon status and queue stats
dere daemon reload                 # Reload configuration (SIGHUP)

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
Conversations are automatically stored in `~/.local/share/dere/conversations.db` using Turso/libSQL with vector embeddings for similarity search.

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
│       ├── dere-statusline.py   # Status line display
│       ├── dere-stop-hook.py    # Stop hook for capture
│       └── rpc_client.py        # RPC communication client
├── prompts/                     # Built-in personality prompts
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
```

## Notes

- Database and embeddings are created automatically on first use
- Ollama is optional but enables conversation similarity search and progressive summarization
- Works alongside existing Claude CLI configuration without modifying global settings
- Dynamic settings generation via `--settings` flag keeps Claude config clean
- Personality commands (e.g., `/dere-tsun-rant`) are created per session in `~/.claude/commands/`
- MCP configuration is independent from Claude Desktop for better control
- Progressive summarization uses dynamic context length querying for zero information loss
- Background daemon processes tasks efficiently with model switching optimization
- Full Claude CLI compatibility through passthrough flag support
- Status line shows real-time personality and queue statistics
- Vector search uses cosine similarity for finding related conversations
- **Python hooks**: Conversation capture and processing now use Python scripts instead of Go binaries for easier development and customization
- **RPC communication**: Hooks communicate with the daemon via RPC for efficient background processing
- **Stop hook**: New stop hook captures Claude responses for improved conversation continuity

## License

MIT