# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

Layered AI assistant with composable personalities for Claude CLI, featuring conversation memory via embeddings, intelligent message summarization, and LLM-based entity extraction.

**Why:** I use Claude Code for everything and want it "in character" when I load up a terminal, e.g. `dere --tsun --mcp=spotify`

## Features

- **Personality layers**: Tsundere, kuudere, yandere, deredere, and more
- **Conversation memory**: Automatic embedding generation and similarity search
- **Entity extraction**: LLM-based semantic extraction of technologies, people, concepts, and relationships
- **Intelligent summarization**: Long messages automatically summarized for better embeddings
- **Context awareness**: Time, date, weather, and activity tracking
- **MCP management**: Independent MCP server configuration with profiles and smart filtering
- **Output styles**: Orthogonal output style layer (e.g., teaching mode, verbose mode)
- **Dynamic commands**: Personality-specific slash commands auto-generated per session
- **Custom prompts**: Add your own domain-specific knowledge
- **Vector search**: Turso/libSQL database with native vector similarity

## Installation

### Requirements

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+ (for building)
- [Ollama](https://ollama.ai) (optional, for embeddings and summarization)
- [rustormy](https://github.com/yourusername/rustormy) (optional, for weather context)

### Quick Install

```bash
git clone https://github.com/yourusername/dere.git
cd dere
make install
```

This will:
- Build the main binary and hook
- Install to /usr/local/bin
- Create necessary configuration directories
- Set up conversation capture automatically

### Manual Setup

1. Build the project:
```bash
make build
```

2. Copy or link binaries to your PATH:
```bash
cp bin/dere /usr/local/bin/
cp bin/dere-hook /usr/local/bin/
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
dere --tsun              # Tsundere mode (harsh but caring)
dere --kuu               # Kuudere (cold analytical)  
dere --yan               # Yandere (overly helpful)
dere --dere              # Deredere (actually nice)
dere --ero               # Erodere (playfully teasing)
dere --bare              # Plain Claude, no personality
```

### Advanced Features
```bash
dere --context           # Add time/date/weather/activity context
dere -c                  # Continue previous conversation
dere --prompts=rust,security  # Load custom prompts
dere --mcp=dev           # Use MCP profile (e.g., dev, media)
dere --mcp="linear,obsidian"  # Use specific MCP servers
dere --mcp="tag:media"   # Use MCP servers by tag
dere --output-style=verbose  # Change Claude's output style
```

### Combining Layers
```bash
dere --tsun --context              # Tsundere + context aware
dere --kuu --mcp=spotify           # Cold + Spotify control
dere --yan --output-style=terse    # Yandere + brief responses
dere --prompts=go --context        # Go expertise + context
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
│   ├── dere/          # Main CLI entry point
│   └── dere-hook/     # Go hook for conversation capture
├── src/
│   ├── cli/           # CLI argument parsing
│   ├── commands/      # Dynamic command generation
│   ├── composer/      # Prompt composition
│   ├── config/        # Configuration management
│   ├── database/      # Turso/libSQL with vector search
│   ├── embeddings/    # Ollama embedding client
│   ├── mcp/           # MCP server management
│   ├── settings/      # Claude settings generation
│   └── weather/       # Weather context integration
├── prompts/           # Built-in personality prompts
└── scripts/           # Installation scripts
```

### Building from Source
```bash
make build      # Build binaries
make clean      # Clean build artifacts
make install    # Build and install to /usr/local/bin
```

### Database Schema
The conversation database uses libSQL's native vector type:
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

CREATE INDEX conversations_embedding_idx 
ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'));
```

## Notes

- Database and embeddings are created automatically on first use
- Ollama is optional but enables conversation similarity search and summarization
- Works alongside existing Claude CLI configuration without modifying global settings
- Dynamic settings generation via `--settings` flag keeps Claude config clean
- Personality commands (e.g., `/dere-tsun-rant`) are created per session in `~/.claude/commands/`
- MCP configuration is independent from Claude Desktop for better control
- Summarization uses gemma3n model for efficient processing of long messages
- Vector search uses cosine similarity for finding related conversations

## License

MIT