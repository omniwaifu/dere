package errors

import (
	"errors"
	"fmt"
)

// Sentinel errors for common failure scenarios
var (
	// Database errors
	ErrDatabaseConnection = errors.New("database connection failed")
	ErrDatabaseQuery      = errors.New("database query failed")
	ErrRecordNotFound     = errors.New("record not found")
	ErrDuplicateRecord    = errors.New("duplicate record")

	// Ollama/Embedding errors
	ErrOllamaConnection   = errors.New("ollama connection failed")
	ErrOllamaTimeout      = errors.New("ollama request timeout")
	ErrOllamaModelMissing = errors.New("ollama model not found")
	ErrEmbeddingFailed    = errors.New("embedding generation failed")

	// Task processing errors
	ErrTaskValidation     = errors.New("task validation failed")
	ErrTaskTimeout        = errors.New("task processing timeout")
	ErrTaskCancelled      = errors.New("task was cancelled")
	ErrQueueFull          = errors.New("task queue is full")

	// Context errors
	ErrContextBuildFailed = errors.New("context building failed")
	ErrContextTooLarge    = errors.New("context exceeds maximum size")

	// Session errors
	ErrSessionNotFound    = errors.New("session not found")
	ErrSessionExpired     = errors.New("session has expired")
	ErrInvalidSessionID   = errors.New("invalid session ID")

	// Validation errors
	ErrInvalidInput       = errors.New("invalid input")
	ErrMissingRequired    = errors.New("missing required field")
	ErrOutOfRange         = errors.New("value out of acceptable range")
)

// DatabaseError represents a database operation error with context
type DatabaseError struct {
	Op    string // Operation that failed (e.g., "insert", "update", "query")
	Table string // Table involved
	Err   error  // Underlying error
}

func (e *DatabaseError) Error() string {
	return fmt.Sprintf("database %s operation on %s: %v", e.Op, e.Table, e.Err)
}

func (e *DatabaseError) Unwrap() error {
	return e.Err
}

// NewDatabaseError creates a new database error
func NewDatabaseError(op, table string, err error) error {
	return &DatabaseError{
		Op:    op,
		Table: table,
		Err:   err,
	}
}

// OllamaError represents an Ollama API error
type OllamaError struct {
	Model      string
	Operation  string
	StatusCode int
	Message    string
	Err        error
}

func (e *OllamaError) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("ollama %s failed for model %s (status %d): %s",
			e.Operation, e.Model, e.StatusCode, e.Message)
	}
	return fmt.Sprintf("ollama %s failed for model %s: %v",
		e.Operation, e.Model, e.Err)
}

func (e *OllamaError) Unwrap() error {
	return e.Err
}

// TaskError represents a task processing error
type TaskError struct {
	TaskID   int64
	TaskType string
	Stage    string // "validation", "processing", "completion"
	Err      error
}

func (e *TaskError) Error() string {
	return fmt.Sprintf("task %d (%s) failed at %s: %v",
		e.TaskID, e.TaskType, e.Stage, e.Err)
}

func (e *TaskError) Unwrap() error {
	return e.Err
}

// ValidationError represents input validation errors
type ValidationError struct {
	Field   string
	Value   interface{}
	Message string
}

func (e *ValidationError) Error() string {
	if e.Value != nil {
		return fmt.Sprintf("validation failed for %s (value: %v): %s",
			e.Field, e.Value, e.Message)
	}
	return fmt.Sprintf("validation failed for %s: %s", e.Field, e.Message)
}

// Helper functions for common error patterns

// IsRetryable determines if an error should be retried
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}

	// Check for specific retryable errors
	return errors.Is(err, ErrOllamaTimeout) ||
		errors.Is(err, ErrDatabaseConnection) ||
		errors.Is(err, ErrOllamaConnection)
}

// IsNotFound checks if error indicates a missing resource
func IsNotFound(err error) bool {
	return errors.Is(err, ErrRecordNotFound) ||
		errors.Is(err, ErrSessionNotFound) ||
		errors.Is(err, ErrOllamaModelMissing)
}

// IsCancelled checks if error indicates cancellation
func IsCancelled(err error) bool {
	return errors.Is(err, ErrTaskCancelled)
}

// WrapWithContext adds context to an error
func WrapWithContext(err error, format string, args ...interface{}) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf(format+": %w", append(args, err)...)
}