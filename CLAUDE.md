dere is a personality-layered wrapper for Claude CLI with conversation persistence

NO TRIVIAL COMMENTS
Follow Go idioms and best practices
Use latest Go features (1.24+)
Descriptive variable and function names
No dot imports
Explicit error handling over panics
Wrap errors with fmt.Errorf and %w verb
Use custom error types for domain-specific errors
Format: go fmt ./...
Lint: golangci-lint run
Place tests in _test.go files in same package
Integration tests use _test package suffix
Run tests with: go test ./...
Add dependencies with go get
Prefer well-maintained modules
Avoid allocations in hot paths
Use structured logging where appropriate
Provide helpful error messages