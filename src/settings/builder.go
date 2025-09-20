package settings

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"dere/src/config"
)

type SettingsBuilder struct {
	outputStyle    string
	hookScriptPath string
	personality    string
	tempFilePath   string
}

type ClaudeSettings struct {
	OutputStyle string                 `json:"outputStyle,omitempty"`
	Hooks       map[string]interface{} `json:"hooks,omitempty"`
	StatusLine  map[string]interface{} `json:"statusLine,omitempty"`
	Model       string                 `json:"model,omitempty"`
	Env         map[string]string      `json:"env,omitempty"`
}

type Hook struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	Timeout int    `json:"timeout,omitempty"`
}

type HookMatcher struct {
	Matcher string `json:"matcher"`
	Hooks   []Hook `json:"hooks"`
}

func NewSettingsBuilder(personality string, outputStyle string) *SettingsBuilder {
	return &SettingsBuilder{
		outputStyle:    outputStyle,
		personality:    personality,
		hookScriptPath: findHookScript(),
	}
}

func findHookScript() string {
	homeDir, _ := os.UserHomeDir()
	
	locations := []string{
		filepath.Join(homeDir, ".config", "dere", ".claude", "hooks", "dere-hook"),
		"./dere-hook",
		filepath.Join(filepath.Dir(os.Args[0]), "dere-hook"),
		filepath.Join(homeDir, ".config", "dere", ".claude", "hooks", "capture_embedding.py"),
	}
	
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			if abs, err := filepath.Abs(loc); err == nil {
				return abs
			}
			return loc
		}
	}
	
	return locations[0]
}

func (sb *SettingsBuilder) Build() (string, error) {
	settings := &ClaudeSettings{
		Hooks:      make(map[string]interface{}),
		StatusLine: make(map[string]interface{}),
		Env:        make(map[string]string),
	}

	if sb.outputStyle != "" {
		settings.OutputStyle = sb.outputStyle
	}

	if err := sb.addConversationHook(settings); err != nil {
		return "", fmt.Errorf("failed to add conversation hook: %w", err)
	}

	if err := sb.addStatusLine(settings); err != nil {
		return "", fmt.Errorf("failed to add status line: %w", err)
	}

	// Add all the hook environment data directly to settings.Env
	if err := sb.addHookEnvironment(settings); err != nil {
		return "", fmt.Errorf("failed to add hook environment: %w", err)
	}

	tempFile, err := sb.createTempFile(settings)
	if err != nil {
		return "", fmt.Errorf("failed to create temp settings file: %w", err)
	}

	sb.tempFilePath = tempFile
	return tempFile, nil
}

func (sb *SettingsBuilder) addConversationHook(settings *ClaudeSettings) error {
	if _, err := os.Stat(sb.hookScriptPath); err != nil {
		log.Printf("Hook script not found at %s: %v", sb.hookScriptPath, err)
		return nil
	}
	log.Printf("Adding UserPromptSubmit hook: %s", sb.hookScriptPath)

	hook := HookMatcher{
		Matcher: "",
		Hooks: []Hook{
			{
				Type:    "command",
				Command: sb.hookScriptPath,
			},
		},
	}

	settings.Hooks["UserPromptSubmit"] = []HookMatcher{hook}

	// Add SessionEnd hook for summarization if it exists
	sessionEndPath := sb.hookScriptPath + "-session-end"
	if _, err := os.Stat(sessionEndPath); err == nil {
		log.Printf("Adding SessionEnd hook: %s", sessionEndPath)
		sessionEndHook := HookMatcher{
			Matcher: "",
			Hooks: []Hook{
				{
					Type:    "command",
					Command: sessionEndPath,
				},
			},
		}
		settings.Hooks["SessionEnd"] = []HookMatcher{sessionEndHook}
	} else {
		log.Printf("SessionEnd hook not found at %s: %v", sessionEndPath, err)
	}

	return nil
}

func (sb *SettingsBuilder) addHookEnvironment(settings *ClaudeSettings) error {
	configSettings, _ := config.LoadSettings()

	// Add basic environment variables
	settings.Env["DERE_PERSONALITY"] = sb.personality
	settings.Env["DERE_DB_PATH"] = filepath.Join(os.Getenv("HOME"), ".local", "share", "dere", "dere.db")

	// Add session ID if set
	if sessionID := os.Getenv("DERE_SESSION_ID"); sessionID != "" {
		settings.Env["DERE_SESSION_ID"] = sessionID
	}

	// Add status line configuration from command line flags
	if mcpServers := os.Getenv("DERE_MCP_SERVERS"); mcpServers != "" {
		settings.Env["DERE_MCP_SERVERS"] = mcpServers
	}
	if customPrompts := os.Getenv("DERE_CUSTOM_PROMPTS"); customPrompts != "" {
		settings.Env["DERE_CUSTOM_PROMPTS"] = customPrompts
	}
	if context := os.Getenv("DERE_CONTEXT"); context != "" {
		settings.Env["DERE_CONTEXT"] = context
	}
	if sessionType := os.Getenv("DERE_SESSION_TYPE"); sessionType != "" {
		settings.Env["DERE_SESSION_TYPE"] = sessionType
	}
	if outputStyle := os.Getenv("DERE_OUTPUT_STYLE"); outputStyle != "" {
		settings.Env["DERE_OUTPUT_STYLE"] = outputStyle
	}

	// Add Ollama configuration if enabled
	if configSettings != nil && configSettings.Ollama.Enabled {
		settings.Env["DERE_OLLAMA_URL"] = configSettings.Ollama.URL
		settings.Env["DERE_OLLAMA_MODEL"] = configSettings.Ollama.EmbeddingModel
		settings.Env["DERE_SUMMARIZATION_MODEL"] = configSettings.Ollama.SummarizationModel
		settings.Env["DERE_SUMMARIZATION_THRESHOLD"] = fmt.Sprintf("%d", configSettings.Ollama.SummarizationThreshold)
	}

	return nil
}

func (sb *SettingsBuilder) createTempFile(settings *ClaudeSettings) (string, error) {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return "", err
	}
	
	pid := os.Getpid()
	tempPath := filepath.Join(os.TempDir(), fmt.Sprintf("dere-%d-settings.json", pid))
	
	if err := os.WriteFile(tempPath, data, 0644); err != nil {
		return "", err
	}
	
	return tempPath, nil
}

// addStatusLine adds custom status line configuration
func (sb *SettingsBuilder) addStatusLine(settings *ClaudeSettings) error {
	homeDir, _ := os.UserHomeDir()

	// Look for status line script
	statusLineScriptPath := filepath.Join(homeDir, ".config", "dere", ".claude", "hooks", "dere-statusline")

	// Check if we have a built-in statusline binary
	if _, err := os.Stat(statusLineScriptPath); err != nil {
		// Try to find it relative to the main binary
		if exePath, err := os.Executable(); err == nil {
			builtinPath := filepath.Join(filepath.Dir(exePath), "dere-statusline")
			if _, err := os.Stat(builtinPath); err == nil {
				statusLineScriptPath = builtinPath
			} else {
				// No status line script available
				return nil
			}
		} else {
			return nil
		}
	}

	settings.StatusLine = map[string]interface{}{
		"type":    "command",
		"command": statusLineScriptPath,
		"padding": 0,
	}

	return nil
}

func (sb *SettingsBuilder) Cleanup() error {
	if sb.tempFilePath != "" {
		os.Remove(sb.tempFilePath)
	}
	return nil
}

func GetPersonalityString(personalities []string) string {
	if len(personalities) == 0 {
		return "bare"
	}
	return strings.Join(personalities, "+")
}