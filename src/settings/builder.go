package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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
		Hooks: make(map[string]interface{}),
		Env:   make(map[string]string),
	}
	
	if sb.outputStyle != "" {
		settings.OutputStyle = sb.outputStyle
	}
	
	if err := sb.addConversationHook(settings); err != nil {
		return "", fmt.Errorf("failed to add conversation hook: %w", err)
	}
	
	if err := sb.writeHookConfig(); err != nil {
		return "", fmt.Errorf("failed to write hook config: %w", err)
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
		return nil
	}
	
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
	
	return nil
}

func (sb *SettingsBuilder) writeHookConfig() error {
	configSettings, _ := config.LoadSettings()
	
	pid := os.Getpid()
	
	configData := map[string]interface{}{
		"pid":         pid,
		"personality": sb.personality,
		"timestamp":   time.Now().Unix(),
		"db_path":     filepath.Join(os.Getenv("HOME"), ".local", "share", "dere", "conversations.db"),
	}
	
	if configSettings != nil && configSettings.Ollama.Enabled {
		configData["ollama_url"] = configSettings.Ollama.URL
		configData["ollama_model"] = configSettings.Ollama.EmbeddingModel
		configData["summarization_model"] = configSettings.Ollama.SummarizationModel
		configData["summarization_threshold"] = configSettings.Ollama.SummarizationThreshold
	}
	
	configDir := filepath.Join(os.Getenv("HOME"), ".config", "dere", ".claude")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}
	
	configPath := filepath.Join(configDir, fmt.Sprintf("hook_env_%d.json", pid))
	data, err := json.Marshal(configData)
	if err != nil {
		return err
	}
	
	return os.WriteFile(configPath, data, 0644)
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

func (sb *SettingsBuilder) Cleanup() error {
	if sb.tempFilePath != "" {
		os.Remove(sb.tempFilePath)
	}
	
	pid := os.Getpid()
	configPath := filepath.Join(os.Getenv("HOME"), ".config", "dere", ".claude", fmt.Sprintf("hook_env_%d.json", pid))
	os.Remove(configPath)
	
	return nil
}

func GetPersonalityString(personalities []string) string {
	if len(personalities) == 0 {
		return "bare"
	}
	return strings.Join(personalities, "+")
}