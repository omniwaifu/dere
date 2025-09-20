package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"dere/src/database"
	"dere/src/taskqueue"
)

type SessionEndHookInput struct {
	SessionID    string `json:"session_id"`
	ExitReason   string `json:"exit_reason"` // clear, logout, prompt_input_exit, other
	Duration     int    `json:"duration_seconds,omitempty"`
}

func logDebug(format string, args ...interface{}) {
	debugLog := "/tmp/dere_session_end_debug.log"
	f, err := os.OpenFile(debugLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	fmt.Fprintf(f, format+"\n", args...)
}

func main() {
	// Log startup
	logDebug("\n--- Session End Hook called at %s ---", time.Now().Format(time.RFC1123))

	// Check if this is a dere session
	personality := os.Getenv("DERE_PERSONALITY")
	sessionIDStr := os.Getenv("DERE_SESSION_ID")
	dbPath := os.Getenv("DERE_DB_PATH")

	if personality == "" || sessionIDStr == "" || dbPath == "" {
		logDebug("Not a dere session, exiting")
		os.Exit(0)
	}

	logDebug("Personality: %s, Session: %s", personality, sessionIDStr)

	// Parse hook input from stdin
	var hookInput SessionEndHookInput
	decoder := json.NewDecoder(os.Stdin)
	if err := decoder.Decode(&hookInput); err != nil {
		logDebug("Failed to parse hook input: %v", err)
		// Don't block Claude from exiting
		os.Exit(0)
	}

	logDebug("Exit reason: %s", hookInput.ExitReason)

	// Parse session ID
	sessionID, err := strconv.ParseInt(sessionIDStr, 10, 64)
	if err != nil {
		logDebug("Failed to parse session_id: %v", err)
		os.Exit(0)
	}

	// Open database connection
	db, err := database.NewTursoDB(dbPath)
	if err != nil {
		logDebug("Failed to open database: %v", err)
		os.Exit(0)
	}
	defer db.Close()

	// Get recent conversation content for summarization
	conversationContent, err := getSessionContent(db, sessionID)
	if err != nil || conversationContent == "" {
		logDebug("No conversation content to summarize: %v", err)
		os.Exit(0)
	}

	logDebug("Found %d chars of conversation to summarize", len(conversationContent))

	// Open task queue
	queue, err := taskqueue.NewQueue(dbPath)
	if err != nil {
		logDebug("Failed to open task queue: %v", err)
		os.Exit(0)
	}
	defer queue.Close()

	// Queue session summarization task with high priority
	metadata := taskqueue.SummarizationMetadata{
		OriginalLength: len(conversationContent),
		Mode:          "session",
		MaxLength:     200, // Words for session summary
	}

	task, err := queue.Add(
		taskqueue.TaskTypeSummarization,
		"gemma3n:latest", // Use the summarization model
		conversationContent,
		metadata,
		taskqueue.PriorityHigh,
		&sessionID,
	)

	if err != nil {
		logDebug("Failed to queue session summary task: %v", err)
	} else {
		logDebug("Queued session summary task %d", task.ID)
	}

	// Mark session as ended
	if err := markSessionEnded(db, sessionID); err != nil {
		logDebug("Failed to mark session as ended: %v", err)
	}

	// Don't block Claude from exiting
	os.Exit(0)
}

func getSessionContent(db *database.TursoDB, sessionID int64) (string, error) {
	sqlDB := db.GetDB()

	// Get all conversation prompts from this session
	query := `
		SELECT prompt
		FROM conversations
		WHERE session_id = ?
		ORDER BY timestamp ASC
	`

	rows, err := sqlDB.Query(query, sessionID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var content strings.Builder
	for rows.Next() {
		var prompt string
		if err := rows.Scan(&prompt); err != nil {
			continue
		}
		content.WriteString(prompt)
		content.WriteString("\n\n")
	}

	return content.String(), nil
}

func markSessionEnded(db *database.TursoDB, sessionID int64) error {
	sqlDB := db.GetDB()

	// Update session end time
	updateSQL := `
		UPDATE sessions
		SET end_time = ?
		WHERE id = ?
	`

	_, err := sqlDB.Exec(updateSQL, time.Now().Unix(), sessionID)
	return err
}