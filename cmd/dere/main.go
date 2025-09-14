package main

import (
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"
	
	"dere/src/cli"
	"dere/src/composer"
	"dere/src/hooks"
	"dere/src/mcp"
)

func main() {
	config, err := cli.ParseArgs(os.Args[1:])
	if err != nil {
		log.Fatalf("Failed to parse arguments: %v", err)
	}

	if config.ShowVersion {
		// Just print version and exit
		println("dere v0.1.0")
		os.Exit(0)
	}

	if config.ShowHelp {
		cli.ShowHelp()
		os.Exit(0)
	}

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
		log.Fatalf("Failed to compose system prompt: %v", err)
	}

	// Launch claude with the assembled prompt
	claudePath, err := exec.LookPath("claude")
	if err != nil {
		log.Fatalf("claude command not found in PATH: %v", err)
	}

	// Build the command arguments (exec.Command adds program name automatically)
	var args []string
	
	// Add continue/resume flags
	if config.Continue {
		args = append(args, "-c")
	} else if config.Resume != "" {
		args = append(args, "-r", config.Resume)
	}
	
	// Add model configuration
	if config.Model != "" {
		args = append(args, "--model", config.Model)
	}
	if config.FallbackModel != "" {
		args = append(args, "--fallback-model", config.FallbackModel)
	}
	
	// Add permission mode
	if config.PermissionMode != "" {
		args = append(args, "--permission-mode", config.PermissionMode)
	}
	
	// Add tool restrictions
	if len(config.AllowedTools) > 0 {
		args = append(args, "--allowed-tools", strings.Join(config.AllowedTools, ","))
	}
	if len(config.DisallowedTools) > 0 {
		args = append(args, "--disallowed-tools", strings.Join(config.DisallowedTools, ","))
	}
	
	// Add additional directories
	for _, dir := range config.AddDirs {
		args = append(args, "--add-dir", dir)
	}
	
	// Add IDE flag
	if config.IDE {
		args = append(args, "--ide")
	}
	
	// Only add system prompt if not in bare mode
	if systemPrompt != "" {
		args = append(args, "--append-system-prompt", systemPrompt)
	}
	
	// Add MCP configuration if specified
	if len(config.MCPServers) > 0 {
		mcpConfig, err := mcp.BuildMCPConfigFromClaudeDesktop(config.MCPServers, config.MCPConfigPath)
		if err != nil {
			log.Fatalf("Failed to build MCP config: %v", err)
		}
		args = append(args, "--mcp-config", mcpConfig)
	}
	
	// Add extra args
	args = append(args, config.ExtraArgs...)

	// Create command to run Claude as child process
	cmd := exec.Command(claudePath, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	
	// Start Claude
	if err := cmd.Start(); err != nil {
		log.Fatalf("Failed to start claude: %v", err)
	}
	
	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	
	// Wait for either Claude to exit or signal
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	
	select {
	case sig := <-sigChan:
		// Forward signal to Claude
		if cmd.Process != nil {
			cmd.Process.Signal(sig)
		}
		// Wait a bit for graceful shutdown
		select {
		case <-done:
			// Claude exited after receiving signal
		case <-time.After(5 * time.Second):
			// Force kill if not exited
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			<-done // Wait for process to actually exit
		}
	case <-done:
		// Claude exited normally
	}
	
	// Always cleanup after Claude exits
	if err := hookManager.Cleanup(); err != nil {
		log.Printf("Warning: Failed to cleanup hooks: %v", err)
	}
}