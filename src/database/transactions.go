package database

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// TxManager provides transaction management with proper isolation and context support
type TxManager struct {
	db *sql.DB
}

// NewTxManager creates a new transaction manager
func NewTxManager(db *sql.DB) *TxManager {
	return &TxManager{db: db}
}

// TxOptions defines options for transaction execution
type TxOptions struct {
	Isolation sql.IsolationLevel
	ReadOnly  bool
	Timeout   time.Duration
}

// DefaultTxOptions returns sensible defaults for most operations
func DefaultTxOptions() *TxOptions {
	return &TxOptions{
		Isolation: sql.LevelDefault, // Let SQLite decide (usually DEFERRED)
		ReadOnly:  false,
		Timeout:   30 * time.Second,
	}
}

// ReadOnlyTxOptions returns options for read-only transactions
func ReadOnlyTxOptions() *TxOptions {
	return &TxOptions{
		Isolation: sql.LevelReadCommitted,
		ReadOnly:  true,
		Timeout:   10 * time.Second,
	}
}

// ImmediateTxOptions returns options for immediate write locks
func ImmediateTxOptions() *TxOptions {
	return &TxOptions{
		Isolation: sql.LevelSerializable, // Forces IMMEDIATE mode in SQLite
		ReadOnly:  false,
		Timeout:   30 * time.Second,
	}
}

// ExecuteInTransaction executes a function within a transaction with proper error handling
func (tm *TxManager) ExecuteInTransaction(ctx context.Context, opts *TxOptions, fn func(*sql.Tx) error) error {
	if opts == nil {
		opts = DefaultTxOptions()
	}

	// Apply timeout to context
	if opts.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
		defer cancel()
	}

	// Begin transaction with options
	tx, err := tm.db.BeginTx(ctx, &sql.TxOptions{
		Isolation: opts.Isolation,
		ReadOnly:  opts.ReadOnly,
	})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Ensure rollback on panic
	defer func() {
		if r := recover(); r != nil {
			_ = tx.Rollback()
			panic(r) // Re-panic after rollback
		}
	}()

	// Execute the function
	if err := fn(tx); err != nil {
		// Rollback on error
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("transaction failed: %v, rollback failed: %w", err, rbErr)
		}
		return err
	}

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// ExecuteInReadTransaction is a convenience method for read-only transactions
func (tm *TxManager) ExecuteInReadTransaction(ctx context.Context, fn func(*sql.Tx) error) error {
	return tm.ExecuteInTransaction(ctx, ReadOnlyTxOptions(), fn)
}

// ExecuteInWriteTransaction is a convenience method for write transactions with immediate locks
func (tm *TxManager) ExecuteInWriteTransaction(ctx context.Context, fn func(*sql.Tx) error) error {
	return tm.ExecuteInTransaction(ctx, ImmediateTxOptions(), fn)
}

// WithRetry executes a transaction with retry logic for lock conflicts
func (tm *TxManager) WithRetry(ctx context.Context, opts *TxOptions, fn func(*sql.Tx) error) error {
	const maxRetries = 3
	baseDelay := 50 * time.Millisecond

	for i := 0; i < maxRetries; i++ {
		err := tm.ExecuteInTransaction(ctx, opts, fn)
		if err == nil {
			return nil
		}

		// Check if the error is retryable (SQLite lock errors)
		if !isLockError(err) {
			return err // Non-retryable error
		}

		// Check if context is cancelled
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// Don't retry on the last attempt
		if i == maxRetries-1 {
			return fmt.Errorf("transaction failed after %d retries: %w", maxRetries, err)
		}

		// Exponential backoff with jitter
		delay := baseDelay * time.Duration(1<<uint(i))
		jitter := time.Duration(float64(delay) * 0.1 * (0.5 - float64(time.Now().UnixNano()%100)/100))
		select {
		case <-time.After(delay + jitter):
			// Continue to next retry
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	return fmt.Errorf("transaction retry loop ended unexpectedly")
}

// isLockError checks if an error is a SQLite locking error
func isLockError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return contains(errStr, "database is locked") ||
		contains(errStr, "database table is locked") ||
		contains(errStr, "database schema is locked") ||
		contains(errStr, "SQLITE_BUSY") ||
		contains(errStr, "SQLITE_LOCKED")
}

// contains is a simple string contains check
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// QueryRow executes a query that returns at most one row within a read transaction
func (tm *TxManager) QueryRow(ctx context.Context, query string, args ...interface{}) (*sql.Row, error) {
	var row *sql.Row
	err := tm.ExecuteInReadTransaction(ctx, func(tx *sql.Tx) error {
		row = tx.QueryRowContext(ctx, query, args...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return row, nil
}

// Query executes a query within a read transaction
func (tm *TxManager) Query(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	var rows *sql.Rows
	err := tm.ExecuteInReadTransaction(ctx, func(tx *sql.Tx) error {
		var err error
		rows, err = tx.QueryContext(ctx, query, args...)
		return err
	})
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// Exec executes a query within a write transaction
func (tm *TxManager) Exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	var result sql.Result
	err := tm.ExecuteInWriteTransaction(ctx, func(tx *sql.Tx) error {
		var err error
		result, err = tx.ExecContext(ctx, query, args...)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}