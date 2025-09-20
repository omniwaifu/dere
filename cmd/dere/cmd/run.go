package cmd

import (
	"log"
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

	// Create session record in database
	sessionID, db, err := createSessionRecord(config)
	if err != nil {
		log.Printf("Warning: Failed to create session record: %v", err)
		sessionID = 0 // Continue without session tracking
	}
	defer func() {
		if db != nil && sessionID != 0 {
			db.EndSession(sessionID)
			db.Close()
		}
	}()

	// Set session ID for hook to use
	if sessionID != 0 {
		os.Setenv("DERE_SESSION_ID", strconv.FormatInt(sessionID, 10))
	}

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
	settingsBuilder := settings.NewSettingsBuilder(personalityStr, config.OutputStyle)
	
	// Build settings file
	settingsPath, err := settingsBuilder.Build()
	if err != nil {
		// Log but don't fail - settings are optional enhancement
		log.Printf("Warning: Failed to build settings: %v", err)
		settingsPath = ""
	}
	// Setup command generator for personality-specific commands
	commandGenerator := commands.NewCommandGenerator(config.Personalities)
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
	
	// Add MCP configuration if specified
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
	
	// Add extra args
	claudeArgs = append(claudeArgs, config.ExtraArgs...)

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