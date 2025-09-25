package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	"path/filepath"

	"dere/src/commands"
	"dere/src/composer"
	"dere/src/database"
	"dere/src/mcp"
	"dere/src/settings"

	"github.com/spf13/cobra"
)

// runDere is the main execution function when no subcommand is specified
func runDere(cmd *cobra.Command, args []string) error {
	config := GetConfig()
	config.ExtraArgs = args // Args after flags are Claude args

	// Generate session ID for hooks to use - daemon will create the actual session
	sessionID := generateSessionID()
	os.Setenv("DERE_SESSION_ID", strconv.FormatInt(sessionID, 10))

	// Set environment variables for status line and hooks
	if len(config.MCPServers) > 0 {
		os.Setenv("DERE_MCP_SERVERS", strings.Join(config.MCPServers, ","))
	}
	if len(config.CustomPrompts) > 0 {
		os.Setenv("DERE_CUSTOM_PROMPTS", strings.Join(config.CustomPrompts, ","))
	}
	if config.Context {
		os.Setenv("DERE_CONTEXT", "true")
	}
	if config.OutputStyle != "" {
		os.Setenv("DERE_OUTPUT_STYLE", config.OutputStyle)
	}
	if config.Mode != "" {
		os.Setenv("DERE_MODE", config.Mode)
	}

	// Set context building environment variables
	if config.IncludeHistory {
		os.Setenv("DERE_INCLUDE_HISTORY", "true")
		os.Setenv("DERE_CONTEXT_DEPTH", strconv.Itoa(config.ContextDepth))
		os.Setenv("DERE_CONTEXT_MODE", config.ContextMode)
		os.Setenv("DERE_MAX_CONTEXT_TOKENS", strconv.Itoa(config.MaxContextTokens))
	}

	// Determine session type
	sessionType := "new"
	if config.Continue {
		sessionType = "continue"
	} else if config.Resume != "" {
		sessionType = "resume"
	}
	os.Setenv("DERE_SESSION_TYPE", sessionType)

	// Setup settings builder for dynamic configuration
	personalityStr := settings.GetPersonalityString(config.Personalities)

	// Handle mode-specific output styles
	effectiveOutputStyle := config.OutputStyle
	if config.Mode != "" && config.OutputStyle == "" {
		// Mode specified but no explicit output style - use mode-based style
		effectiveOutputStyle = config.Mode
	}

	settingsBuilder := settings.NewSettingsBuilder(personalityStr, effectiveOutputStyle)
	
	// Build settings file
	settingsPath, err := settingsBuilder.Build()
	if err != nil {
		// Log but don't fail - settings are optional enhancement
		log.Printf("Warning: Failed to build settings: %v", err)
		settingsPath = ""
	}
	// Setup command generator for personality-specific commands
	commandGenerator := commands.NewCommandGenerator(config.Personalities)
	if config.Mode != "" {
		commandGenerator.SetMode(config.Mode)
	}
	if len(config.MCPServers) > 0 {
		commandGenerator.SetMCPServers(config.MCPServers)
	}
	if err := commandGenerator.Generate(); err != nil {
		log.Printf("Warning: Failed to generate commands: %v", err)
	}
	
	defer func() {
		if settingsPath != "" {
			os.Remove(settingsPath)
		}
		settingsBuilder.Cleanup()
		commandGenerator.Cleanup()
	}()

	// Compose the layered system prompt
	systemPrompt, err := composer.ComposePrompt(
		config.Personalities,
		config.CustomPrompts,
		config.Context,
	)
	if err != nil {
		return err
	}

	// Automatically enable history for mental health modes
	includeHistoryForMode := config.IncludeHistory || (config.Mode != "" && !config.Bare)

	// Build context if history is enabled
	if includeHistoryForMode && !config.Bare {
		context, err := buildSessionContext(sessionID, config)
		if err != nil {
			// Log warning but don't fail - context is enhancement
			log.Printf("Warning: Failed to build context: %v", err)
		} else if context != "" {
			// Inject context into system prompt
			systemPrompt = composer.InjectContext(systemPrompt, context)
		}
	}

	// Build mode-specific context for session continuity
	if config.Mode != "" && !config.Bare {
		modeContext, err := buildModeContext(sessionID, config)
		if err != nil {
			// Log warning but don't fail - mode context is enhancement
			log.Printf("Warning: Failed to build mode context: %v", err)
		} else if modeContext != "" {
			// Inject mode context into system prompt
			systemPrompt = composer.InjectContext(systemPrompt, "Session Continuity: "+modeContext)
		}
	}

	// Launch claude with the assembled prompt
	claudePath, err := exec.LookPath("claude")
	if err != nil {
		return err
	}

	// Build the command arguments
	var claudeArgs []string
	
	// Add continue/resume flags
	if config.Continue {
		claudeArgs = append(claudeArgs, "-c")
	} else if config.Resume != "" {
		claudeArgs = append(claudeArgs, "-r", config.Resume)
	}
	
	// Add model configuration
	if config.Model != "" {
		claudeArgs = append(claudeArgs, "--model", config.Model)
	}
	if config.FallbackModel != "" {
		claudeArgs = append(claudeArgs, "--fallback-model", config.FallbackModel)
	}
	
	// Add permission mode
	if config.PermissionMode != "" {
		claudeArgs = append(claudeArgs, "--permission-mode", config.PermissionMode)
	}
	
	// Add tool restrictions
	if len(config.AllowedTools) > 0 {
		claudeArgs = append(claudeArgs, "--allowed-tools", strings.Join(config.AllowedTools, ","))
	}
	if len(config.DisallowedTools) > 0 {
		claudeArgs = append(claudeArgs, "--disallowed-tools", strings.Join(config.DisallowedTools, ","))
	}
	
	// Add additional directories
	for _, dir := range config.AddDirs {
		claudeArgs = append(claudeArgs, "--add-dir", dir)
	}
	
	// Add IDE flag
	if config.IDE {
		claudeArgs = append(claudeArgs, "--ide")
	}
	
	// Add settings file if generated
	if settingsPath != "" {
		claudeArgs = append(claudeArgs, "--settings", settingsPath)
	}
	
	// Only add system prompt if not in bare mode
	if systemPrompt != "" {
		claudeArgs = append(claudeArgs, "--append-system-prompt", systemPrompt)
	}
	
	// Add passthrough args (these should be flags/options for Claude)
	claudeArgs = append(claudeArgs, config.PassthroughArgs...)

	// Add MCP configuration if specified - must come after other flags
	if len(config.MCPServers) > 0 {
		// Use dere's MCP config first, fallback to Claude Desktop if needed
		mcpConfig, err := mcp.BuildMCPConfigFromDere(config.MCPServers)
		if err != nil {
			// Fallback to legacy Claude Desktop config
			log.Printf("Warning: Failed to use dere MCP config, falling back to Claude Desktop: %v", err)
			mcpConfig, err = mcp.BuildMCPConfigFromClaudeDesktop(config.MCPServers, config.MCPConfigPath)
			if err != nil {
				return err
			}
		}
		if mcpConfig != "" {
			claudeArgs = append(claudeArgs, "--mcp-config", mcpConfig)
		}
	}

	// Add "--" separator to indicate end of flags if we have a prompt
	hasPrompt := len(config.ExtraArgs) > 0 || (config.Mode != "" && !config.Bare)
	if hasPrompt {
		claudeArgs = append(claudeArgs, "--")
	}

	// For mental health modes, prepare an automatic initiation prompt
	var initPrompt string
	if config.Mode != "" && !config.Bare {
		// Use the generic wellness command
		initPrompt = "/dere-wellness"
	}

	// Add extra args if no initial prompt, otherwise add the prompt
	// Extra args are treated as the initial prompt by Claude if present
	if len(config.ExtraArgs) > 0 {
		// User provided their own prompt/command, use that instead
		claudeArgs = append(claudeArgs, config.ExtraArgs...)
	} else if initPrompt != "" {
		// No user prompt, use the mode-specific initial prompt
		claudeArgs = append(claudeArgs, initPrompt)
	}

	// Create command to run Claude as child process
	claudeCmd := exec.Command(claudePath, claudeArgs...)
	claudeCmd.Stdin = os.Stdin
	claudeCmd.Stdout = os.Stdout
	claudeCmd.Stderr = os.Stderr
	claudeCmd.Env = os.Environ()
	
	// Start Claude
	if err := claudeCmd.Start(); err != nil {
		return err
	}
	
	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	
	// Wait for either Claude to exit or signal
	done := make(chan error, 1)
	go func() {
		done <- claudeCmd.Wait()
	}()
	
	select {
	case <-sigChan:
		// Signal received, forward to Claude and give it time to clean up
		claudeCmd.Process.Signal(os.Interrupt)
		
		// Give Claude 5 seconds to exit gracefully
		timer := time.NewTimer(5 * time.Second)
		select {
		case <-done:
			timer.Stop()
		case <-timer.C:
			// Force kill if it didn't exit
			claudeCmd.Process.Kill()
			<-done
		}
	case err := <-done:
		// Claude exited on its own
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				// Preserve Claude's exit code
				if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
					os.Exit(status.ExitStatus())
				}
			}
			return err
		}
	}
	
	return nil
}

// generateSessionID creates a unique session ID
func generateSessionID() int64 {
	return time.Now().UnixNano() % (1<<31)
}

// createSessionRecord creates a new session record in the database
func createSessionRecord(config *Config) (int64, *database.TursoDB, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return 0, nil, err
	}

	dbPath := filepath.Join(home, ".local", "share", "dere", "dere.db")
	db, err := database.NewTursoDB(dbPath)
	if err != nil {
		return 0, nil, err
	}

	// Get current working directory
	workingDir, err := os.Getwd()
	if err != nil {
		db.Close()
		return 0, nil, err
	}

	// Build flags map from config
	flags := make(map[string]string)
	if config.Model != "" {
		flags["model"] = config.Model
	}
	if config.FallbackModel != "" {
		flags["fallback-model"] = config.FallbackModel
	}
	if config.PermissionMode != "" {
		flags["permission-mode"] = config.PermissionMode
	}
	if len(config.AllowedTools) > 0 {
		flags["allowed-tools"] = strings.Join(config.AllowedTools, ",")
	}
	if len(config.DisallowedTools) > 0 {
		flags["disallowed-tools"] = strings.Join(config.DisallowedTools, ",")
	}
	if config.IDE {
		flags["ide"] = "true"
	}
	if config.Continue {
		flags["continue"] = "true"
	}
	if config.Resume != "" {
		flags["resume"] = config.Resume
	}
	if config.Mode != "" {
		flags["mode"] = config.Mode
	}

	// Handle continuation logic
	var continuedFrom *int64
	if config.Resume != "" {
		// Parse resume session ID if it's numeric
		if resumeID, parseErr := strconv.ParseInt(config.Resume, 10, 64); parseErr == nil {
			continuedFrom = &resumeID
		}
	}

	// Create session record
	sessionID, err := db.CreateSession(workingDir, config.Personalities, config.MCPServers, flags, continuedFrom)
	if err != nil {
		db.Close()
		return 0, nil, err
	}

	return sessionID, db, nil
}

// buildSessionContext requests context building from the daemon
func buildSessionContext(sessionID int64, config *Config) (string, error) {
	// Get current working directory for project context
	workingDir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}

	// Get personality string
	personalityStr := settings.GetPersonalityString(config.Personalities)

	// Create HTTP client for Unix socket
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	socketPath := filepath.Join(home, ".local", "share", "dere", "daemon.sock")

	client := &http.Client{
		Transport: &http.Transport{
			Dial: func(_, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
		Timeout: 10 * time.Second,
	}

	// Build context request
	contextRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "context.build",
		"id":      1,
		"params": map[string]interface{}{
			"session_id":       sessionID,
			"project_path":     workingDir,
			"personality":      personalityStr,
			"context_depth":    config.ContextDepth,
			"include_entities": true, // Always include entities for now
			"max_tokens":       config.MaxContextTokens,
			"context_mode":     config.ContextMode,
			"current_prompt":   "", // Empty for initial context
		},
	}

	// Send request to daemon
	requestJSON, err := json.Marshal(contextRequest)
	if err != nil {
		return "", fmt.Errorf("failed to marshal context request: %w", err)
	}

	resp, err := client.Post("http://unix/rpc", "application/json", bytes.NewReader(requestJSON))
	if err != nil {
		// Daemon not running, context building not available
		log.Printf("Daemon not available for context building: %v", err)
		return "", nil
	}
	defer resp.Body.Close()

	// Parse response
	var rpcResponse struct {
		Result map[string]interface{} `json:"result"`
		Error  map[string]interface{} `json:"error"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&rpcResponse); err != nil {
		return "", fmt.Errorf("failed to parse context response: %w", err)
	}

	if rpcResponse.Error != nil {
		return "", fmt.Errorf("daemon error: %v", rpcResponse.Error)
	}

	// Wait briefly for context building task to complete
	time.Sleep(2 * time.Second)

	// Get the built context
	contextGetRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "context.get",
		"id":      2,
		"params": map[string]interface{}{
			"session_id":     sessionID,
			"max_age_minutes": 1, // Very fresh context
		},
	}

	getRequestJSON, err := json.Marshal(contextGetRequest)
	if err != nil {
		return "", fmt.Errorf("failed to marshal context get request: %w", err)
	}

	getResp, err := client.Post("http://unix/rpc", "application/json", bytes.NewReader(getRequestJSON))
	if err != nil {
		return "", fmt.Errorf("failed to send context get request: %w", err)
	}
	defer getResp.Body.Close()

	var getResponse struct {
		Result map[string]interface{} `json:"result"`
		Error  map[string]interface{} `json:"error"`
	}

	if err := json.NewDecoder(getResp.Body).Decode(&getResponse); err != nil {
		return "", fmt.Errorf("failed to parse context get response: %w", err)
	}

	if getResponse.Error != nil {
		return "", fmt.Errorf("daemon context get error: %w", fmt.Errorf("%v", getResponse.Error))
	}

	// Extract context text
	if getResponse.Result != nil {
		if found, ok := getResponse.Result["found"].(bool); ok && found {
			if contextText, ok := getResponse.Result["context"].(string); ok {
				return contextText, nil
			}
		}
	}

	return "", nil
}

// buildModeContext builds mode-specific session context by retrieving previous sessions
func buildModeContext(sessionID int64, config *Config) (string, error) {
	if config.Mode == "" {
		return "", nil
	}

	// Create HTTP client for Unix socket
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	socketPath := filepath.Join(home, ".local", "share", "dere", "daemon.sock")

	client := &http.Client{
		Transport: &http.Transport{
			Dial: func(_, _ string) (net.Conn, error) {
				return net.Dial("unix", socketPath)
			},
		},
		Timeout: 10 * time.Second,
	}

	// Get previous mode session
	modeRequest := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "mode.session.previous",
		"id":      3,
		"params": map[string]interface{}{
			"mode":       config.Mode,
			"session_id": sessionID,
		},
	}

	requestJSON, err := json.Marshal(modeRequest)
	if err != nil {
		return "", fmt.Errorf("failed to marshal mode request: %w", err)
	}

	resp, err := client.Post("http://unix/rpc", "application/json", bytes.NewReader(requestJSON))
	if err != nil {
		// Daemon not running, skip mode context
		log.Printf("Daemon not available for mode context: %v", err)
		return "", nil
	}
	defer resp.Body.Close()

	var rpcResponse struct {
		Result map[string]interface{} `json:"result"`
		Error  map[string]interface{} `json:"error"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&rpcResponse); err != nil {
		return "", fmt.Errorf("failed to parse mode response: %w", err)
	}

	if rpcResponse.Error != nil {
		return "", fmt.Errorf("daemon mode error: %w", fmt.Errorf("%v", rpcResponse.Error))
	}

	// Check if previous session was found
	if rpcResponse.Result != nil {
		if found, ok := rpcResponse.Result["found"].(bool); ok && found {
			var contextParts []string

			// Add session continuity context
			if daysAgo, ok := rpcResponse.Result["days_ago"].(float64); ok {
				if lastDate, ok := rpcResponse.Result["last_session_date"].(string); ok {
					if int(daysAgo) == 0 {
						contextParts = append(contextParts, "We spoke earlier today.")
					} else if int(daysAgo) == 1 {
						contextParts = append(contextParts, "We spoke yesterday.")
					} else {
						contextParts = append(contextParts, fmt.Sprintf("We last spoke %d days ago on %s.", int(daysAgo), lastDate))
					}
				}
			}

			// Add summary if available
			if summary, ok := rpcResponse.Result["summary"].(string); ok && summary != "" {
				contextParts = append(contextParts, fmt.Sprintf("Previous session summary: %s", summary))
			}

			// Add key topics if available
			if keyTopicsInterface, ok := rpcResponse.Result["key_topics"].([]interface{}); ok && len(keyTopicsInterface) > 0 {
				var keyTopics []string
				for _, topic := range keyTopicsInterface {
					if topicStr, ok := topic.(string); ok {
						keyTopics = append(keyTopics, topicStr)
					}
				}
				if len(keyTopics) > 0 {
					contextParts = append(contextParts, fmt.Sprintf("Key topics we discussed: %s.", strings.Join(keyTopics, ", ")))
				}
			}

			// Add next steps if available
			if nextSteps, ok := rpcResponse.Result["next_steps"].(string); ok && nextSteps != "" {
				contextParts = append(contextParts, fmt.Sprintf("We planned to follow up on: %s", nextSteps))
			}

			if len(contextParts) > 0 {
				return strings.Join(contextParts, " "), nil
			}
		} else {
			// No previous session found, this is a new mode session
			return getModeInitiationPrompt(config.Mode), nil
		}
	}

	// If no daemon available or mode context fails, still provide initiation prompt
	return getModeInitiationPrompt(config.Mode), nil
}

// getModeInitiationPrompt returns an auto-initiation prompt for each mental health mode
func getModeInitiationPrompt(mode string) string {
	switch mode {
	case "checkin":
		return "Session Auto-Initiation: Begin a wellness check-in session. Start by greeting the user warmly and asking how they're feeling today. Guide them through exploring their current mood, energy levels, stress, and what's been on their mind lately."
	case "cbt":
		return "Session Auto-Initiation: Begin a CBT (Cognitive Behavioral Therapy) session. Start by checking in with the user and asking what thoughts, feelings, or situations they'd like to work on today. Help them identify and examine thinking patterns."
	case "therapy":
		return "Session Auto-Initiation: Begin a therapy session. Start with a warm greeting and ask the user what's been on their mind or what they'd like to explore today. Create a safe space for deep emotional processing."
	case "mindfulness":
		return "Session Auto-Initiation: Begin a mindfulness session. Start by greeting the user and guiding them to take a moment to center themselves. Ask how they're feeling in this present moment and what would be most helpful for their mindfulness practice today."
	case "goals":
		return "Session Auto-Initiation: Begin a life coaching and goal-setting session. Start by greeting the user enthusiastically and asking what goals, dreams, or areas of their life they'd like to work on today. Help them clarify their objectives and create actionable plans."
	default:
		return ""
	}
}