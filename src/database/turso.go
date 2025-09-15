package database

import (
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"time"
	
	_ "github.com/tursodatabase/go-libsql"
)

type Conversation struct {
	ID          int64
	SessionID   string
	ProjectPath string
	Personality string
	Prompt      string
	Embedding   []float32
	Timestamp   int64
	CreatedAt   time.Time
}

type TursoDB struct {
	db *sql.DB
}

// NewTursoDB creates a new Turso database connection
func NewTursoDB(dbPath string) (*TursoDB, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}
	
	// Connect to local Turso/libSQL database
	db, err := sql.Open("libsql", "file:"+dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}
	
	// Test connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}
	
	tdb := &TursoDB{db: db}
	
	// Initialize schema
	if err := tdb.initSchema(); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}
	
	return tdb, nil
}

// initSchema creates tables and indexes if they don't exist
func (t *TursoDB) initSchema() error {
	// Create main conversations table with vector column
	// mxbai-embed-large produces 1024-dimensional vectors
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS conversations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		project_path TEXT,
		personality TEXT,
		prompt TEXT,
		prompt_embedding FLOAT32(1024),
		timestamp INTEGER,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`
	
	if _, err := t.db.Exec(createTableSQL); err != nil {
		return fmt.Errorf("failed to create conversations table: %w", err)
	}
	
	// Create index on session_id for fast lookups
	indexSQL := `CREATE INDEX IF NOT EXISTS idx_session ON conversations(session_id)`
	if _, err := t.db.Exec(indexSQL); err != nil {
		return fmt.Errorf("failed to create session index: %w", err)
	}
	
	// Create index on project_path for project filtering
	projectIndexSQL := `CREATE INDEX IF NOT EXISTS idx_project ON conversations(project_path)`
	if _, err := t.db.Exec(projectIndexSQL); err != nil {
		return fmt.Errorf("failed to create project index: %w", err)
	}
	
	// Create vector index for similarity search
	// Using cosine similarity as it works well for text embeddings
	vectorIndexSQL := `
	CREATE INDEX IF NOT EXISTS conversations_embedding_idx 
	ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'))
	`
	
	// Try to create vector index, but don't fail if libSQL version doesn't support it yet
	if _, err := t.db.Exec(vectorIndexSQL); err != nil {
		// Log but don't fail - vector search will fall back to full scan
		fmt.Fprintf(os.Stderr, "Warning: Could not create vector index (may need newer libSQL): %v\n", err)
	}
	
	return nil
}

// Store saves a conversation with its embedding
func (t *TursoDB) Store(sessionID, projectPath, personality, prompt string, embedding []float32) error {
	// Convert float32 slice to F32_BLOB format (little-endian bytes)
	embeddingBytes := float32SliceToBytes(embedding)
	
	insertSQL := `
	INSERT INTO conversations (session_id, project_path, personality, prompt, prompt_embedding, timestamp)
	VALUES (?, ?, ?, ?, ?, ?)
	`
	
	_, err := t.db.Exec(insertSQL, sessionID, projectPath, personality, prompt, embeddingBytes, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("failed to store conversation: %w", err)
	}
	
	return nil
}

// SearchSimilar finds conversations similar to the given embedding
func (t *TursoDB) SearchSimilar(embedding []float32, limit int) ([]Conversation, error) {
	embeddingBytes := float32SliceToBytes(embedding)
	
	// Try indexed search with vector_top_k first
	indexedSQL := `
	SELECT c.id, c.session_id, c.project_path, c.personality, c.prompt, c.prompt_embedding, c.timestamp, c.created_at
	FROM vector_top_k('conversations_embedding_idx', ?, ?) AS vtk
	JOIN conversations c ON c.rowid = vtk.id
	`
	
	rows, err := t.db.Query(indexedSQL, embeddingBytes, limit)
	if err != nil {
		// Fall back to exact search using vector_distance_cos
		exactSQL := `
		SELECT id, session_id, project_path, personality, prompt, prompt_embedding, timestamp, created_at
		FROM conversations
		WHERE prompt_embedding IS NOT NULL
		ORDER BY vector_distance_cos(prompt_embedding, ?) ASC
		LIMIT ?
		`
		rows, err = t.db.Query(exactSQL, embeddingBytes, limit)
		if err != nil {
			return nil, fmt.Errorf("failed to search similar conversations: %w", err)
		}
	}
	defer rows.Close()
	
	var conversations []Conversation
	for rows.Next() {
		var c Conversation
		var embBytes []byte
		
		err := rows.Scan(&c.ID, &c.SessionID, &c.ProjectPath, &c.Personality, &c.Prompt, 
		                 &embBytes, &c.Timestamp, &c.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		
		// Convert bytes back to float32 slice
		if embBytes != nil {
			c.Embedding = bytesToFloat32Slice(embBytes)
		}
		
		conversations = append(conversations, c)
	}
	
	return conversations, nil
}

// SearchSimilarInProject finds conversations similar to the given embedding within a project
func (t *TursoDB) SearchSimilarInProject(embedding []float32, projectPath string, limit int) ([]Conversation, error) {
	embeddingBytes := float32SliceToBytes(embedding)
	
	// Try indexed search first, filtered by project
	indexedSQL := `
	SELECT c.id, c.session_id, c.project_path, c.personality, c.prompt, c.prompt_embedding, c.timestamp, c.created_at
	FROM vector_top_k('conversations_embedding_idx', ?, ?) AS vtk
	JOIN conversations c ON c.rowid = vtk.id
	WHERE c.project_path = ?
	`
	
	rows, err := t.db.Query(indexedSQL, embeddingBytes, limit*3, projectPath) // Get more since we filter
	if err != nil {
		// Fall back to exact search with project filter
		exactSQL := `
		SELECT id, session_id, project_path, personality, prompt, prompt_embedding, timestamp, created_at
		FROM conversations
		WHERE prompt_embedding IS NOT NULL AND project_path = ?
		ORDER BY vector_distance_cos(prompt_embedding, ?) ASC
		LIMIT ?
		`
		rows, err = t.db.Query(exactSQL, projectPath, embeddingBytes, limit)
		if err != nil {
			return nil, fmt.Errorf("failed to search similar conversations in project: %w", err)
		}
	}
	defer rows.Close()
	
	var conversations []Conversation
	count := 0
	for rows.Next() && count < limit {
		var c Conversation
		var embBytes []byte
		
		err := rows.Scan(&c.ID, &c.SessionID, &c.ProjectPath, &c.Personality, 
		                 &c.Prompt, &embBytes, &c.Timestamp, &c.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		
		// Convert bytes back to float32 slice
		if embBytes != nil {
			c.Embedding = bytesToFloat32Slice(embBytes)
		}
		
		conversations = append(conversations, c)
		count++
	}
	
	return conversations, nil
}

// GetRecentConversations retrieves recent conversations for a session
func (t *TursoDB) GetRecentConversations(sessionID string, limit int) ([]Conversation, error) {
	query := `
	SELECT id, session_id, project_path, personality, prompt, prompt_embedding, timestamp, created_at
	FROM conversations
	WHERE session_id = ?
	ORDER BY timestamp DESC
	LIMIT ?
	`
	
	rows, err := t.db.Query(query, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get recent conversations: %w", err)
	}
	defer rows.Close()
	
	var conversations []Conversation
	for rows.Next() {
		var c Conversation
		var embBytes []byte
		
		err := rows.Scan(&c.ID, &c.SessionID, &c.ProjectPath, &c.Personality, &c.Prompt, 
		                 &embBytes, &c.Timestamp, &c.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		
		if embBytes != nil {
			c.Embedding = bytesToFloat32Slice(embBytes)
		}
		
		conversations = append(conversations, c)
	}
	
	return conversations, nil
}

// Close closes the database connection
func (t *TursoDB) Close() error {
	return t.db.Close()
}

// Helper functions for converting between float32 slices and byte arrays

func float32SliceToBytes(floats []float32) []byte {
	bytes := make([]byte, len(floats)*4)
	for i, f := range floats {
		bits := math.Float32bits(f)
		binary.LittleEndian.PutUint32(bytes[i*4:], bits)
	}
	return bytes
}

func bytesToFloat32Slice(bytes []byte) []float32 {
	floats := make([]float32, len(bytes)/4)
	for i := range floats {
		bits := binary.LittleEndian.Uint32(bytes[i*4:])
		floats[i] = math.Float32frombits(bits)
	}
	return floats
}