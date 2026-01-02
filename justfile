# dere - personality-layered wrapper for Claude CLI

# Default recipe
default: install

# Install binaries to user PATH
install: plugins
      cd src/dere_plugins/dere_productivity/mcp-server && bun run build
      uv sync --extra dev
      uv tool install --force --editable .

# Reinstall Claude Code plugins (syncs hooks/skills/etc to cache)
plugins:
    claude plugin uninstall dere-code@dere_plugins 2>/dev/null || true
    claude plugin uninstall dere-core@dere_plugins 2>/dev/null || true
    claude plugin install dere-code@dere_plugins
    claude plugin install dere-core@dere_plugins

# Clean build artifacts
clean:
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.pyc" -delete 2>/dev/null || true

# Run tests
test:
    uv run pytest -v

# Run knowledge graph evals
kg-eval ARGS="":
    uv run python -m dere_graph.eval_cli {{ARGS}}

# Export JSON schemas (LLM + config)
schemas:
    uv run python scripts/export_schemas.py

# Export OpenAPI schema for the daemon
openapi:
    uv run python scripts/export_openapi.py

# Generate OpenAPI types for TS client
gen-openapi:
    bun run gen:openapi

# Generate config types from JSON Schema
gen-config-types:
    bun run gen:config-types

# Install JS/TS dependencies (workspace root)
ts-install:
    bun install

# Run TS tests (shared-llm)
ts-test:
    cd packages/shared-llm && bun test

# Run TS daemon (Hono)
ts-daemon:
    cd packages/daemon && bun run dev

# Run linting
lint:
    uv run ruff check .

# Format Python code
fmt:
    uv run ruff format .

# Run development daemon
dev:
    bun packages/daemon/src/index.ts

# Stop running daemon
stop:
    #!/usr/bin/env bash
    if [ "$(uname)" = "Darwin" ]; then
        PID_FILE="$HOME/Library/Application Support/dere/daemon.pid"
    elif [ "$(uname)" = "Linux" ]; then
        PID_FILE="$HOME/.local/share/dere/daemon.pid"
    else
        PID_FILE="$LOCALAPPDATA/dere/daemon.pid"
    fi
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Stopping daemon (PID: $PID)..."
            kill "$PID"
            echo "Daemon stopped"
        else
            echo "Daemon not running (stale PID file)"
            rm "$PID_FILE"
        fi
    else
        echo "No daemon PID file found"
    fi

# Run all services (daemon + discord)
dev-all:
    DERE_SANDBOX_BIND_PLUGINS=1 uv run honcho start

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
