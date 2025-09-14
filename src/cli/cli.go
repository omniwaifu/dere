package cli

import (
	"flag"
	"fmt"
	"strings"
)

type Config struct {
	Bare            bool
	Personalities   []string  // List of built-in personalities
	CustomPrompts   []string  // List of custom prompts
	Context         bool
	Continue        bool      // Continue previous conversation
	MCPServers      []string
	MCPConfigPath   string
	ShowHelp        bool
	ShowVersion     bool
	ExtraArgs       []string
}

// knownFlags is a set of all known flags for pre-parsing
var knownFlags = map[string]bool{
	"bare":            true,
	"context":         true,
	"continue":        true,
	"c":               true,
	"tsun":            true,
	"kuu":             true,
	"yan":             true,
	"dere":            true,
	"ero":             true,
	"prompts":         true,
	"mcp":             true,
	"mcp-config-path": true,
	"help":            true,
	"version":         true,
}


func ParseArgs(args []string) (*Config, error) {
	config := &Config{}
	
	fs := flag.NewFlagSet("dere", flag.ContinueOnError)
	
	// Core mode
	bare := fs.Bool("bare", false, "Bare mode - no personality or context")
	context := fs.Bool("context", false, "Enable contextual information (time, date, etc.)")
	continueFlag := fs.Bool("continue", false, "Continue the most recent conversation")
	continueFlagShort := fs.Bool("c", false, "Continue the most recent conversation (shorthand)")
	
	// Personality flags
	tsun := fs.Bool("tsun", false, "Tsundere mode")
	kuu := fs.Bool("kuu", false, "Cold analytical mode")
	yan := fs.Bool("yan", false, "Overly helpful mode")
	dere := fs.Bool("dere", false, "Actually nice mode")
	ero := fs.Bool("ero", false, "Playfully teasing mode")
	
	// Custom prompts
	prompts := fs.String("prompts", "", "Comma-separated list of custom prompt files")
	
	// MCP Configuration
	mcpServers := fs.String("mcp", "", "Comma-separated list of MCP servers from config file")
	mcpConfigPath := fs.String("mcp-config-path", "", "Path to MCP config file (default: ~/.claude/claude_desktop_config.json)")
	
	help := fs.Bool("help", false, "Show help message")
	version := fs.Bool("version", false, "Show version information")
	
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	
	// Core settings
	config.Bare = *bare
	config.Context = *context
	config.Continue = *continueFlag || *continueFlagShort
	config.ShowHelp = *help
	config.ShowVersion = *version
	
	// Determine personality (defaults to tsun if none specified and not bare mode)
	personalities := []string{}
	if *tsun {
		personalities = append(personalities, "tsun")
	}
	if *kuu {
		personalities = append(personalities, "kuu")
	}
	if *yan {
		personalities = append(personalities, "yan")
	}
	if *dere {
		personalities = append(personalities, "dere")
	}
	if *ero {
		personalities = append(personalities, "ero")
	}
	
	if config.Bare {
		config.Personalities = []string{} // No prompts in bare mode
		config.CustomPrompts = []string{}
	} else {
		// Store all built-in personalities
		config.Personalities = personalities
		
		// Parse custom prompts
		if *prompts != "" {
			promptList := strings.Split(*prompts, ",")
			for _, p := range promptList {
				p = strings.TrimSpace(p)
				if p != "" {
					config.CustomPrompts = append(config.CustomPrompts, p)
				}
			}
		}
	}
	
	
	// Parse MCP servers
	if *mcpServers != "" {
		servers := strings.Split(*mcpServers, ",")
		for _, server := range servers {
			server = strings.TrimSpace(server)
			if server != "" {
				config.MCPServers = append(config.MCPServers, server)
			}
		}
	}
	
	// Parse MCP config path
	if *mcpConfigPath != "" {
		config.MCPConfigPath = *mcpConfigPath
	}
	
	config.ExtraArgs = fs.Args()
	
	return config, nil
}

func ShowHelp() {
	fmt.Println("dere - Layered AI assistant with composable personalities and domain knowledge")
	fmt.Println()
	fmt.Println("Usage: dere [options] [claude-args...]")
	fmt.Println()
	fmt.Println("Core modes:")
	fmt.Println("  --bare               Bare mode - no personality or context")
	fmt.Println("  --context            Enable contextual information (time, date, etc.)")
	fmt.Println()
	fmt.Println("Personality layers:")
	fmt.Println("  --tsun               Tsundere mode")
	fmt.Println("  --kuu                Cold analytical mode")
	fmt.Println("  --yan                Overly helpful mode")
	fmt.Println("  --dere               Actually nice mode")
	fmt.Println("  --ero                Playfully teasing mode")
	fmt.Println()
	fmt.Println("Custom prompts:")
	fmt.Println("  --prompts=FILE[,FILE]    Load custom prompt files from ~/.config/dere/prompts/")
	fmt.Println()
	fmt.Println("MCP Configuration:")
	fmt.Println("  --mcp=SERVERS            Comma-separated MCP servers from config file")
	fmt.Println("  --mcp-config-path=FILE   Path to MCP config (default: ~/.claude/claude_desktop_config.json)")
	fmt.Println()
	fmt.Println("Other options:")
	fmt.Println("  -c, --continue           Continue the most recent conversation")
	fmt.Println("  --version                Show version information")
	fmt.Println("  --help                   Show this help message")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  dere --bare                       # Just Claude, no additions")
	fmt.Println("  dere --tsun --context             # Tsundere + context awareness")
	fmt.Println("  dere --kuu --mcp=filesystem       # Cold + file access")
	fmt.Println("  dere --prompts=rust,security      # Custom prompts for Rust + security")
	fmt.Println("  dere --context                    # No personality, just context")
	fmt.Println("  dere --tsun -c                    # Continue with tsundere mode")
}