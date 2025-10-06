# dere - personality-layered wrapper for Claude CLI
# Use `just --list` to see all available recipes

# Default recipe
default: build

# Build/sync Python environment
build:
    uv sync

# Build all (same as build for Python)
build-all: build

# Install binaries and Python hooks to user PATH
install: build-all
    mkdir -p ~/.local/bin
    mkdir -p ~/.local/share/dere
    mkdir -p ~/.config/dere/hooks
    mkdir -p ~/.config/dere/modes
    uv tool install --force --editable .
    cp -r src/ ~/.local/share/dere/
    cp -f hooks/python/dere-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-hook-session-end.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-context-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-statusline.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-stop-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-wellness-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/rpc_client.py ~/.config/dere/hooks/
    cp -f prompts/modes/*.md ~/.config/dere/modes/
    chmod +x ~/.config/dere/hooks/dere-hook.py
    chmod +x ~/.config/dere/hooks/dere-hook-session-end.py
    chmod +x ~/.config/dere/hooks/dere-context-hook.py
    chmod +x ~/.config/dere/hooks/dere-statusline.py
    chmod +x ~/.config/dere/hooks/dere-stop-hook.py
    chmod +x ~/.config/dere/hooks/dere-wellness-hook.py

# Install to system-wide location (requires sudo)
install-system: build-all
    @echo "System-wide installation not yet implemented for Python version"
    @echo "Use 'just install' for user installation via uv tool install"

# Clean build artifacts
clean:
    rm -rf bin/
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

# Run development CLI
dev-cli: build
    uv run dere

# Quick test of personality modes
test-personalities: build
    @echo "Testing personalities..."
    @echo "Tsun:" && echo "test" | uv run dere -P tsun -p "Hello"
    @echo "Kuu:" && echo "test" | uv run dere -P kuu -p "Hello"

# Update dependencies
deps:
    uv sync

# Check for dependency updates
deps-check:
    uv pip list --outdated

# Generate documentation
docs:
    @echo "Documentation available in README files:"
    @echo "- README.md (English)"
    @echo "- README.zh.md (Chinese)"
    @echo "- README.ja.md (Japanese)"

# Show project info
info:
    @echo "dere - personality-layered wrapper for Claude CLI"
    @echo "Version: $(git describe --tags --always 2>/dev/null || echo 'dev')"
    @echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    @echo "Python version: $(uv run python --version 2>/dev/null || echo 'not found')"
    @echo "UV version: $(uv --version 2>/dev/null || echo 'not found')"

# Create release build
release: clean build
    @echo "Release build complete"

# Package for distribution
package: release
    mkdir -p dist
    tar -czf dist/dere-$(shell git describe --tags --always).tar.gz src/ pyproject.toml uv.lock README.md LICENSE

# Show help
help:
    @just --list