.PHONY: build build-all clean install

# Build main dere binary and hook
build:
	go mod tidy
	mkdir -p bin
	go build -o bin/dere cmd/dere/main.go
	go build -o bin/dere-hook cmd/dere-hook/main.go

# Build all binaries
build-all:
	go mod tidy
	mkdir -p bin
	go build -o bin/dere cmd/dere/main.go
	go build -o bin/bashdere cmd/bashdere/main.go
	go build -o bin/dere-hook cmd/dere-hook/main.go

# Install binaries to system PATH
install: build-all
	sudo cp bin/dere /usr/local/bin/
	sudo cp bin/bashdere /usr/local/bin/

clean:
	rm -rf bin/