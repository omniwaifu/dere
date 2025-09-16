package hooks

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	
	"dere/src/config"
)

type HookManager struct {
	originalSettings []byte
	settingsPath     string
	hookScriptPath   string
	personality      string
}

type ClaudeSettings struct {
	Env                  map[string]string       `json:"env,omitempty"`
	IncludeCoAuthoredBy  bool                   `json:"includeCoAuthoredBy,omitempty"`
	Permissions          interface{}            `json:"permissions,omitempty"`
	Hooks                map[string]interface{} `json:"hooks,omitempty"`
	Model                string                 `json:"model,omitempty"`
}

type Hook struct {
	Type    string `json:"type"`
	Command string `json:"command"`
}

type HookMatcher struct {
	Matcher string `json:"matcher"`
	Hooks   []Hook `json:"hooks"`
}

// findHookScript looks for the hook script in multiple locations
func findHookScript() string {
	homeDir, _ := os.UserHomeDir()
	
	// Check locations in priority order
	locations := []string{
		// 1. Installed location (Go binary)
		filepath.Join(homeDir, ".config", "dere", ".claude", "hooks", "dere-hook"),
		// 2. Development location (in current dir)
		"./dere-hook",
		// 3. Development location (absolute path from binary location)
		filepath.Join(filepath.Dir(os.Args[0]), "dere-hook"),
		// 4. Fallback to Python script if Go hook not found
		filepath.Join(homeDir, ".config", "dere", ".claude", "hooks", "capture_embedding.py"),
	}
	
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			// Return absolute path
			if abs, err := filepath.Abs(loc); err == nil {
				return abs
			}
			return loc
		}
	}
	
	// Return default location even if not found (will error later with helpful message)
	return locations[0]
}

// NewHookManager creates a new hook manager
func NewHookManager(personality string) *HookManager {
	homeDir, _ := os.UserHomeDir()
	
	// Try to find hook script in multiple locations
	hookScriptPath := findHookScript()
	
	return &HookManager{
		settingsPath:   filepath.Join(homeDir, ".claude", "settings.json"),
		hookScriptPath: hookScriptPath,
		personality:    personality,
	}
}

// Setup injects the dere hooks into Claude settings
func (h *HookManager) Setup() error {
	// Check if hook script exists
	if _, err := os.Stat(h.hookScriptPath); err != nil {
		return fmt.Errorf("hook script not found at %s - run scripts/install.sh to set up", h.hookScriptPath)
	}
	
	// First, backup existing settings.json
	if err := h.backupSettings(); err != nil {
		return fmt.Errorf("failed to backup settings: %w", err)
	}
	
	// Load current settings from global settings.json
	settings, err := h.loadSettings()
	if err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}
	
	// Add our hook to UserPromptSubmit
	if err := h.injectHook(settings); err != nil {
		return fmt.Errorf("failed to inject hook: %w", err)
	}
	
	// Save modified settings
	if err := h.saveSettings(settings); err != nil {
		return fmt.Errorf("failed to save settings: %w", err)
	}
	
	// Set environment variables for the hook script
	h.setEnvironment()
	
	return nil
}

// Cleanup restores original settings
func (h *HookManager) Cleanup() error {
	// Clean up the PID-specific hook config file
	pid := os.Getpid()
	configPath := filepath.Join(os.Getenv("HOME"), ".config", "dere", ".claude", fmt.Sprintf("hook_env_%d.json", pid))
	os.Remove(configPath) // Ignore errors
	
	// Also clean up old generic config if it exists
	oldConfigPath := filepath.Join(os.Getenv("HOME"), ".config", "dere", ".claude", "hook_env.json")
	os.Remove(oldConfigPath) // Ignore errors
	
	if h.originalSettings == nil {
		// No original settings to restore
		return nil
	} else {
		// Restore original settings
		if err := os.WriteFile(h.settingsPath, h.originalSettings, 0644); err != nil {
			return fmt.Errorf("failed to restore settings: %w", err)
		}
	}
	
	return nil
}

func (h *HookManager) backupSettings() error {
	data, err := os.ReadFile(h.settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No existing settings, that's fine
			h.originalSettings = nil
			return nil
		}
		return err
	}
	
	h.originalSettings = data
	return nil
}

func (h *HookManager) loadSettings() (*ClaudeSettings, error) {
	// Load existing global settings.json
	data, err := os.ReadFile(h.settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Create new settings with default structure
			return &ClaudeSettings{
				Hooks: make(map[string]interface{}),
			}, nil
		}
		return nil, err
	}
	
	var settings ClaudeSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}
	
	if settings.Hooks == nil {
		settings.Hooks = make(map[string]interface{})
	}
	
	return &settings, nil
}

func (h *HookManager) injectHook(settings *ClaudeSettings) error {
	// Write environment to a config file for the hook to read
	if err := h.writeHookConfig(); err != nil {
		return fmt.Errorf("failed to write hook config: %w", err)
	}
	
	// Use the Python script directly
	hookCommand := h.hookScriptPath
	
	// Create our hook configuration
	dereHook := HookMatcher{
		Matcher: "",
		Hooks: []Hook{
			{
				Type:    "command",
				Command: hookCommand,
			},
		},
	}
	
	// Get existing UserPromptSubmit hooks if any
	existingHooks := []HookMatcher{}
	if userPromptSubmit, exists := settings.Hooks["UserPromptSubmit"]; exists {
		// Convert to JSON and back to get proper type
		jsonData, _ := json.Marshal(userPromptSubmit)
		json.Unmarshal(jsonData, &existingHooks)
	}
	
	// Check if our hook is already there (check if it contains our script path)
	hookExists := false
	for _, matcher := range existingHooks {
		for _, hook := range matcher.Hooks {
			if strings.Contains(hook.Command, h.hookScriptPath) {
				hookExists = true
				break
			}
		}
	}
	
	// Add our hook if it doesn't exist
	if !hookExists {
		existingHooks = append(existingHooks, dereHook)
		settings.Hooks["UserPromptSubmit"] = existingHooks
	}
	
	return nil
}

func (h *HookManager) saveSettings(settings *ClaudeSettings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	
	// Ensure .claude directory exists
	claudeDir := filepath.Dir(h.settingsPath)
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		return err
	}
	
	return os.WriteFile(h.settingsPath, data, 0644)
}

func (h *HookManager) setEnvironment() {
	// Set environment variables for the hook script
	os.Setenv("DERE_PERSONALITY", h.personality)
	
	// Load config to get Ollama settings
	settings, err := config.LoadSettings()
	if err == nil && settings.Ollama.Enabled {
		os.Setenv("DERE_OLLAMA_URL", settings.Ollama.URL)
		os.Setenv("DERE_OLLAMA_MODEL", settings.Ollama.EmbeddingModel)
	}
	
	// Set database path
	homeDir, _ := os.UserHomeDir()
	dbPath := filepath.Join(homeDir, ".local", "share", "dere", "conversations.db")
	os.Setenv("DERE_DB_PATH", dbPath)
}

// writeHookConfig writes configuration for the hook to read
func (h *HookManager) writeHookConfig() error {
	configSettings, _ := config.LoadSettings()
	
	// Use PID for unique config file
	pid := os.Getpid()
	
	configData := map[string]interface{}{
		"pid": pid,
		"personality": h.personality,
		"timestamp": time.Now().Unix(),
		"db_path": filepath.Join(os.Getenv("HOME"), ".local", "share", "dere", "conversations.db"),
	}
	
	if configSettings != nil && configSettings.Ollama.Enabled {
		configData["ollama_url"] = configSettings.Ollama.URL
		configData["ollama_model"] = configSettings.Ollama.EmbeddingModel
		configData["summarization_model"] = configSettings.Ollama.SummarizationModel
		configData["summarization_threshold"] = configSettings.Ollama.SummarizationThreshold
	}
	
	// Write to PID-specific file
	configPath := filepath.Join(os.Getenv("HOME"), ".config", "dere", ".claude", fmt.Sprintf("hook_env_%d.json", pid))
	data, err := json.Marshal(configData)
	if err != nil {
		return err
	}
	
	return os.WriteFile(configPath, data, 0644)
}

// GetPersonalityString formats multiple personalities into a single string
func GetPersonalityString(personalities []string) string {
	if len(personalities) == 0 {
		return "bare"
	}
	return strings.Join(personalities, "+")
}