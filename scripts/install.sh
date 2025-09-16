#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "→ Installing dere..."

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration directories
CONFIG_DIR="$HOME/.config/dere"
HOOKS_DIR="$CONFIG_DIR/.claude/hooks"
DATA_DIR="$HOME/.local/share/dere"

# Create necessary directories
echo "• Creating directories..."
mkdir -p "$HOOKS_DIR"
mkdir -p "$DATA_DIR"

# Build the binaries
echo "• Building dere..."
cd "$REPO_DIR"
if make build; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

# Symlink the hook binary
echo "• Installing hook..."
HOOK_SOURCE="$REPO_DIR/bin/dere-hook"
HOOK_DEST="$HOOKS_DIR/dere-hook"

if [ -f "$HOOK_DEST" ] && [ ! -L "$HOOK_DEST" ]; then
    echo -e "${YELLOW}! Hook already exists at $HOOK_DEST (not a symlink)${NC}"
    read -p "Replace with symlink? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm "$HOOK_DEST"
        ln -sf "$HOOK_SOURCE" "$HOOK_DEST"
        echo -e "${GREEN}✓ Hook symlinked${NC}"
    fi
else
    ln -sf "$HOOK_SOURCE" "$HOOK_DEST"
    echo -e "${GREEN}✓ Hook symlinked${NC}"
fi

# Create default config if it doesn't exist
CONFIG_FILE="$CONFIG_DIR/config.toml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "• Creating default config..."
    cat > "$CONFIG_FILE" << 'EOF'
[ollama]
enabled = false
url = "http://localhost:11434"
embedding_model = "mxbai-embed-large"
summarization_model = "gemma3n:latest"
summarization_threshold = 500

[weather]
enabled = false
location = "San Francisco, CA"
units = "imperial"
EOF
    echo -e "${GREEN}✓ Created $CONFIG_FILE${NC}"
    echo -e "${YELLOW}! Edit $CONFIG_FILE to configure Ollama and weather settings${NC}"
else
    echo -e "${GREEN}✓ Config exists at $CONFIG_FILE${NC}"
fi

echo ""
echo -e "${GREEN}== Installation complete ==${NC}"
echo ""
echo "Next steps:"
echo "1. Ensure Claude Code is installed: npm install -g @anthropic-ai/claude-code"
echo "2. Configure Ollama in $CONFIG_FILE (optional, for embeddings)"
echo "3. Run: $REPO_DIR/bin/dere --help"
echo ""
echo "Or install to system:"
echo "  sudo make install"