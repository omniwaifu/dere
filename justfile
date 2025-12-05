# dere - personality-layered wrapper for Claude CLI

# Default recipe
default: install

# Install binaries to user PATH
install:
    cd src/dere_plugins/dere_productivity/mcp-server && npm run build
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

# Start FalkorDB (graph database)
falkordb:
    @if docker ps -q -f name=falkordb | grep -q .; then \
        echo "FalkorDB already running"; \
    elif docker ps -aq -f name=falkordb | grep -q .; then \
        docker start falkordb; \
    else \
        mkdir -p ~/.local/share/dere/falkordb && \
        docker run -d --name falkordb -p 6379:6379 \
            -v ~/.local/share/dere/falkordb:/var/lib/falkordb/data \
            falkordb/falkordb:latest; \
    fi

# Stop FalkorDB
falkordb-stop:
    docker stop falkordb

# Build sandbox image
sandbox-build:
    docker build -t dere-sandbox:latest -f docker/sandbox/Dockerfile .

# Run UI development server
ui:
    cd src/dere_ui && bun run dev

# Build UI for production
ui-build:
    cd src/dere_ui && bun run build

# Install UI dependencies
ui-install:
    cd src/dere_ui && bun install