package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

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

func logDebug(format string, args ...interface{}) {
	debugLog := "/tmp/dere_hook_debug.log"
	f, err := os.OpenFile(debugLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	
	fmt.Fprintf(f, format+"\n", args...)
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

	// Always exit 0 to not block Claude
	os.Exit(0)
}