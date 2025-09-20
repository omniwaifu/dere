.PHONY: build build-all clean install

# Build main dere binary and hooks
build:
	go mod tidy
	mkdir -p bin
	go build -o bin/dere cmd/dere/main.go
	go build -o bin/dere-hook cmd/dere-hook/main.go
	go build -o bin/dere-hook-session-end cmd/dere-hook-session-end/main.go

# Build all binaries
build-all:
	go mod tidy
	mkdir -p bin
	go build -o bin/dere cmd/dere/main.go
	go build -o bin/dere-hook cmd/dere-hook/main.go
	go build -o bin/dere-hook-session-end cmd/dere-hook-session-end/main.go

# Install binaries to user PATH
install: build-all
	mkdir -p ~/.local/bin
	cp bin/dere ~/.local/bin/
	cp bin/dere-hook ~/.local/bin/
	cp bin/dere-hook-session-end ~/.local/bin/

clean:
	rm -rf bin/