package cmd

import (
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
	
	"dere/src/composer"
	"dere/src/hooks"
	"dere/src/mcp"
	
	"github.com/spf13/cobra"
)

// runDere is the main execution function when no subcommand is specified
func runDere(cmd *cobra.Command, args []string) error {
	config := GetConfig()
	config.ExtraArgs = args // Args after flags are Claude args
	
	// Setup hook manager for conversation capture
	personalityStr := hooks.GetPersonalityString(config.Personalities)
	hookManager := hooks.NewHookManager(personalityStr)
	
	// Setup hooks before launching Claude
	if err := hookManager.Setup(); err != nil {
		// Log but don't fail - hooks are optional enhancement
		log.Printf("Warning: Failed to setup hooks: %v", err)
	}

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
	
	// Only add system prompt if not in bare mode
	if systemPrompt != "" {
		claudeArgs = append(claudeArgs, "--append-system-prompt", systemPrompt)
	}
	
	// Add MCP configuration if specified
	if len(config.MCPServers) > 0 {
		mcpConfig, err := mcp.BuildMCPConfigFromClaudeDesktop(config.MCPServers, config.MCPConfigPath)
		if err != nil {
			return err
		}
		claudeArgs = append(claudeArgs, "--mcp-config", mcpConfig)
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
	
	// Cleanup
	if err := hookManager.Cleanup(); err != nil {
		// Log but don't fail
		log.Printf("Warning: Failed to cleanup hooks: %v", err)
	}
	
	return nil
}