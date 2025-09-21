package daemon

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"dere/src/taskqueue"
	"dere/src/personality"
)

// routeMethod routes JSON-RPC methods to their handlers
func (s *Server) routeMethod(method string, params json.RawMessage) (interface{}, error) {
	switch method {
	case "conversation.capture":
		return s.handleConversationCapture(params)
	case "session.end":
		return s.handleSessionEnd(params)
	case "status.get":
		return s.handleStatusGet(params)
	case "queue.add":
		return s.handleQueueAdd(params)
	case "queue.status":
		return s.handleQueueStatus(params)
	case "context.build":
		return s.handleContextBuild(params)
	case "context.get":
		return s.handleContextGet(params)
	default:
		return nil, &RPCError{Code: -32601, Message: "Method not found"}
	}
}

// ConversationCaptureParams represents conversation capture request
type ConversationCaptureParams struct {
	SessionID    int64  `json:"session_id"`
	Personality  string `json:"personality"`
	ProjectPath  string `json:"project_path"`
	Prompt       string `json:"prompt"`
	MessageType  string `json:"message_type,omitempty"`
	CommandName  string `json:"command_name,omitempty"`
	CommandArgs  string `json:"command_args,omitempty"`
	ExitCode     int    `json:"exit_code,omitempty"`
	IsCommand    bool   `json:"is_command"`
}

// handleConversationCapture processes a conversation capture request (replaces dere-hook)
func (s *Server) handleConversationCapture(params json.RawMessage) (interface{}, error) {
	var p ConversationCaptureParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &RPCError{Code: -32602, Message: "Invalid params"}
	}

	// Ensure session exists (daemon creates sessions on demand)
	if err := s.ensureSessionExists(p.SessionID, p.ProjectPath, p.Personality); err != nil {
		log.Printf("Failed to ensure session exists: %v", err)
		return nil, fmt.Errorf("failed to ensure session exists: %w", err)
	}

	// Store conversation in database (without embedding initially)
	messageType := p.MessageType
	if messageType == "" {
		messageType = "user" // Default to user message
	}
	conversationID, err := s.storeConversationWithoutEmbeddingAndType(p.SessionID, p.Prompt, "raw", messageType)
	if err != nil {
		log.Printf("Failed to store conversation: %v", err)
		return nil, fmt.Errorf("failed to store conversation: %w", err)
	}

	// Queue embedding generation task
	task, err := s.queue.Add(
		taskqueue.TaskTypeEmbedding,
		s.ollama.GetEmbeddingModel(),
		p.Prompt,
		taskqueue.EmbeddingMetadata{
			OriginalLength: len(p.Prompt),
			ProcessingMode: "raw",
			ContentType:    "prompt",
			ConversationID: &conversationID,
		},
		taskqueue.PriorityNormal,
		&p.SessionID,
	)
	if err != nil {
		log.Printf("Failed to queue embedding task: %v", err)
	} else {
		log.Printf("Queued embedding task %d for session %d", task.ID, p.SessionID)
	}

	// Queue entity extraction task
	task, err = s.queue.Add(
		taskqueue.TaskTypeEntityExtraction,
		"gemma3n:latest",
		p.Prompt,
		taskqueue.EntityExtractionMetadata{
			OriginalLength: len(p.Prompt),
			ContentType:    "prompt",
			ContextHint:    "coding",
		},
		taskqueue.PriorityLow,
		&p.SessionID,
	)
	if err != nil {
		log.Printf("Failed to queue entity extraction: %v", err)
	} else {
		log.Printf("Queued entity extraction task %d for session %d", task.ID, p.SessionID)
	}

	return map[string]interface{}{
		"status": "stored",
	}, nil
}

// SessionEndParams represents session end request
type SessionEndParams struct {
	SessionID  int64  `json:"session_id"`
	ExitReason string `json:"exit_reason"`
	Duration   int    `json:"duration_seconds,omitempty"`
}

// handleSessionEnd processes session end request (replaces dere-hook-session-end)
func (s *Server) handleSessionEnd(params json.RawMessage) (interface{}, error) {
	log.Printf("Session end called with params: %s", string(params))

	var p SessionEndParams
	if err := json.Unmarshal(params, &p); err != nil {
		log.Printf("Failed to unmarshal session end params: %v", err)
		return nil, &RPCError{Code: -32602, Message: "Invalid params"}
	}

	log.Printf("Session end for session %d, reason: %s", p.SessionID, p.ExitReason)

	// Session must be created by main dere process

	// Get session content for summarization
	log.Printf("Getting session content for session %d", p.SessionID)
	conversationContent, err := s.getSessionContent(p.SessionID)
	if err != nil {
		log.Printf("Error getting session content: %v", err)
		conversationContent = ""
	}
	log.Printf("Found %d chars of conversation content", len(conversationContent))

	// Skip summarization if no conversation content
	if len(conversationContent) == 0 {
		log.Printf("No conversation content found for session %d, skipping summarization", p.SessionID)
		return map[string]interface{}{
			"status": "skipped",
			"reason": "no_content",
		}, nil
	}

	// Get session personality prompt from session record
	personalityPrompt, err := s.getSessionPersonalityPrompt(p.SessionID)
	if err != nil {
		log.Printf("Error getting session personality prompt: %v", err)
		personalityPrompt = ""
	}

	// Queue session summarization task
	metadata := taskqueue.SummarizationMetadata{
		OriginalLength: len(conversationContent),
		Mode:          "session",
		MaxLength:     200,
		Personality:   personalityPrompt,
	}

	log.Printf("Queuing summarization task for session %d", p.SessionID)
	task, err := s.queue.Add(
		taskqueue.TaskTypeSummarization,
		"gemma3n:latest",
		conversationContent,
		metadata,
		taskqueue.PriorityHigh,
		&p.SessionID,
	)
	if err != nil {
		log.Printf("Failed to queue summarization task: %v", err)
		return nil, fmt.Errorf("failed to queue summary task: %w", err)
	}
	log.Printf("Queued summarization task %d for session %d", task.ID, p.SessionID)

	// Mark session as ended
	if err := s.markSessionEnded(p.SessionID); err != nil {
		log.Printf("Failed to mark session as ended: %v", err)
	}

	return map[string]interface{}{
		"summary_task": task.ID,
		"status":       "queued",
	}, nil
}

// StatusParams represents status request
type StatusParams struct {
	Personality string   `json:"personality,omitempty"`
	MCPServers  []string `json:"mcp_servers,omitempty"`
	Context     bool     `json:"context,omitempty"`
	SessionType string   `json:"session_type,omitempty"`
}

// handleStatusGet returns status information (replaces dere-statusline)
func (s *Server) handleStatusGet(params json.RawMessage) (interface{}, error) {
	var p StatusParams
	if params != nil {
		json.Unmarshal(params, &p)
	}

	s.mu.RLock()
	queueStats := s.stats["queue"]
	s.mu.RUnlock()

	status := map[string]interface{}{
		"daemon": "running",
		"queue":  queueStats,
	}

	if p.Personality != "" {
		status["personality"] = p.Personality
	}
	if len(p.MCPServers) > 0 {
		status["mcp_servers"] = p.MCPServers
	}
	if p.Context {
		status["context_enabled"] = true
	}
	if p.SessionType != "" {
		status["session_type"] = p.SessionType
	}

	return status, nil
}

// QueueAddParams represents queue add request
type QueueAddParams struct {
	TaskType   string          `json:"task_type"`
	ModelName  string          `json:"model_name"`
	Content    string          `json:"content"`
	Metadata   json.RawMessage `json:"metadata"`
	Priority   int             `json:"priority"`
	SessionID  *int64          `json:"session_id,omitempty"`
}

// handleQueueAdd adds a task to the processing queue
func (s *Server) handleQueueAdd(params json.RawMessage) (interface{}, error) {
	var p QueueAddParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &RPCError{Code: -32602, Message: "Invalid params"}
	}

	task, err := s.queue.Add(
		taskqueue.TaskType(p.TaskType),
		p.ModelName,
		p.Content,
		p.Metadata, // Will be unmarshaled by processor
		p.Priority,
		p.SessionID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to queue task: %w", err)
	}

	return map[string]interface{}{
		"task_id": task.ID,
		"status":  "queued",
	}, nil
}

// handleQueueStatus returns queue statistics
func (s *Server) handleQueueStatus(params json.RawMessage) (interface{}, error) {
	stats, err := s.queue.GetStats()
	if err != nil {
		return nil, fmt.Errorf("failed to get queue stats: %w", err)
	}
	return stats, nil
}

// Helper methods

func (s *Server) getSessionContent(sessionID int64) (string, error) {
	sqlDB := s.db.GetDB()

	query := `
		SELECT prompt, message_type
		FROM conversations
		WHERE session_id = ?
		ORDER BY timestamp ASC
	`

	rows, err := sqlDB.Query(query, sessionID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var content string
	for rows.Next() {
		var prompt, messageType string
		if err := rows.Scan(&prompt, &messageType); err != nil {
			continue
		}

		// Format messages to distinguish between user and assistant
		if messageType == "assistant" {
			content += "Assistant: " + prompt + "\n\n"
		} else {
			content += "User: " + prompt + "\n\n"
		}
	}

	return content, nil
}

func (s *Server) markSessionEnded(sessionID int64) error {
	sqlDB := s.db.GetDB()

	updateSQL := `
		UPDATE sessions
		SET end_time = ?
		WHERE id = ?
	`

	_, err := sqlDB.Exec(updateSQL, time.Now().Unix(), sessionID)
	return err
}

func (s *Server) ensureSessionExists(sessionID int64, projectPath, personality string) error {
	sqlDB := s.db.GetDB()

	// Check if session already exists
	checkSQL := `SELECT COUNT(*) FROM sessions WHERE id = ?`
	var count int
	err := sqlDB.QueryRow(checkSQL, sessionID).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check session existence: %w", err)
	}

	// If session exists, return early
	if count > 0 {
		return nil
	}

	// Create new session with the exact session ID provided
	insertSQL := `
		INSERT INTO sessions (id, working_dir, start_time, project_type)
		VALUES (?, ?, ?, ?)
	`

	// Use current time as start time
	startTime := time.Now().Unix()

	// Extract project type from path if possible
	var projectType *string
	if projectPath != "" {
		pt := "unknown"
		projectType = &pt
	}

	_, err = sqlDB.Exec(insertSQL, sessionID, projectPath, startTime, projectType)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	// Store personality if provided
	if personality != "" {
		personalitySQL := `INSERT INTO session_personalities (session_id, personality_name) VALUES (?, ?)`
		_, err = sqlDB.Exec(personalitySQL, sessionID, personality)
		if err != nil {
			log.Printf("Failed to store session personality: %v", err)
		}
	}

	log.Printf("Created new session %d for project: %s with personality: %s", sessionID, projectPath, personality)
	return nil
}

func (s *Server) getSessionPersonality(sessionID int64) (string, error) {
	sqlDB := s.db.GetDB()

	query := `
		SELECT personality_name
		FROM session_personalities
		WHERE session_id = ?
		LIMIT 1
	`

	var personality string
	err := sqlDB.QueryRow(query, sessionID).Scan(&personality)
	if err != nil {
		return "", err
	}

	return personality, nil
}

func (s *Server) getSessionPersonalityPrompt(sessionID int64) (string, error) {
	personalityName, err := s.getSessionPersonality(sessionID)
	if err != nil {
		return "", err
	}

	// Load the personality using the personality system
	p, err := personality.CreatePersonality(personalityName)
	if err != nil {
		return "", err
	}

	return p.GetPrompt(), nil
}

func (s *Server) storeConversationWithoutEmbedding(sessionID int64, prompt, processingMode string) (int64, error) {
	return s.storeConversationWithoutEmbeddingAndType(sessionID, prompt, processingMode, "user")
}

func (s *Server) storeConversationWithoutEmbeddingAndType(sessionID int64, prompt, processingMode, messageType string) (int64, error) {
	sqlDB := s.db.GetDB()

	insertSQL := `
		INSERT INTO conversations (session_id, prompt, embedding_text, processing_mode, message_type, timestamp)
		VALUES (?, ?, ?, ?, ?, ?)
	`

	result, err := sqlDB.Exec(insertSQL, sessionID, prompt, "", processingMode, messageType, time.Now().Unix())
	if err != nil {
		return 0, fmt.Errorf("failed to store conversation without embedding: %w", err)
	}

	conversationID, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("failed to get conversation ID: %w", err)
	}

	return conversationID, nil
}

// ContextBuildParams represents context build request
type ContextBuildParams struct {
	SessionID       int64    `json:"session_id"`
	ProjectPath     string   `json:"project_path"`
	Personality     string   `json:"personality"`
	ContextDepth    int      `json:"context_depth"`
	IncludeEntities bool     `json:"include_entities"`
	MaxTokens       int      `json:"max_tokens"`
	ContextMode     string   `json:"context_mode"`
	CurrentPrompt   string   `json:"current_prompt"`
}

// handleContextBuild processes context building request
func (s *Server) handleContextBuild(params json.RawMessage) (interface{}, error) {
	var p ContextBuildParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &RPCError{Code: -32602, Message: "Invalid params"}
	}

	// Ensure session exists before queuing context building task
	if err := s.ensureSessionExists(p.SessionID, p.ProjectPath, p.Personality); err != nil {
		return nil, fmt.Errorf("failed to ensure session exists: %w", err)
	}

	// Set defaults
	if p.ContextDepth == 0 {
		p.ContextDepth = 5
	}
	if p.MaxTokens == 0 {
		p.MaxTokens = 2000
	}
	if p.ContextMode == "" {
		p.ContextMode = "smart"
	}

	// Queue context building task
	metadata := taskqueue.ContextBuildingMetadata{
		SessionID:       p.SessionID,
		ProjectPath:     p.ProjectPath,
		Personality:     p.Personality,
		ContextDepth:    p.ContextDepth,
		IncludeEntities: p.IncludeEntities,
		MaxTokens:       p.MaxTokens,
		ContextMode:     p.ContextMode,
		CurrentPrompt:   p.CurrentPrompt,
	}

	task, err := s.queue.Add(
		taskqueue.TaskTypeContextBuilding,
		"", // No model needed for context building
		p.CurrentPrompt,
		metadata,
		taskqueue.PriorityHigh, // Context building is high priority
		&p.SessionID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to queue context building task: %w", err)
	}

	return map[string]interface{}{
		"task_id": task.ID,
		"status":  "queued",
	}, nil
}

// ContextGetParams represents context retrieval request
type ContextGetParams struct {
	SessionID int64 `json:"session_id"`
	MaxAge    int   `json:"max_age_minutes"` // Maximum age in minutes
}

// handleContextGet retrieves cached context for a session
func (s *Server) handleContextGet(params json.RawMessage) (interface{}, error) {
	var p ContextGetParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &RPCError{Code: -32602, Message: "Invalid params"}
	}

	// Default to 30 minutes max age
	if p.MaxAge == 0 {
		p.MaxAge = 30
	}

	context, found := s.db.GetCachedContext(p.SessionID, time.Duration(p.MaxAge)*time.Minute)

	return map[string]interface{}{
		"found":   found,
		"context": context,
	}, nil
}