# dere - personality-layered wrapper for Claude CLI
# Use `just --list` to see all available recipes

# Default recipe
default: build

# Build main dere binary
build:
    go mod tidy
    mkdir -p bin
    go build -o bin/dere cmd/dere/main.go

# Build all binaries (same as build since hooks are now Python)
build-all: build

# Install binaries and Python hooks to user PATH
install: build-all
    mkdir -p ~/.local/bin
    mkdir -p ~/.config/dere/hooks
    mkdir -p ~/.config/dere/modes
    cp bin/dere ~/.local/bin/
    cp -f hooks/python/dere-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-hook-session-end.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-statusline.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-stop-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/dere-wellness-hook.py ~/.config/dere/hooks/
    cp -f hooks/python/rpc_client.py ~/.config/dere/hooks/
    cp -f prompts/modes/*.md ~/.config/dere/modes/
    chmod +x ~/.config/dere/hooks/dere-hook.py
    chmod +x ~/.config/dere/hooks/dere-hook-session-end.py
    chmod +x ~/.config/dere/hooks/dere-statusline.py
    chmod +x ~/.config/dere/hooks/dere-stop-hook.py
    chmod +x ~/.config/dere/hooks/dere-wellness-hook.py

# Install to system-wide location (requires sudo)
install-system: build-all
    sudo mkdir -p /usr/local/bin
    sudo mkdir -p /usr/local/share/dere/hooks
    sudo mkdir -p /usr/local/share/dere/modes
    sudo cp bin/dere /usr/local/bin/
    sudo cp hooks/python/dere-hook.py /usr/local/share/dere/hooks/
    sudo cp hooks/python/dere-hook-session-end.py /usr/local/share/dere/hooks/
    sudo cp hooks/python/dere-statusline.py /usr/local/share/dere/hooks/
    sudo cp hooks/python/dere-stop-hook.py /usr/local/share/dere/hooks/
    sudo cp hooks/python/dere-wellness-hook.py /usr/local/share/dere/hooks/
    sudo cp hooks/python/rpc_client.py /usr/local/share/dere/hooks/
    sudo cp prompts/modes/*.md /usr/local/share/dere/modes/
    sudo chmod +x /usr/local/share/dere/hooks/dere-hook.py
    sudo chmod +x /usr/local/share/dere/hooks/dere-hook-session-end.py
    sudo chmod +x /usr/local/share/dere/hooks/dere-statusline.py
    sudo chmod +x /usr/local/share/dere/hooks/dere-stop-hook.py
    sudo chmod +x /usr/local/share/dere/hooks/dere-wellness-hook.py

# Clean build artifacts
clean:
    rm -rf bin/
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.pyc" -delete 2>/dev/null || true

# Run tests
test:
    go test ./...

# Run linting
lint:
    golangci-lint run

# Format Go code
fmt:
    go fmt ./...

# Run development build and start daemon
dev: build
    ./bin/dere daemon start

# Stop development daemon
dev-stop:
    ./bin/dere daemon stop || true

# Restart development daemon
dev-restart: dev-stop dev

# Show daemon status and logs
dev-status:
    ./bin/dere daemon status

# Quick test of personality modes
test-personalities: build
    @echo "Testing personalities..."
    @echo "Tsun:" && echo "test" | ./bin/dere -P tsun -p "Hello"
    @echo "Kuu:" && echo "test" | ./bin/dere -P kuu -p "Hello"

# Update dependencies
deps:
    go mod tidy
    go mod download

# Check for dependency updates
deps-check:
    go list -u -m all

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
    @echo "Go version: $(go version)"
    @echo "Python version: $(python3 --version 2>/dev/null || echo 'not found')"

# Create release build
release: clean
    @echo "Building release..."
    go mod tidy
    mkdir -p bin
    CGO_ENABLED=0 go build -ldflags="-w -s" -o bin/dere cmd/dere/main.go
    @echo "Release binary created: bin/dere"

# Package for distribution
package: release
    mkdir -p dist
    tar -czf dist/dere-$(shell git describe --tags --always).tar.gz bin/ hooks/ prompts/ README.md LICENSE

# Show help
help:
    @just --list