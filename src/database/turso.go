package database

import (
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"time"

	_ "github.com/tursodatabase/go-libsql"
)

type Session struct {
	ID           int64
	WorkingDir   string
	StartTime    int64
	EndTime      *int64
	ContinuedFrom *int64
	ProjectType  *string
	CreatedAt    time.Time
}

type Conversation struct {
	ID            int64
	SessionID     string // Changed to string for history compatibility
	Prompt        string
	EmbeddingText *string
	ProcessingMode *string
	Embedding     []float32
	Timestamp     int64
	CreatedAt     time.Time
	Personality   string // Added for history display
	ProjectPath   string // Added for project filtering
}

type TursoDB struct {
	db *sql.DB
}

type Stats struct {
	TotalSessions             int
	TotalConversations        int
	AvgConversationsPerSession float64
	TopPersonalities          []PersonalityCount
	TopProjects               []ProjectCount
	ActivityByDay             []DayActivity
}

type PersonalityCount struct {
	Name  string
	Count int
}

type ProjectCount struct {
	Name  string
	Count int
}

type DayActivity struct {
	Date     string
	Sessions int
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
	// Core sessions table
	sessionTableSQL := `
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		working_dir TEXT NOT NULL,
		start_time INTEGER NOT NULL,
		end_time INTEGER,
		continued_from INTEGER REFERENCES sessions(id),
		project_type TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`

	if _, err := t.db.Exec(sessionTableSQL); err != nil {
		return fmt.Errorf("failed to create sessions table: %w", err)
	}

	// Personalities per session
	personalitiesTableSQL := `
	CREATE TABLE IF NOT EXISTS session_personalities (
		session_id INTEGER REFERENCES sessions(id),
		personality_name TEXT NOT NULL,
		PRIMARY KEY (session_id, personality_name)
	)`

	if _, err := t.db.Exec(personalitiesTableSQL); err != nil {
		return fmt.Errorf("failed to create session_personalities table: %w", err)
	}

	// MCP servers per session
	mcpTableSQL := `
	CREATE TABLE IF NOT EXISTS session_mcps (
		session_id INTEGER REFERENCES sessions(id),
		mcp_name TEXT NOT NULL,
		PRIMARY KEY (session_id, mcp_name)
	)`

	if _, err := t.db.Exec(mcpTableSQL); err != nil {
		return fmt.Errorf("failed to create session_mcps table: %w", err)
	}

	// Flags per session
	flagsTableSQL := `
	CREATE TABLE IF NOT EXISTS session_flags (
		session_id INTEGER REFERENCES sessions(id),
		flag_name TEXT NOT NULL,
		flag_value TEXT,
		PRIMARY KEY (session_id, flag_name)
	)`

	if _, err := t.db.Exec(flagsTableSQL); err != nil {
		return fmt.Errorf("failed to create session_flags table: %w", err)
	}

	// Conversations table (normalized)
	conversationsTableSQL := `
	CREATE TABLE IF NOT EXISTS conversations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id INTEGER REFERENCES sessions(id),
		prompt TEXT NOT NULL,
		embedding_text TEXT,
		processing_mode TEXT,
		prompt_embedding FLOAT32(1024),
		timestamp INTEGER NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`

	if _, err := t.db.Exec(conversationsTableSQL); err != nil {
		return fmt.Errorf("failed to create conversations table: %w", err)
	}

	// Create indexes
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS sessions_working_dir_idx ON sessions(working_dir)`,
		`CREATE INDEX IF NOT EXISTS sessions_start_time_idx ON sessions(start_time)`,
		`CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations(session_id)`,
		`CREATE INDEX IF NOT EXISTS conversations_timestamp_idx ON conversations(timestamp)`,
	}

	for _, indexSQL := range indexes {
		if _, err := t.db.Exec(indexSQL); err != nil {
			return fmt.Errorf("failed to create index: %w", err)
		}
	}

	// Create vector index for similarity search
	vectorIndexSQL := `
	CREATE INDEX IF NOT EXISTS conversations_embedding_idx
	ON conversations (libsql_vector_idx(prompt_embedding, 'metric=cosine'))
	`

	// Try to create vector index, but don't fail if libSQL version doesn't support it
	if _, err := t.db.Exec(vectorIndexSQL); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: Could not create vector index (may need newer libSQL): %v\n", err)
	}

	return nil
}

// CreateSession creates a new session record
func (t *TursoDB) CreateSession(workingDir string, personalities []string, mcpServers []string, flags map[string]string, continuedFrom *int64) (int64, error) {
	// Detect project type from working directory
	projectType := detectProjectType(workingDir)

	// Insert session
	sessionSQL := `
	INSERT INTO sessions (working_dir, start_time, continued_from, project_type)
	VALUES (?, ?, ?, ?)
	`

	result, err := t.db.Exec(sessionSQL, workingDir, time.Now().Unix(), continuedFrom, projectType)
	if err != nil {
		return 0, fmt.Errorf("failed to create session: %w", err)
	}

	sessionID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get session ID: %w", err)
	}

	// Insert personalities
	for _, personality := range personalities {
		personalitySQL := `INSERT INTO session_personalities (session_id, personality_name) VALUES (?, ?)`
		if _, err := t.db.Exec(personalitySQL, sessionID, personality); err != nil {
			return 0, fmt.Errorf("failed to insert personality: %w", err)
		}
	}

	// Insert MCP servers
	for _, mcpServer := range mcpServers {
		mcpSQL := `INSERT INTO session_mcps (session_id, mcp_name) VALUES (?, ?)`
		if _, err := t.db.Exec(mcpSQL, sessionID, mcpServer); err != nil {
			return 0, fmt.Errorf("failed to insert MCP server: %w", err)
		}
	}

	// Insert flags
	for flagName, flagValue := range flags {
		flagSQL := `INSERT INTO session_flags (session_id, flag_name, flag_value) VALUES (?, ?, ?)`
		if _, err := t.db.Exec(flagSQL, sessionID, flagName, flagValue); err != nil {
			return 0, fmt.Errorf("failed to insert flag: %w", err)
		}
	}

	return sessionID, nil
}

// EndSession updates the end time of a session
func (t *TursoDB) EndSession(sessionID int64) error {
	endSQL := `UPDATE sessions SET end_time = ? WHERE id = ?`
	_, err := t.db.Exec(endSQL, time.Now().Unix(), sessionID)
	if err != nil {
		return fmt.Errorf("failed to end session: %w", err)
	}
	return nil
}

// Store saves a conversation with its embedding
func (t *TursoDB) Store(sessionID int64, prompt, embeddingText, processingMode string, embedding []float32) error {
	embeddingBytes := float32SliceToBytes(embedding)

	insertSQL := `
	INSERT INTO conversations (session_id, prompt, embedding_text, processing_mode, prompt_embedding, timestamp)
	VALUES (?, ?, ?, ?, ?, ?)
	`

	_, err := t.db.Exec(insertSQL, sessionID, prompt, embeddingText, processingMode, embeddingBytes, time.Now().Unix())
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
	SELECT c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at,
	       GROUP_CONCAT(sp.personality_name, '+') as personalities, s.working_dir
	FROM vector_top_k('conversations_embedding_idx', ?, ?) AS vtk
	JOIN conversations c ON c.rowid = vtk.id
	JOIN sessions s ON c.session_id = s.id
	JOIN session_personalities sp ON s.id = sp.session_id
	GROUP BY c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at, s.working_dir
	`

	rows, err := t.db.Query(indexedSQL, embeddingBytes, limit)
	if err != nil {
		// Fall back to exact search using vector_distance_cos
		exactSQL := `
		SELECT c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at,
		       GROUP_CONCAT(sp.personality_name, '+') as personalities, s.working_dir
		FROM conversations c
		JOIN sessions s ON c.session_id = s.id
		JOIN session_personalities sp ON s.id = sp.session_id
		WHERE c.prompt_embedding IS NOT NULL
		GROUP BY c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at, s.working_dir
		ORDER BY vector_distance_cos(c.prompt_embedding, ?) ASC
		LIMIT ?
		`
		rows, err = t.db.Query(exactSQL, embeddingBytes, limit)
		if err != nil {
			return nil, fmt.Errorf("failed to search similar conversations: %w", err)
		}
	}
	defer rows.Close()

	return t.scanConversations(rows)
}

// SearchSimilarInProject finds conversations similar to the given embedding within a specific project
func (t *TursoDB) SearchSimilarInProject(embedding []float32, projectPath string, limit int) ([]Conversation, error) {
	embeddingBytes := float32SliceToBytes(embedding)

	// Search with project filtering
	exactSQL := `
	SELECT c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at,
	       GROUP_CONCAT(sp.personality_name, '+') as personalities, s.working_dir
	FROM conversations c
	JOIN sessions s ON c.session_id = s.id
	JOIN session_personalities sp ON s.id = sp.session_id
	WHERE c.prompt_embedding IS NOT NULL AND s.working_dir = ?
	GROUP BY c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at, s.working_dir
	ORDER BY vector_distance_cos(c.prompt_embedding, ?) ASC
	LIMIT ?
	`

	rows, err := t.db.Query(exactSQL, projectPath, embeddingBytes, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search similar conversations in project: %w", err)
	}
	defer rows.Close()

	return t.scanConversations(rows)
}

// GetRecentConversations retrieves recent conversations for a session
func (t *TursoDB) GetRecentConversations(sessionID string, limit int) ([]Conversation, error) {
	// Parse string session ID to int64 for database lookup
	sessionIDInt, err := strconv.ParseInt(sessionID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid session ID: %w", err)
	}

	query := `
	SELECT c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at,
	       GROUP_CONCAT(sp.personality_name, '+') as personalities, s.working_dir
	FROM conversations c
	JOIN sessions s ON c.session_id = s.id
	JOIN session_personalities sp ON s.id = sp.session_id
	WHERE c.session_id = ?
	GROUP BY c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at, s.working_dir
	ORDER BY c.timestamp DESC
	LIMIT ?
	`

	rows, err := t.db.Query(query, sessionIDInt, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get recent conversations: %w", err)
	}
	defer rows.Close()

	return t.scanConversations(rows)
}

// GetSessions retrieves sessions with optional filters
func (t *TursoDB) GetSessions(limit int, workingDir string) ([]Session, error) {
	var query string
	var args []interface{}

	if workingDir != "" {
		query = `
		SELECT id, working_dir, start_time, end_time, continued_from, project_type, created_at
		FROM sessions
		WHERE working_dir = ?
		ORDER BY start_time DESC
		LIMIT ?
		`
		args = []interface{}{workingDir, limit}
	} else {
		query = `
		SELECT id, working_dir, start_time, end_time, continued_from, project_type, created_at
		FROM sessions
		ORDER BY start_time DESC
		LIMIT ?
		`
		args = []interface{}{limit}
	}

	rows, err := t.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var s Session
		err := rows.Scan(&s.ID, &s.WorkingDir, &s.StartTime, &s.EndTime, &s.ContinuedFrom, &s.ProjectType, &s.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session: %w", err)
		}
		sessions = append(sessions, s)
	}

	return sessions, nil
}

// GetSessionPersonalities returns personalities for a session
func (t *TursoDB) GetSessionPersonalities(sessionID int64) ([]string, error) {
	query := `SELECT personality_name FROM session_personalities WHERE session_id = ?`
	rows, err := t.db.Query(query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var personalities []string
	for rows.Next() {
		var personality string
		if err := rows.Scan(&personality); err != nil {
			return nil, err
		}
		personalities = append(personalities, personality)
	}
	return personalities, nil
}

// ListRecentSessions returns recent sessions with their latest conversation
func (t *TursoDB) ListRecentSessions(limit int) ([]Conversation, error) {
	query := `
	SELECT c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at,
	       GROUP_CONCAT(sp.personality_name, '+') as personalities, s.working_dir
	FROM conversations c
	JOIN sessions s ON c.session_id = s.id
	JOIN session_personalities sp ON s.id = sp.session_id
	WHERE c.id IN (
		SELECT MAX(c2.id)
		FROM conversations c2
		GROUP BY c2.session_id
	)
	GROUP BY c.id, s.id, c.prompt, c.embedding_text, c.processing_mode, c.prompt_embedding, c.timestamp, c.created_at, s.working_dir
	ORDER BY c.timestamp DESC
	LIMIT ?
	`

	rows, err := t.db.Query(query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list recent sessions: %w", err)
	}
	defer rows.Close()

	return t.scanConversations(rows)
}

// CleanupOldSessions removes sessions and conversations older than the cutoff time
func (t *TursoDB) CleanupOldSessions(cutoff time.Time) (int64, error) {
	// First, delete conversations for old sessions
	deleteConversationsSQL := `
	DELETE FROM conversations
	WHERE session_id IN (
		SELECT id FROM sessions WHERE start_time < ?
	)
	`

	_, err := t.db.Exec(deleteConversationsSQL, cutoff.Unix())
	if err != nil {
		return 0, fmt.Errorf("failed to delete old conversations: %w", err)
	}

	// Delete session-related tables (personalities, mcps, flags)
	deleteRelatedSQL := []string{
		"DELETE FROM session_personalities WHERE session_id IN (SELECT id FROM sessions WHERE start_time < ?)",
		"DELETE FROM session_mcps WHERE session_id IN (SELECT id FROM sessions WHERE start_time < ?)",
		"DELETE FROM session_flags WHERE session_id IN (SELECT id FROM sessions WHERE start_time < ?)",
	}

	for _, sql := range deleteRelatedSQL {
		_, err := t.db.Exec(sql, cutoff.Unix())
		if err != nil {
			return 0, fmt.Errorf("failed to delete related session data: %w", err)
		}
	}

	// Finally, delete the sessions themselves
	deleteSessionsSQL := `DELETE FROM sessions WHERE start_time < ?`
	result, err := t.db.Exec(deleteSessionsSQL, cutoff.Unix())
	if err != nil {
		return 0, fmt.Errorf("failed to delete old sessions: %w", err)
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get affected rows: %w", err)
	}

	return count, nil
}

// GetStats returns usage statistics
func (t *TursoDB) GetStats(days int, projectPath string) (*Stats, error) {
	stats := &Stats{}

	// Build time filter
	var timeFilter string
	var timeArgs []interface{}
	if days > 0 {
		cutoff := time.Now().AddDate(0, 0, -days).Unix()
		timeFilter = " AND s.start_time >= ?"
		timeArgs = append(timeArgs, cutoff)
	}

	// Build project filter
	var projectFilter string
	var projectArgs []interface{}
	if projectPath != "" {
		projectFilter = " AND s.working_dir = ?"
		projectArgs = append(projectArgs, projectPath)
	}

	// Total sessions
	sessionQuery := fmt.Sprintf("SELECT COUNT(*) FROM sessions s WHERE 1=1%s%s", timeFilter, projectFilter)
	args := append(timeArgs, projectArgs...)
	err := t.db.QueryRow(sessionQuery, args...).Scan(&stats.TotalSessions)
	if err != nil {
		return nil, fmt.Errorf("failed to count sessions: %w", err)
	}

	// Total conversations
	convQuery := fmt.Sprintf(`
		SELECT COUNT(*) FROM conversations c
		JOIN sessions s ON c.session_id = s.id
		WHERE 1=1%s%s`, timeFilter, projectFilter)
	err = t.db.QueryRow(convQuery, args...).Scan(&stats.TotalConversations)
	if err != nil {
		return nil, fmt.Errorf("failed to count conversations: %w", err)
	}

	// Average conversations per session
	if stats.TotalSessions > 0 {
		stats.AvgConversationsPerSession = float64(stats.TotalConversations) / float64(stats.TotalSessions)
	}

	// Top personalities
	personalityQuery := fmt.Sprintf(`
		SELECT GROUP_CONCAT(sp.personality_name, '+') as personalities, COUNT(DISTINCT s.id) as session_count
		FROM sessions s
		JOIN session_personalities sp ON s.id = sp.session_id
		WHERE 1=1%s%s
		GROUP BY s.id
		ORDER BY session_count DESC
		LIMIT 5`, timeFilter, projectFilter)

	rows, err := t.db.Query(personalityQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get personality stats: %w", err)
	}
	defer rows.Close()

	personalityMap := make(map[string]int)
	for rows.Next() {
		var personalities string
		var count int
		if err := rows.Scan(&personalities, &count); err != nil {
			continue
		}
		personalityMap[personalities] += count
	}

	// Convert map to sorted slice
	for personality, count := range personalityMap {
		stats.TopPersonalities = append(stats.TopPersonalities, PersonalityCount{
			Name:  personality,
			Count: count,
		})
	}

	// Top projects (only if not filtering by project)
	if projectPath == "" {
		projectQuery := fmt.Sprintf(`
			SELECT s.working_dir, COUNT(*) as session_count
			FROM sessions s
			WHERE 1=1%s
			GROUP BY s.working_dir
			ORDER BY session_count DESC
			LIMIT 5`, timeFilter)

		rows, err := t.db.Query(projectQuery, timeArgs...)
		if err != nil {
			return nil, fmt.Errorf("failed to get project stats: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var project string
			var count int
			if err := rows.Scan(&project, &count); err != nil {
				continue
			}
			stats.TopProjects = append(stats.TopProjects, ProjectCount{
				Name:  project,
				Count: count,
			})
		}
	}

	// Activity by day (last 7 days if no specific days filter, or the specified period)
	activityDays := 7
	if days > 0 && days < 30 {
		activityDays = days
	}

	activityQuery := fmt.Sprintf(`
		SELECT DATE(s.start_time, 'unixepoch') as day, COUNT(*) as session_count
		FROM sessions s
		WHERE s.start_time >= ?%s
		GROUP BY day
		ORDER BY day DESC
		LIMIT ?`, projectFilter)

	activityCutoff := time.Now().AddDate(0, 0, -activityDays).Unix()
	activityArgs := []interface{}{activityCutoff}
	activityArgs = append(activityArgs, projectArgs...)
	activityArgs = append(activityArgs, activityDays)

	rows, err = t.db.Query(activityQuery, activityArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to get activity stats: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var day string
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			continue
		}
		stats.ActivityByDay = append(stats.ActivityByDay, DayActivity{
			Date:     day,
			Sessions: count,
		})
	}

	return stats, nil
}

// Close closes the database connection
func (t *TursoDB) Close() error {
	return t.db.Close()
}

// Helper methods

func (t *TursoDB) scanConversations(rows *sql.Rows) ([]Conversation, error) {
	var conversations []Conversation
	for rows.Next() {
		var c Conversation
		var embBytes []byte
		var sessionIDInt int64

		err := rows.Scan(&c.ID, &sessionIDInt, &c.Prompt, &c.EmbeddingText, &c.ProcessingMode, &embBytes, &c.Timestamp, &c.CreatedAt, &c.Personality, &c.ProjectPath)
		if err != nil {
			return nil, fmt.Errorf("failed to scan conversation: %w", err)
		}

		// Convert session ID to string for compatibility
		c.SessionID = strconv.FormatInt(sessionIDInt, 10)

		if embBytes != nil {
			c.Embedding = bytesToFloat32Slice(embBytes)
		}

		conversations = append(conversations, c)
	}
	return conversations, nil
}

func detectProjectType(workingDir string) *string {
	// Check for common project files
	files := []struct {
		filename string
		project  string
	}{
		{"go.mod", "go"},
		{"package.json", "node"},
		{"requirements.txt", "python"},
		{"Pipfile", "python"},
		{"pyproject.toml", "python"},
		{"Cargo.toml", "rust"},
		{"pom.xml", "java"},
		{"build.gradle", "java"},
		{"composer.json", "php"},
		{"Gemfile", "ruby"},
		{".csproj", "csharp"},
		{"mix.exs", "elixir"},
	}

	for _, file := range files {
		if _, err := os.Stat(filepath.Join(workingDir, file.filename)); err == nil {
			return &file.project
		}
	}

	return nil
}

func float32SliceToBytes(floats []float32) []byte {
	if floats == nil {
		return nil
	}

	if len(floats) == 0 {
		return nil
	}

	bytes := make([]byte, len(floats)*4)
	for i, f := range floats {
		bits := math.Float32bits(f)
		binary.LittleEndian.PutUint32(bytes[i*4:], bits)
	}
	return bytes
}

func bytesToFloat32Slice(bytes []byte) []float32 {
	if bytes == nil || len(bytes) == 0 {
		return nil
	}

	floats := make([]float32, len(bytes)/4)
	for i := range floats {
		bits := binary.LittleEndian.Uint32(bytes[i*4:])
		floats[i] = math.Float32frombits(bits)
	}
	return floats
}