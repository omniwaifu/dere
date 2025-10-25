# dere - personality-layered wrapper for Claude CLI

# Default recipe
default: build

# Build/sync Python environment
build:
    uv sync --extra dev

# Install binaries and Python hooks to user PATH
install: build
    mkdir -p ~/.local/bin
    mkdir -p ~/.local/share/dere
    mkdir -p ~/.config/dere/hooks
    mkdir -p ~/.config/dere/modes
    uv tool install --force --editable .
    cp -r src/ ~/.local/share/dere/
    cp -f hooks/python/dere-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-hook-session-end.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-context-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-task-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-statusline.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-stop-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-wellness-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/rpc_client.py ~/.config/dere/hooks/
    cp -f prompts/modes/*.md ~/.config/dere/modes/
    chmod +x ~/.config/dere/hooks/dere-hook.py
    chmod +x ~/.config/dere/hooks/dere-hook-session-end.py
    chmod +x ~/.config/dere/hooks/dere-context-hook.py
    chmod +x ~/.config/dere/hooks/dere-task-hook.py
    chmod +x ~/.config/dere/hooks/dere-statusline.py
    chmod +x ~/.config/dere/hooks/dere-stop-hook.py
    chmod +x ~/.config/dere/hooks/dere-wellness-hook.py

# Clean build artifacts
clean:
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.pyc" -delete 2>/dev/null || true

# Run tests
test:
    uv run pytest -v

# Run linting
lint:
    uv run ruff check .

# Format Python code
fmt:
    uv run ruff format .

# Run development daemon
dev: build
    uv run python -m dere_daemon.main

# Run all services (daemon + discord)
dev-all: build
    uv run honcho start

# Check for dependency updates
deps-check:
    uv pip list --outdated

# Show project info
info:
    @echo "dere - personality-layered wrapper for Claude CLI"
    @echo "Version: $(git describe --tags --always 2>/dev/null || echo 'dev')"
    @echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    @echo "Python version: $(uv run python --version 2>/dev/null || echo 'not found')"
    @echo "UV version: $(uv --version 2>/dev/null || echo 'not found')"