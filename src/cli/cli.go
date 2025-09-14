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
	"mcp":             true,
	"mcp-config-path": true,
	"help":            true,
}

// preParseCustomPrompts extracts unknown flags as custom prompts
func preParseCustomPrompts(args []string) ([]string, []string) {
	var customPrompts []string
	var filteredArgs []string
	
	for i, arg := range args {
		if strings.HasPrefix(arg, "--") {
			flagName := strings.TrimPrefix(arg, "--")
			// Handle flags with values (--flag=value)
			if equalPos := strings.Index(flagName, "="); equalPos != -1 {
				flagName = flagName[:equalPos]
			}
			
			if !knownFlags[flagName] {
				// This is a custom prompt
				customPrompts = append(customPrompts, flagName)
				// Skip this flag (and its value if separate)
				if equalPos := strings.Index(arg, "="); equalPos == -1 {
					// Value might be in next arg, check if it looks like a value
					if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
						i++ // Skip the value too
					}
				}
				continue
			}
		}
		filteredArgs = append(filteredArgs, arg)
	}
	
	return customPrompts, filteredArgs
}

func ParseArgs(args []string) (*Config, error) {
	config := &Config{}
	
	// Pre-parse for custom prompts
	customPrompts, filteredArgs := preParseCustomPrompts(args)
	config.CustomPrompts = customPrompts
	
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
	
	
	// MCP Configuration
	mcpServers := fs.String("mcp", "", "Comma-separated list of MCP servers from config file")
	mcpConfigPath := fs.String("mcp-config-path", "", "Path to MCP config file (default: ~/.claude/claude_desktop_config.json)")
	
	help := fs.Bool("help", false, "Show help message")
	
	if err := fs.Parse(filteredArgs); err != nil {
		return nil, err
	}
	
	// Core settings
	config.Bare = *bare
	config.Context = *context
	config.Continue = *continueFlag || *continueFlagShort
	
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
		
		// No defaults - bare mode is default
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
	
	
	config.ShowHelp = *help
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
	fmt.Println("  --tsun               Tsundere mode (default)")
	fmt.Println("  --kuu                Cold analytical mode")
	fmt.Println("  --yan                Overly helpful mode")
	fmt.Println("  --dere               Actually nice mode")
	fmt.Println("  --ero                Playfully teasing mode")
	fmt.Println()
	fmt.Println("MCP Configuration:")
	fmt.Println("  --mcp=SERVERS            Comma-separated MCP servers from config file")
	fmt.Println("  --mcp-config-path=FILE   Path to MCP config (default: ~/.claude/claude_desktop_config.json)")
	fmt.Println()
	fmt.Println("Other options:")
	fmt.Println("  -c, --continue           Continue the most recent conversation")
	fmt.Println("  --help                   Show this help message")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  dere --bare                       # Just Claude, no additions")
	fmt.Println("  dere --tsun --context             # Tsundere + context awareness")
	fmt.Println("  dere --kuu --mcp=filesystem       # Cold + file access")
	fmt.Println("  dere --context                    # No personality, just context")
	fmt.Println("  dere --tsun -c                    # Continue with tsundere mode")
}