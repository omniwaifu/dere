# dere - personality-layered wrapper for Claude CLI

# Default recipe
default: install

# Install dependencies and plugins
install: plugins ts-install
      cd plugins/dere_productivity/mcp-server && bun install
      cd plugins/dere_productivity/mcp-server && bun run build

# Reinstall Claude Code plugins (syncs hooks/skills/etc to cache)
plugins:
    claude plugin marketplace remove dere-plugins 2>/dev/null || true
    claude plugin marketplace add ./plugins
    claude plugin install dere-code@dere-plugins
    claude plugin install dere-core@dere-plugins

# Clean build artifacts
clean:
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.pyc" -delete 2>/dev/null || true

# Run tests
test:
    bun test

# Export JSON schemas (LLM + config)
schemas:
    bun scripts/export_schemas.ts

# Export OpenAPI schema for the daemon
openapi:
    bun scripts/export_openapi.ts

# Generate OpenAPI types for TS client
gen-openapi:
    bun run gen:openapi

# Generate config types from JSON Schema
gen-config-types:
    bun run gen:config-types

# Install JS/TS dependencies (workspace root)
ts-install:
    bun install
    mkdir -p ~/.local/bin
    ln -sf $(pwd)/packages/cli/src/main.ts ~/.local/bin/dere

# Run TS tests (shared-llm)
ts-test:
    cd packages/shared-llm && bun test

# Run TS daemon (Hono)
ts-daemon:
    cd packages/daemon && bun run dev

# Run linting
lint:
    bun run lint

# Format code
fmt:
    bun run format

# Run development daemon
dev:
    bun packages/daemon/src/index.ts

# Run DB migrations (Kysely baseline)
db-migrate:
    bun packages/daemon/src/migrate.ts

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

# Run all services (daemon + discord + ui)
dev-all:
    DERE_SANDBOX_BIND_PLUGINS=1 bunx concurrently --kill-others -n daemon,discord,ui -c blue,magenta,cyan \
        "bun packages/daemon/src/index.ts" \
        "bun packages/discord/src/main.ts" \
        "cd packages/ui && bun run dev"

# Show project info
info:
    @echo "dere - personality-layered wrapper for Claude CLI"
    @echo "Version: $(git describe --tags --always 2>/dev/null || echo 'dev')"
    @echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

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
    cd packages/ui && bun run dev

# Build UI for production
ui-build:
    cd packages/ui && bun run build

# Install UI dependencies
ui-install:
    cd packages/ui && bun install
