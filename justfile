# dere - personality-layered wrapper for Claude CLI

# Default recipe
default: install

# Install binaries to user PATH
install:
    cd src/dere_plugins/dere_tasks/mcp-server && npm run build
    uv sync --extra dev
    uv tool install --force --editable .

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
dev:
    uv run python -m dere_daemon.main

# Run all services (daemon + discord)
dev-all:
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