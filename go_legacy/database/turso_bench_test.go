package database

import (
	"context"
	"math/rand"
	"sync"
	"testing"
)

// BenchmarkFloat32SliceToBytes tests the optimized byte conversion with pooling
func BenchmarkFloat32SliceToBytes(b *testing.B) {
	db := &TursoDB{
		embedPool: &sync.Pool{
			New: func() interface{} {
				return make([]byte, 0, 4096)
			},
		},
	}

	// Create test data - typical embedding size
	floats := make([]float32, 1024)
	for i := range floats {
		floats[i] = rand.Float32()
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = db.float32SliceToBytes(floats)
		}
	})

	b.ReportMetric(float64(len(floats)*4), "bytes/op")
}

// BenchmarkFloat32SliceToBytesOld tests the old implementation for comparison
func BenchmarkFloat32SliceToBytesOld(b *testing.B) {
	// Create test data
	floats := make([]float32, 1024)
	for i := range floats {
		floats[i] = rand.Float32()
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = float32SliceToBytes(floats) // Legacy function
		}
	})

	b.ReportMetric(float64(len(floats)*4), "bytes/op")
}

// BenchmarkPreparedStatements tests prepared statement performance
func BenchmarkPreparedStatements(b *testing.B) {
	// Setup test database
	db, err := NewTursoDB(":memory:")
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()

	// Test query
	query := `SELECT id FROM sessions WHERE working_dir = ? LIMIT 1`
	ctx := context.Background()

	b.ResetTimer()
	b.Run("WithPreparedStatements", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			stmt, err := db.getPreparedStmt(ctx, query)
			if err != nil {
				b.Fatal(err)
			}
			rows, err := stmt.QueryContext(ctx, "/test/path")
			if err != nil {
				b.Fatal(err)
			}
			rows.Close()
		}
	})

	b.Run("WithoutPreparedStatements", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			rows, err := db.db.QueryContext(ctx, query, "/test/path")
			if err != nil {
				b.Fatal(err)
			}
			rows.Close()
		}
	})
}

// BenchmarkStore tests the optimized Store method
func BenchmarkStore(b *testing.B) {
	db, err := NewTursoDB(":memory:")
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()

	// Create a test session
	sessionID, err := db.CreateSession("/test", []string{"dere"}, []string{}, map[string]string{}, nil)
	if err != nil {
		b.Fatal(err)
	}

	// Test data
	embedding := make([]float32, 1024)
	for i := range embedding {
		embedding[i] = rand.Float32()
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			err := db.Store(sessionID, "test prompt", "test text", "normal", embedding)
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}

// BenchmarkConcurrentQueries tests database performance under concurrent load
func BenchmarkConcurrentQueries(b *testing.B) {
	db, err := NewTursoDB(":memory:")
	if err != nil {
		b.Fatal(err)
	}
	defer db.Close()

	// Create test sessions
	for i := 0; i < 10; i++ {
		_, err := db.CreateSession("/test", []string{"dere"}, []string{}, map[string]string{}, nil)
		if err != nil {
			b.Fatal(err)
		}
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			sessions, err := db.GetSessions(5, "")
			if err != nil {
				b.Fatal(err)
			}
			_ = sessions
		}
	})
}

// BenchmarkMemoryAllocations tracks memory allocations
func BenchmarkMemoryAllocations(b *testing.B) {
	db := &TursoDB{
		embedPool: &sync.Pool{
			New: func() interface{} {
				return make([]byte, 0, 4096)
			},
		},
	}

	floats := make([]float32, 1024)
	for i := range floats {
		floats[i] = rand.Float32()
	}

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = db.float32SliceToBytes(floats)
	}
}