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

type HookInput struct {
	SessionID    string `json:"session_id"`
	TranscriptPath string `json:"transcript_path"`
	CWD          string `json:"cwd"`
	PermissionMode string `json:"permission_mode"`
	HookEventName string `json:"hook_event_name"`
	Prompt       string `json:"prompt"`
}

type HookConfig struct {
	Personality            string
	DBPath                 string
	SessionID              string
	OllamaModel            string
	SummarizationThreshold int
}


func loadConfigFromEnv() (*HookConfig, error) {
	config := &HookConfig{
		Personality: os.Getenv("DERE_PERSONALITY"),
		DBPath:      os.Getenv("DERE_DB_PATH"),
		SessionID:   os.Getenv("DERE_SESSION_ID"),
		OllamaModel: os.Getenv("DERE_OLLAMA_MODEL"),
	}

	// Parse summarization threshold
	if thresholdStr := os.Getenv("DERE_SUMMARIZATION_THRESHOLD"); thresholdStr != "" {
		if threshold, err := strconv.Atoi(thresholdStr); err == nil {
			config.SummarizationThreshold = threshold
		} else {
			config.SummarizationThreshold = 500
		}
	} else {
		config.SummarizationThreshold = 500
	}

	// Validate required fields
	if config.DBPath == "" || config.SessionID == "" {
		return nil, fmt.Errorf("required environment variables not set")
	}

	return config, nil
}

func determineProcessingMode(text string, config *HookConfig) string {
	charCount := len(text)

	if charCount < config.SummarizationThreshold {
		return "direct"
	}

	if charCount < 2000 {
		return "light"
	}

	return "extract"
}

func determineContextHint(cwd, text string) string {
	// Check for code-related indicators
	codeIndicators := []string{
		"function", "class", "import", "package", "module",
		"def ", "async ", "await ", "const ", "let ", "var ",
		"git ", "npm ", "yarn ", "pip ", "cargo ", "go mod",
		"docker", "kubernetes", "api", "endpoint", "database",
		".js", ".py", ".go", ".rs", ".java", ".cpp", ".c",
		"error", "bug", "debug", "test", "unit test",
	}

	lowerText := strings.ToLower(text)
	codeCount := 0
	for _, indicator := range codeIndicators {
		if strings.Contains(lowerText, indicator) {
			codeCount++
		}
	}

	// Check working directory for project type
	if strings.Contains(cwd, "src") || strings.Contains(cwd, "code") ||
	   strings.Contains(cwd, "dev") || strings.Contains(cwd, "project") {
		codeCount += 2
	}

	// Project indicators
	projectIndicators := []string{
		"project", "sprint", "deadline", "milestone", "team",
		"meeting", "standup", "requirements", "specification",
		"deliverable", "scope", "roadmap", "backlog",
	}

	projectCount := 0
	for _, indicator := range projectIndicators {
		if strings.Contains(lowerText, indicator) {
			projectCount++
		}
	}

	// Determine context based on indicators
	if codeCount >= 3 {
		return "coding"
	} else if projectCount >= 2 {
		return "project"
	} else {
		return "general"
	}
}

func logDebug(format string, args ...interface{}) {
	debugLog := "/tmp/dere_hook_debug.log"
	f, err := os.OpenFile(debugLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	fmt.Fprintf(f, format+"\n", args...)
}

// storeConversation stores the user prompt in the conversations table
func storeConversation(dbPath string, sessionID int64, prompt string, processingMode string) error {
	db, err := database.NewTursoDB(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer db.Close()

	sqlDB := db.GetDB()

	// Insert conversation record
	query := `
		INSERT INTO conversations (session_id, prompt, processing_mode, timestamp)
		VALUES (?, ?, ?, ?)
	`

	timestamp := time.Now().Unix()
	_, err = sqlDB.Exec(query, sessionID, prompt, processingMode, timestamp)
	if err != nil {
		return fmt.Errorf("failed to insert conversation: %w", err)
	}

	return nil
}

func main() {
	// Load configuration from environment
	config, err := loadConfigFromEnv()
	if err != nil {
		// No valid dere session, exit silently
		os.Exit(0)
	}

	// Log startup
	logDebug("\n--- Hook called at %s ---", time.Now().Format(time.RFC1123))
	logDebug("Config loaded, Personality: %s", config.Personality)

	// Parse hook input from stdin
	var hookInput HookInput
	decoder := json.NewDecoder(os.Stdin)
	if err := decoder.Decode(&hookInput); err != nil {
		logDebug("Failed to parse hook input: %v", err)
		os.Exit(0)
	}

	// Log the input
	logDebug("Session: %s, CWD: %s", hookInput.SessionID, hookInput.CWD)
	logDebug("Prompt length: %d chars", len(hookInput.Prompt))

	// Skip if no prompt
	if hookInput.Prompt == "" {
		os.Exit(0)
	}

	// Parse session ID
	sessionID, err := strconv.ParseInt(config.SessionID, 10, 64)
	if err != nil {
		logDebug("Failed to parse session_id: %v", err)
		os.Exit(0)
	}

	// Open task queue
	queue, err := taskqueue.NewQueue(config.DBPath)
	if err != nil {
		logDebug("Failed to open task queue: %v", err)
		os.Exit(0)
	}
	defer queue.Close()

	// Determine processing mode for embedding
	processingMode := determineProcessingMode(hookInput.Prompt, config)
	logDebug("Processing mode: %s", processingMode)

	// Create embedding metadata
	metadata := taskqueue.EmbeddingMetadata{
		OriginalLength: len(hookInput.Prompt),
		ProcessingMode: processingMode,
		ContentType:    "prompt",
	}

	// Queue embedding task with high priority (user prompts are important)
	task, err := queue.Add(
		taskqueue.TaskTypeEmbedding,
		config.OllamaModel,
		hookInput.Prompt,
		metadata,
		taskqueue.PriorityHigh,
		&sessionID,
	)

	if err != nil {
		logDebug("Failed to queue embedding task: %v", err)
	} else {
		logDebug("Queued embedding task %d for processing", task.ID)
	}

	// Queue entity extraction task for semantic analysis
	contextHint := determineContextHint(hookInput.CWD, hookInput.Prompt)
	entityMetadata := taskqueue.EntityExtractionMetadata{
		OriginalLength: len(hookInput.Prompt),
		ContentType:    "prompt",
		ContextHint:    contextHint,
	}

	entityTask, err := queue.Add(
		taskqueue.TaskTypeEntityExtraction,
		"gemma3n:latest",
		hookInput.Prompt,
		entityMetadata,
		taskqueue.PriorityNormal,
		&sessionID,
	)

	if err != nil {
		logDebug("Failed to queue entity extraction task: %v", err)
	} else {
		logDebug("Queued entity extraction task %d for processing", entityTask.ID)
	}

	// If text is long, also queue a summarization task
	if len(hookInput.Prompt) > config.SummarizationThreshold {
		sumMetadata := taskqueue.SummarizationMetadata{
			OriginalLength: len(hookInput.Prompt),
			Mode:          processingMode,
			MaxLength:     150,
		}

		sumTask, err := queue.Add(
			taskqueue.TaskTypeSummarization,
			"gemma3n:latest",
			hookInput.Prompt,
			sumMetadata,
			taskqueue.PriorityNormal,
			&sessionID,
		)

		if err != nil {
			logDebug("Failed to queue summarization task: %v", err)
		} else {
			logDebug("Queued summarization task %d for processing", sumTask.ID)
		}
	}

	// Store conversation in database for future summarization
	if err := storeConversation(config.DBPath, sessionID, hookInput.Prompt, processingMode); err != nil {
		logDebug("Failed to store conversation: %v", err)
	}

	// Always exit 0 to not block Claude
	os.Exit(0)
}