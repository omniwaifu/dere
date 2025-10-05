package database

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestCreateSession tests session creation with context
func TestCreateSession(t *testing.T) {
	t.Parallel() // Enable parallel test execution

	tests := []struct {
		name          string
		workingDir    string
		personalities []string
		mcpServers    []string
		flags         map[string]string
		wantErr       bool
	}{
		{
			name:          "basic session",
			workingDir:    "/test/project",
			personalities: []string{"dere"},
			mcpServers:    []string{},
			flags:         map[string]string{},
			wantErr:       false,
		},
		{
			name:          "session with multiple personalities",
			workingDir:    "/test/project",
			personalities: []string{"dere", "tsun", "kuu"},
			mcpServers:    []string{"server1", "server2"},
			flags:         map[string]string{"mode": "dev", "debug": "true"},
			wantErr:       false,
		},
		{
			name:          "empty working directory",
			workingDir:    "",
			personalities: []string{"dere"},
			mcpServers:    []string{},
			flags:         map[string]string{},
			wantErr:       false, // Should handle empty dir gracefully
		},
	}

	for _, tt := range tests {
		tt := tt // Capture range variable
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel() // Run subtests in parallel

			db, err := NewTursoDB(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			sessionID, err := db.CreateSessionWithContext(ctx, tt.workingDir, tt.personalities, tt.mcpServers, tt.flags, nil)
			if (err != nil) != tt.wantErr {
				t.Errorf("CreateSessionWithContext() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr && sessionID <= 0 {
				t.Errorf("CreateSessionWithContext() returned invalid session ID: %d", sessionID)
			}
		})
	}
}

// TestConcurrentSessions tests concurrent session operations
func TestConcurrentSessions(t *testing.T) {
	t.Parallel()

	db, err := NewTursoDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	const numGoroutines = 10
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	sessionIDs := make([]int64, numGoroutines)
	errors := make([]error, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		i := i // Capture loop variable
		go func() {
			defer wg.Done()

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			id, err := db.CreateSessionWithContext(
				ctx,
				"/test/concurrent",
				[]string{"dere"},
				[]string{},
				map[string]string{"goroutine": string(rune(i))},
				nil,
			)
			sessionIDs[i] = id
			errors[i] = err
		}()
	}

	wg.Wait()

	// Check results
	for i, err := range errors {
		if err != nil {
			t.Errorf("Goroutine %d failed: %v", i, err)
		}
		if sessionIDs[i] <= 0 {
			t.Errorf("Goroutine %d got invalid session ID: %d", i, sessionIDs[i])
		}
	}

	// Verify all sessions are unique
	seen := make(map[int64]bool)
	for _, id := range sessionIDs {
		if seen[id] {
			t.Errorf("Duplicate session ID: %d", id)
		}
		seen[id] = true
	}
}

// TestContextCancellation tests proper context cancellation handling
func TestContextCancellation(t *testing.T) {
	t.Parallel()

	db, err := NewTursoDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Create a context that's already cancelled
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Try to create a session with cancelled context
	// This should fail quickly rather than hanging
	done := make(chan struct{})
	var createErr error

	go func() {
		_, createErr = db.CreateSessionWithContext(ctx, "/test", []string{"dere"}, nil, nil, nil)
		close(done)
	}()

	select {
	case <-done:
		// Operation completed (likely with an error)
		if createErr == nil {
			t.Error("Expected error with cancelled context, got nil")
		}
	case <-time.After(100 * time.Millisecond):
		// Should not timeout - cancelled context should fail fast
		t.Error("Operation did not respect context cancellation")
	}
}

// TestEmbeddingConversion tests the optimized byte conversion
func TestEmbeddingConversion(t *testing.T) {
	t.Parallel()

	db := &TursoDB{
		embedPool: &sync.Pool{
			New: func() interface{} {
				return make([]byte, 0, 4096)
			},
		},
	}

	testCases := []struct {
		name   string
		floats []float32
	}{
		{"nil input", nil},
		{"empty slice", []float32{}},
		{"single value", []float32{1.5}},
		{"typical embedding", make([]float32, 1024)},
		{"large embedding", make([]float32, 2048)},
	}

	for _, tc := range testCases {
		tc := tc // Capture range variable
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// Fill with test data
			for i := range tc.floats {
				tc.floats[i] = float32(i) * 0.1
			}

			// Convert to bytes
			bytes := db.float32SliceToBytes(tc.floats)

			// Convert back
			result := bytesToFloat32Slice(bytes)

			// Verify round-trip
			if tc.floats == nil {
				if result != nil {
					t.Errorf("Expected nil, got %v", result)
				}
			} else if len(result) != len(tc.floats) {
				t.Errorf("Length mismatch: want %d, got %d", len(tc.floats), len(result))
			} else {
				for i := range tc.floats {
					if result[i] != tc.floats[i] {
						t.Errorf("Value mismatch at index %d: want %f, got %f", i, tc.floats[i], result[i])
					}
				}
			}
		})
	}
}

// Helper function for tests
func testHelper(t *testing.T, msg string) {
	t.Helper() // Mark this as a test helper
	t.Log(msg)
}