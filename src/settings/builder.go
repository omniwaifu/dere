package settings

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"dere/src/config"
	"dere/src/personality"
)

type SettingsBuilder struct {
	outputStyle         string
	hookScriptPath      string
	contextHookPath     string
	sessionEndHookPath  string
	stopHookPath        string
	wellnessHookPath    string
	statusLineHookPath  string
	personality         string
	tempFilePath        string
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
	homeDir, _ := os.UserHomeDir()
	hooksDir := filepath.Join(homeDir, ".config", "dere", "hooks")

	return &SettingsBuilder{
		outputStyle:         outputStyle,
		personality:         personality,
		hookScriptPath:      filepath.Join(hooksDir, "dere-hook.py"),
		contextHookPath:     filepath.Join(hooksDir, "dere-context-hook.py"),
		sessionEndHookPath:  filepath.Join(hooksDir, "dere-hook-session-end.py"),
		stopHookPath:        filepath.Join(hooksDir, "dere-stop-hook.py"),
		wellnessHookPath:    filepath.Join(hooksDir, "dere-wellness-hook.py"),
		statusLineHookPath:  filepath.Join(hooksDir, "dere-statusline.py"),
	}
}

func findHookScript() string {
	homeDir, _ := os.UserHomeDir()

	locations := []string{
		filepath.Join(homeDir, ".config", "dere", "hooks", "dere-hook.py"),
		"./dere-hook.py",
		filepath.Join(filepath.Dir(os.Args[0]), "dere-hook.py"),
		filepath.Join(homeDir, ".config", "dere", "hooks", "capture_embedding.py"),
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

	// Handle output style - check for mode-specific styles first
	if sb.outputStyle != "" {
		modeContent := sb.findModeFile(sb.outputStyle)
		if modeContent != "" {
			settings.OutputStyle = modeContent
		} else {
			// No mode file found, use the output style as-is
			settings.OutputStyle = sb.outputStyle
		}
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
	var hooks []HookMatcher

	// Add context hook first if it exists (runs before capture hook)
	if _, err := os.Stat(sb.contextHookPath); err == nil {
		log.Printf("Adding context injection hook: %s", sb.contextHookPath)
		contextHook := HookMatcher{
			Matcher: "",
			Hooks: []Hook{
				{
					Type:    "command",
					Command: sb.contextHookPath,
				},
			},
		}
		hooks = append(hooks, contextHook)
	}

	// Add capture hook if it exists
	if _, err := os.Stat(sb.hookScriptPath); err == nil {
		log.Printf("Adding capture hook: %s", sb.hookScriptPath)
		captureHook := HookMatcher{
			Matcher: "",
			Hooks: []Hook{
				{
					Type:    "command",
					Command: sb.hookScriptPath,
				},
			},
		}
		hooks = append(hooks, captureHook)
	}

	if len(hooks) > 0 {
		settings.Hooks["UserPromptSubmit"] = hooks
	}

	// Add SessionEnd hook for summarization if it exists
	if _, err := os.Stat(sb.sessionEndHookPath); err == nil {
		log.Printf("Adding SessionEnd hook: %s", sb.sessionEndHookPath)
		sessionEndHook := HookMatcher{
			Matcher: "",
			Hooks: []Hook{
				{
					Type:    "command",
					Command: sb.sessionEndHookPath,
				},
			},
		}
		settings.Hooks["SessionEnd"] = []HookMatcher{sessionEndHook}
	} else {
		log.Printf("SessionEnd hook not found at %s: %v", sb.sessionEndHookPath, err)
	}

	// Add Stop hook for capturing Claude responses if it exists
	if _, err := os.Stat(sb.stopHookPath); err == nil {
		log.Printf("Adding Stop hook: %s", sb.stopHookPath)
		stopHook := HookMatcher{
			Matcher: "",
			Hooks: []Hook{
				{
					Type:    "command",
					Command: sb.stopHookPath,
				},
			},
		}

		// Check if we already have existing SessionEnd hooks
		if existingSessionEnd, exists := settings.Hooks["SessionEnd"]; exists {
			// Add to existing SessionEnd hooks
			if sessionEndHooks, ok := existingSessionEnd.([]HookMatcher); ok {
				// Add wellness hook for mental health modes
				if sb.isMentalHealthMode() {
					if _, err := os.Stat(sb.wellnessHookPath); err == nil {
						log.Printf("Adding wellness hook for mental health mode: %s", sb.wellnessHookPath)
						wellnessHook := HookMatcher{
							Matcher: "",
							Hooks: []Hook{
								{
									Type:    "command",
									Command: sb.wellnessHookPath,
								},
							},
						}
						sessionEndHooks = append(sessionEndHooks, wellnessHook)
						settings.Hooks["SessionEnd"] = sessionEndHooks
					}
				}
			}
		} else {
			// No existing SessionEnd hooks, create array with wellness hook if needed
			if sb.isMentalHealthMode() {
				if _, err := os.Stat(sb.wellnessHookPath); err == nil {
					log.Printf("Adding wellness hook for mental health mode: %s", sb.wellnessHookPath)
					wellnessHook := HookMatcher{
						Matcher: "",
						Hooks: []Hook{
							{
								Type:    "command",
								Command: sb.wellnessHookPath,
							},
						},
					}
					settings.Hooks["SessionEnd"] = []HookMatcher{wellnessHook}
				}
			}
		}

		settings.Hooks["Stop"] = []HookMatcher{stopHook}
	} else {
		log.Printf("Stop hook not found at %s: %v", sb.stopHookPath, err)
	}

	return nil
}

func (sb *SettingsBuilder) addHookEnvironment(settings *ClaudeSettings) error {
	configSettings, _ := config.LoadSettings()

	// Add basic environment variables
	settings.Env["DERE_PERSONALITY"] = sb.personality
	settings.Env["DERE_DB_PATH"] = filepath.Join(os.Getenv("HOME"), ".local", "share", "dere", "dere.db")

	// Extract and export personality display configuration
	// Parse the first personality from the personality string
	if sb.personality != "" && sb.personality != "bare" {
		personalities := strings.Split(sb.personality, "+")
		if len(personalities) > 0 {
			// Load the first personality to get display config
			pers, err := personality.CreatePersonality(personalities[0])
			if err == nil {
				settings.Env["DERE_PERSONALITY_COLOR"] = pers.GetColor()
				settings.Env["DERE_PERSONALITY_ICON"] = pers.GetIcon()
			}
		}
	}

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
	// Check if we have a built-in statusline binary
	if _, err := os.Stat(sb.statusLineHookPath); err != nil {
		// Try to find it relative to the main binary
		if exePath, err := os.Executable(); err == nil {
			builtinPath := filepath.Join(filepath.Dir(exePath), "dere-statusline")
			if _, err := os.Stat(builtinPath); err == nil {
				sb.statusLineHookPath = builtinPath
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
		"command": sb.statusLineHookPath,
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

// findModeFile looks for mode files in multiple locations
func (sb *SettingsBuilder) findModeFile(modeName string) string {
	homeDir, _ := os.UserHomeDir()

	// Try locations in order of preference
	locations := []string{
		// User config directory (highest priority)
		filepath.Join(homeDir, ".config", "dere", "modes", modeName+".md"),
		// System-wide installation
		filepath.Join("/usr/local/share/dere/modes", modeName+".md"),
		// Development/source directory fallback
		filepath.Join("prompts", "modes", modeName+".md"),
	}

	for _, location := range locations {
		if content, err := os.ReadFile(location); err == nil {
			log.Printf("Using mode-specific output style: %s", location)
			return string(content)
		}
	}

	return ""
}

// isMentalHealthMode checks if we're currently in a mental health mode
func (sb *SettingsBuilder) isMentalHealthMode() bool {
	mode := os.Getenv("DERE_MODE")
	mentalHealthModes := []string{"checkin", "cbt", "therapy", "mindfulness", "goals"}

	for _, mhMode := range mentalHealthModes {
		if mode == mhMode {
			return true
		}
	}
	return false
}