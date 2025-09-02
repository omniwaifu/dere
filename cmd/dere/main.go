package main

import (
	"log"
	"os"
	"os/exec"
	"syscall"
	
	"dere/src/cli"
	"dere/src/composer"
	"dere/src/mcp"
)

func main() {
	config, err := cli.ParseArgs(os.Args[1:])
	if err != nil {
		log.Fatalf("Failed to parse arguments: %v", err)
	}

	if config.ShowHelp {
		cli.ShowHelp()
		os.Exit(0)
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

	// Build the command arguments
	args := []string{"claude"}
	
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
	
	args = append(args, config.ExtraArgs...)
	
	// Add /clear command to start with clean screen
	args = append(args, "/clear")

	// Execute claude, replacing this process
	if err := syscall.Exec(claudePath, args, os.Environ()); err != nil {
		log.Fatalf("Failed to execute claude: %v", err)
	}
}