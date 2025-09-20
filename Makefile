.PHONY: build build-all clean install

# Build main dere binary only (hooks are now Python scripts)
build:
	go mod tidy
	mkdir -p bin
	go build -o bin/dere cmd/dere/main.go

# Build all binaries
build-all:
	go mod tidy
	mkdir -p bin
	go build -o bin/dere cmd/dere/main.go

# Install binaries and Python hooks to user PATH
install: build-all
	mkdir -p ~/.local/bin
	cp bin/dere ~/.local/bin/
	cp hooks/python/dere-hook.py ~/.local/bin/dere-hook
	cp hooks/python/dere-hook-session-end.py ~/.local/bin/dere-hook-session-end
	cp hooks/python/dere-statusline.py ~/.local/bin/dere-statusline
	cp hooks/python/rpc_client.py ~/.local/bin/

clean:
	rm -rf bin/