# dere

English | [中文](README.zh.md) | [日本語](README.ja.md)

Layered AI assistant with composable personalities for Claude CLI, with conversation memory via embeddings.

**Why:** I use Claude Code for everything and want it "in character" when I load up a terminal, e.g. `dere --tsun --mcp=spotify`

## Features

- **Personality layers**: Tsundere, kuudere, yandere, deredere, and more
- **Conversation memory**: Automatic embedding generation and similarity search (via Ollama)
- **Context awareness**: Time, date, and activity tracking
- **MCP integration**: Use with Claude Desktop MCP servers
- **Custom prompts**: Add your own domain-specific knowledge

## Installation

### Requirements

- [Claude CLI](https://github.com/anthropics/claude-cli) (`npm install -g @anthropic-ai/claude-code`)
- Go 1.20+ (for building)
- Python 3.8+ with pip
- [Ollama](https://ollama.ai) (optional, for embeddings)

### Quick Install

```bash
git clone https://github.com/yourusername/dere.git
cd dere
./scripts/install.sh
```

The install script will:
- Create necessary directories
- Symlink hook scripts
- Check Python dependencies
- Build the binary

### Manual Setup

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Build:
```bash
make build
```

3. Configure Ollama (optional, for conversation embeddings):
```bash
# Edit ~/.config/dere/config.toml
[ollama]
enabled = true
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
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
dere --context           # Add time/date/activity context
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
Conversations are automatically stored in `~/.local/share/dere/conversations.db` with embeddings for similarity search. The database is created on first use.

## Development

### Project Structure
```
dere/
├── cmd/dere/          # Main entry point
├── src/
│   ├── cli/           # CLI argument parsing
│   ├── composer/      # Prompt composition
│   ├── config/        # Configuration management
│   ├── database/      # Turso/SQLite storage
│   ├── embeddings/    # Ollama integration
│   ├── hooks/         # Claude CLI hook management
│   └── mcp/           # MCP server configuration
├── hooks/             # Python hooks for conversation capture
├── prompts/           # Built-in personality prompts
└── scripts/           # Installation scripts
```

### Building from Source
```bash
make build      # Build binary to bin/dere
make clean      # Clean build artifacts
make install    # Build and install to ~/bin/
```

## Notes

- Database and embeddings are created automatically on first use
- Ollama is optional but enables conversation similarity search
- Works alongside existing Claude CLI configuration
- Hooks only activate for dere sessions, not regular Claude usage

## License

MIT