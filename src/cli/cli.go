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
	Resume          string    // Resume specific session
	Model           string    // Model override
	FallbackModel   string    // Fallback model when primary is overloaded
	PermissionMode  string    // Permission mode (plan, acceptEdits, etc)
	AllowedTools    []string  // Tools to allow
	DisallowedTools []string  // Tools to disallow
	AddDirs         []string  // Additional directories to allow
	IDE             bool      // Auto-connect to IDE
	MCPServers      []string
	MCPConfigPath   string
	ShowHelp        bool
	ShowVersion     bool
	ExtraArgs       []string
}

// knownFlags is a set of all known flags for pre-parsing
var knownFlags = map[string]bool{
	"bare":             true,
	"context":          true,
	"continue":         true,
	"c":                true,
	"resume":           true,
	"r":                true,
	"tsun":             true,
	"kuu":              true,
	"yan":              true,
	"dere":             true,
	"ero":              true,
	"opus":             true,
	"sonnet":           true,
	"haiku":            true,
	"model":            true,
	"fallback-model":   true,
	"permission-mode":  true,
	"allowed-tools":    true,
	"disallowed-tools": true,
	"add-dir":          true,
	"ide":              true,
	"prompts":          true,
	"mcp":              true,
	"mcp-config-path":  true,
	"help":             true,
	"version":          true,
}


func ParseArgs(args []string) (*Config, error) {
	config := &Config{}
	
	fs := flag.NewFlagSet("dere", flag.ContinueOnError)
	
	// Core mode
	bare := fs.Bool("bare", false, "Bare mode - no personality or context")
	context := fs.Bool("context", false, "Enable contextual information (time, date, etc.)")
	continueFlag := fs.Bool("continue", false, "Continue the most recent conversation")
	continueFlagShort := fs.Bool("c", false, "Continue the most recent conversation (shorthand)")
	resumeFlag := fs.String("resume", "", "Resume a specific session ID")
	resumeFlagShort := fs.String("r", "", "Resume a specific session ID (shorthand)")
	
	// Personality flags
	tsun := fs.Bool("tsun", false, "Tsundere mode")
	kuu := fs.Bool("kuu", false, "Cold analytical mode")
	yan := fs.Bool("yan", false, "Overly helpful mode")
	dere := fs.Bool("dere", false, "Actually nice mode")
	ero := fs.Bool("ero", false, "Playfully teasing mode")
	
	// Model shortcuts
	opus := fs.Bool("opus", false, "Use Claude Opus model")
	sonnet := fs.Bool("sonnet", false, "Use Claude Sonnet model")
	haiku := fs.Bool("haiku", false, "Use Claude Haiku model")
	
	// Model configuration
	model := fs.String("model", "", "Model override (e.g., 'opus' or full model name)")
	fallbackModel := fs.String("fallback-model", "", "Fallback model when primary is overloaded")
	
	// Permission and tools
	permissionMode := fs.String("permission-mode", "", "Permission mode (plan, acceptEdits, bypassPermissions, default)")
	allowedTools := fs.String("allowed-tools", "", "Comma-separated list of tools to allow")
	disallowedTools := fs.String("disallowed-tools", "", "Comma-separated list of tools to disallow")
	addDir := fs.String("add-dir", "", "Comma-separated additional directories to allow access")
	ide := fs.Bool("ide", false, "Auto-connect to IDE if available")
	
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
	config.IDE = *ide
	
	// Resume handling
	if *resumeFlag != "" {
		config.Resume = *resumeFlag
	} else if *resumeFlagShort != "" {
		config.Resume = *resumeFlagShort
	}
	
	// Model selection - shortcuts take precedence
	if *opus {
		config.Model = "opus"
	} else if *sonnet {
		config.Model = "sonnet"
	} else if *haiku {
		config.Model = "haiku"
	} else if *model != "" {
		config.Model = *model
	}
	
	if *fallbackModel != "" {
		config.FallbackModel = *fallbackModel
	}
	
	// Permission mode
	if *permissionMode != "" {
		config.PermissionMode = *permissionMode
	}
	
	// Tool restrictions
	if *allowedTools != "" {
		tools := strings.Split(*allowedTools, ",")
		for _, tool := range tools {
			tool = strings.TrimSpace(tool)
			if tool != "" {
				config.AllowedTools = append(config.AllowedTools, tool)
			}
		}
	}
	
	if *disallowedTools != "" {
		tools := strings.Split(*disallowedTools, ",")
		for _, tool := range tools {
			tool = strings.TrimSpace(tool)
			if tool != "" {
				config.DisallowedTools = append(config.DisallowedTools, tool)
			}
		}
	}
	
	// Additional directories
	if *addDir != "" {
		dirs := strings.Split(*addDir, ",")
		for _, dir := range dirs {
			dir = strings.TrimSpace(dir)
			if dir != "" {
				config.AddDirs = append(config.AddDirs, dir)
			}
		}
	}
	
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
	fmt.Println("  --bare                    Bare mode - no personality or context")
	fmt.Println("  --context                 Enable contextual information (time, date, etc.)")
	fmt.Println()
	fmt.Println("Personality layers:")
	fmt.Println("  --tsun                    Tsundere mode")
	fmt.Println("  --kuu                     Cold analytical mode")
	fmt.Println("  --yan                     Overly helpful mode")
	fmt.Println("  --dere                    Actually nice mode")
	fmt.Println("  --ero                     Playfully teasing mode")
	fmt.Println()
	fmt.Println("Model selection:")
	fmt.Println("  --opus                    Use Claude Opus model")
	fmt.Println("  --sonnet                  Use Claude Sonnet model")
	fmt.Println("  --haiku                   Use Claude Haiku model")
	fmt.Println("  --model=MODEL             Specify model (e.g., 'opus' or full name)")
	fmt.Println("  --fallback-model=MODEL    Fallback when primary is overloaded")
	fmt.Println()
	fmt.Println("Session control:")
	fmt.Println("  -c, --continue            Continue the most recent conversation")
	fmt.Println("  -r, --resume [ID]         Resume a specific session")
	fmt.Println()
	fmt.Println("Permissions and tools:")
	fmt.Println("  --permission-mode=MODE    Set permission mode (plan/acceptEdits/bypassPermissions)")
	fmt.Println("  --allowed-tools=TOOLS     Comma-separated tools to allow")
	fmt.Println("  --disallowed-tools=TOOLS  Comma-separated tools to disallow")
	fmt.Println("  --add-dir=DIRS            Additional directories to allow access")
	fmt.Println()
	fmt.Println("Custom prompts:")
	fmt.Println("  --prompts=FILE[,FILE]     Load custom prompt files from ~/.config/dere/prompts/")
	fmt.Println()
	fmt.Println("MCP Configuration:")
	fmt.Println("  --mcp=SERVERS             Comma-separated MCP servers from config file")
	fmt.Println("  --mcp-config-path=FILE    Path to MCP config")
	fmt.Println()
	fmt.Println("Other options:")
	fmt.Println("  --ide                     Auto-connect to IDE if available")
	fmt.Println("  --version                 Show version information")
	fmt.Println("  --help                    Show this help message")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  dere --bare                       # Just Claude, no additions")
	fmt.Println("  dere --tsun --context             # Tsundere + context awareness")
	fmt.Println("  dere --opus --permission-mode=plan # Opus model in planning mode")
	fmt.Println("  dere --kuu --mcp=filesystem       # Cold + file access")
	fmt.Println("  dere --prompts=rust,security      # Custom prompts for Rust + security")
	fmt.Println("  dere --disallowed-tools=Bash      # Restrict bash access")
	fmt.Println("  dere --tsun -c                    # Continue with tsundere mode")
}