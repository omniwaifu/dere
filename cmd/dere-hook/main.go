package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	
	"dere/src/database"
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
	PID                    int    `json:"pid"`
	Personality            string `json:"personality"`
	Timestamp              int64  `json:"timestamp"`
	DBPath                 string `json:"db_path"`
	OllamaURL              string `json:"ollama_url"`
	OllamaModel            string `json:"ollama_model"`
	SummarizationModel     string `json:"summarization_model"`
	SummarizationThreshold int    `json:"summarization_threshold"`
}

type OllamaGenerateRequest struct {
	Model   string                 `json:"model"`
	Prompt  string                 `json:"prompt"`
	Stream  bool                   `json:"stream"`
	Options map[string]interface{} `json:"options,omitempty"`
}

type OllamaGenerateResponse struct {
	Response string `json:"response"`
}

type OllamaEmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type OllamaEmbedResponse struct {
	Embeddings [][]float32 `json:"embeddings"`
}

func findValidConfig() (*HookConfig, error) {
	homeDir, _ := os.UserHomeDir()
	
	// Look for PID-specific config files
	pattern := filepath.Join(homeDir, ".config", "dere", ".claude", "hook_env_*.json")
	files, _ := filepath.Glob(pattern)
	
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		
		var config HookConfig
		if err := json.Unmarshal(data, &config); err != nil {
			continue
		}
		
		// Check if PID is still alive (basic check - file exists in /proc)
		if _, err := os.Stat(fmt.Sprintf("/proc/%d", config.PID)); err == nil {
			return &config, nil
		}
		
		// Clean up stale config
		os.Remove(file)
	}
	
	return nil, fmt.Errorf("no valid config found")
}

func summarizeWithGemma(text string, mode string, config *HookConfig) (string, error) {
	var prompt string
	
	if mode == "light" {
		prompt = fmt.Sprintf(`Briefly summarize this message, preserving key technical terms and the user's main question.
Keep it under 100 words. Focus on what the user is asking about.

Message: %s

Summary:`, text)
	} else { // extract mode
		prompt = fmt.Sprintf(`Analyze this conversation message and output ONLY:
1. The user's actual question or request (one line)
2. Topics from any included content (keywords only)
3. Content type if pasted (article/code/log/data)

Be extremely concise. Optimize for semantic search, not readability.

Message: %s

Output:`, text)
	}
	
	req := OllamaGenerateRequest{
		Model:  config.SummarizationModel,
		Prompt: prompt,
		Stream: false,
		Options: map[string]interface{}{
			"temperature":  0.3,
			"num_predict": 150,
		},
	}
	
	jsonData, _ := json.Marshal(req)
	
	// Create HTTP client with longer timeout for summarization
	client := &http.Client{Timeout: 120 * time.Second}
	
	resp, err := client.Post(
		fmt.Sprintf("%s/api/generate", config.OllamaURL),
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("ollama returned status %d", resp.StatusCode)
	}
	
	body, _ := io.ReadAll(resp.Body)
	var result OllamaGenerateResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	
	return strings.TrimSpace(result.Response), nil
}

func processForEmbedding(text string, config *HookConfig) (string, string) {
	charCount := len(text)
	logDebug("processForEmbedding: Starting with %d chars", charCount)
	
	if charCount < config.SummarizationThreshold {
		logDebug("processForEmbedding: Below threshold, returning direct")
		return text, "direct"
	}
	
	var mode string
	if charCount < 2000 {
		mode = "light"
	} else {
		mode = "extract"
	}
	logDebug("processForEmbedding: Using mode %s for summarization", mode)
	
	summary, err := summarizeWithGemma(text, mode, config)
	if err == nil && summary != "" {
		processed := fmt.Sprintf("%s [Original: %d chars]", summary, charCount)
		logDebug("processForEmbedding: Summarization successful, result length: %d", len(processed))
		return processed, mode
	}
	
	// Fallback to truncation only if summarization failed
	if err != nil {
		logDebug("processForEmbedding: Summarization failed: %v", err)
		if charCount > 2500 {
			truncated := text[:2000] + "\n[...truncated...]\n"
			if len(text) > 2500 {
				truncated += text[len(text)-500:]
			}
			logDebug("processForEmbedding: Returning truncated text, length: %d", len(truncated))
			return truncated, "truncated"
		}
	}
	
	logDebug("processForEmbedding: Returning original text as direct")
	return text, "direct"
}

func getEmbedding(text string, config *HookConfig) ([]float32, error) {
	req := OllamaEmbedRequest{
		Model: config.OllamaModel,
		Input: text,
	}
	
	jsonData, _ := json.Marshal(req)
	
	// Create HTTP client with timeout (embeddings can take longer)
	client := &http.Client{Timeout: 120 * time.Second}
	
	// Retry logic with exponential backoff
	maxRetries := 3
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 1s, 2s, 4s
			delay := time.Duration(1<<uint(attempt-1)) * time.Second
			logDebug("Retrying embedding after %v delay (attempt %d/%d)", delay, attempt+1, maxRetries)
			time.Sleep(delay)
		}
		
		resp, err := client.Post(
			fmt.Sprintf("%s/api/embed", config.OllamaURL),
			"application/json",
			bytes.NewBuffer(jsonData),
		)
		
		if err != nil {
			if attempt == maxRetries-1 {
				return nil, fmt.Errorf("embedding failed after %d attempts: %w", maxRetries, err)
			}
			continue // Retry
		}
		defer resp.Body.Close()
		
		if resp.StatusCode != 200 {
			if attempt == maxRetries-1 {
				return nil, fmt.Errorf("ollama returned status %d after %d attempts", resp.StatusCode, maxRetries)
			}
			continue // Retry
		}
		
		body, _ := io.ReadAll(resp.Body)
		var result OllamaEmbedResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse embedding response: %w", err)
		}
		
		if len(result.Embeddings) > 0 {
			return result.Embeddings[0], nil
		}
		
		if attempt == maxRetries-1 {
			return nil, fmt.Errorf("no embeddings returned after %d attempts", maxRetries)
		}
	}
	
	return nil, fmt.Errorf("unexpected error in embedding retry loop")
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
	// Load configuration
	config, err := findValidConfig()
	if err != nil {
		// No valid dere session, exit silently
		os.Exit(0)
	}
	
	// Log startup
	logDebug("\n--- Hook called at %s ---", time.Now().Format(time.RFC1123))
	logDebug("Config loaded, PID: %d, Personality: %s", config.PID, config.Personality)
	
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
	
	// Process message for optimal embedding
	processedText, processingMode := processForEmbedding(hookInput.Prompt, config)
	logDebug("Processing mode: %s, Processed length: %d", processingMode, len(processedText))
	
	// Get embedding
	embedding, err := getEmbedding(processedText, config)
	if err != nil {
		logDebug("Failed to get embedding: %v", err)
		// Don't fail the hook
		embedding = nil
	}
	
	// Store in database
	db, err := database.NewTursoDB(config.DBPath)
	if err != nil {
		logDebug("Failed to open database: %v", err)
		os.Exit(0)
	}
	defer db.Close()
	
	err = db.Store(
		hookInput.SessionID,
		hookInput.CWD,
		config.Personality,
		hookInput.Prompt,
		processedText,
		processingMode,
		embedding,
	)
	
	if err != nil {
		logDebug("Failed to store conversation: %v", err)
	}
	
	// Always exit 0 to not block Claude
	os.Exit(0)
}