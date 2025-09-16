# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

Layered AI assistant with composable personalities for Claude CLI, featuring conversation memory via embeddings and intelligent message summarization.

**Why:** I use Claude Code for everything and want it "in character" when I load up a terminal, e.g. `dere --tsun --mcp=spotify`

## Features

- **Personality layers**: Tsundere, kuudere, yandere, deredere, and more
- **Conversation memory**: Automatic embedding generation and similarity search
- **Intelligent summarization**: Long messages automatically summarized for better embeddings
- **Context awareness**: Time, date, weather, and activity tracking
- **MCP integration**: Use with Claude Desktop MCP servers
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

### Manual Setup

1. Build the project:
```bash
make build
```

2. Set up the hook:
```bash
mkdir -p ~/.config/dere/.claude/hooks
ln -s $(pwd)/bin/dere-hook ~/.config/dere/.claude/hooks/dere-hook
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
dere --mcp=filesystem    # Use MCP servers from Claude Desktop
```

### Combining Layers
```bash
dere --tsun --context              # Tsundere + context aware
dere --kuu --mcp=spotify           # Cold + Spotify control
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
Uses existing Claude Desktop configuration from `~/.claude/claude_desktop_config.json`

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
│   ├── composer/      # Prompt composition
│   ├── config/        # Configuration management
│   ├── database/      # Turso/libSQL with vector search
│   ├── embeddings/    # Ollama embedding client
│   ├── hooks/         # Claude CLI hook management
│   ├── mcp/           # MCP server configuration
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
- Works alongside existing Claude CLI configuration
- Hooks only activate for dere sessions, not regular Claude usage
- Summarization uses gemma3n model for efficient processing of long messages
- Vector search uses cosine similarity for finding related conversations

## License

MIT