package cmd

import (
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	// Flags
	bare            bool
	context         bool
	continueFlag    bool
	resume          string
	
	// Personality flags
	personalities []string
	
	// Model flags
	model  string
	fallbackModel string
	
	// Permission and tools
	permissionMode  string
	allowedTools    []string
	disallowedTools []string
	addDirs         []string
	ide            bool
	
	// Custom prompts
	prompts []string
	
	// Output style
	outputStyle string
	
	// MCP Configuration
	mcpServers    []string
	mcpConfigPath string
	
	// Config file
	cfgFile string

	// Claude passthrough flags
	printMode                bool
	debugMode                string
	verboseMode              bool
	outputFormat             string
	inputFormat              string
	includePartialMessages   bool
	replayUserMessages       bool
	sessionID                string
	dangerouslySkipPermissions bool
	strictMCPConfig          bool
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "dere [flags] [claude-args...]",
	Short: "Layered AI assistant with composable personalities for Claude CLI",
	Long: `dere wraps Claude CLI with personality layers, context awareness,
and conversation memory via embeddings.

When run without subcommands, it launches Claude with the specified configuration.
Additional arguments are passed through to Claude.`,
	Args: cobra.ArbitraryArgs,
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() {
	err := rootCmd.Execute()
	if err != nil {
		os.Exit(1)
	}
}

func init() {
	cobra.OnInitialize(initConfig)
	
	// Set the run function
	rootCmd.RunE = runDere
	
	// Core flags
	rootCmd.Flags().BoolVar(&bare, "bare", false, "Bare mode - no personality or context")
	rootCmd.Flags().BoolVar(&context, "context", false, "Enable contextual information (time, date, etc.)")
	rootCmd.Flags().BoolVarP(&continueFlag, "continue", "c", false, "Continue the most recent conversation")
	rootCmd.Flags().StringVarP(&resume, "resume", "r", "", "Resume a specific session ID")
	
	// Personality flags
	rootCmd.Flags().StringSliceVarP(&personalities, "personality", "P", nil, "Personality modes (tsun,kuu,yan,dere,ero)")
	
	
	// Model configuration
	rootCmd.Flags().StringVar(&model, "model", "", "Model override (e.g., 'opus' or full model name)")
	rootCmd.Flags().StringVar(&fallbackModel, "fallback-model", "", "Fallback model when primary is overloaded")
	
	// Permission and tools
	rootCmd.Flags().StringVar(&permissionMode, "permission-mode", "", "Permission mode (plan, acceptEdits, bypassPermissions, default)")
	rootCmd.Flags().StringSliceVar(&allowedTools, "allowed-tools", nil, "Comma-separated list of tools to allow")
	rootCmd.Flags().StringSliceVar(&disallowedTools, "disallowed-tools", nil, "Comma-separated list of tools to disallow")
	rootCmd.Flags().StringSliceVar(&addDirs, "add-dir", nil, "Additional directories to allow access")
	rootCmd.Flags().BoolVar(&ide, "ide", false, "Auto-connect to IDE if available")
	
	// Custom prompts
	rootCmd.Flags().StringSliceVar(&prompts, "prompts", nil, "Comma-separated list of custom prompt files")
	
	// Output style
	rootCmd.Flags().StringVar(&outputStyle, "output-style", "", "Claude output style (overrides default interaction mode)")
	
	// MCP Configuration
	rootCmd.Flags().StringSliceVar(&mcpServers, "mcp", nil, "Comma-separated list of MCP servers from config file")
	rootCmd.Flags().StringVar(&mcpConfigPath, "mcp-config-path", "", "Path to MCP config file")
	
	// Config file
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.config/dere/config.toml)")

	// Claude passthrough flags
	rootCmd.Flags().BoolVarP(&printMode, "print", "p", false, "Print response and exit (passthrough to Claude)")
	rootCmd.Flags().StringVarP(&debugMode, "debug", "d", "", "Enable debug mode with optional filtering (passthrough to Claude)")
	rootCmd.Flags().BoolVar(&verboseMode, "verbose", false, "Override verbose mode setting (passthrough to Claude)")
	rootCmd.Flags().StringVar(&outputFormat, "output-format", "", "Output format: text, json, or stream-json (passthrough to Claude)")
	rootCmd.Flags().StringVar(&inputFormat, "input-format", "", "Input format: text or stream-json (passthrough to Claude)")
	rootCmd.Flags().BoolVar(&includePartialMessages, "include-partial-messages", false, "Include partial message chunks (passthrough to Claude)")
	rootCmd.Flags().BoolVar(&replayUserMessages, "replay-user-messages", false, "Re-emit user messages (passthrough to Claude)")
	rootCmd.Flags().StringVar(&sessionID, "session-id", "", "Use specific session ID (passthrough to Claude)")
	rootCmd.Flags().BoolVar(&dangerouslySkipPermissions, "dangerously-skip-permissions", false, "Bypass permission checks (passthrough to Claude)")
	rootCmd.Flags().BoolVar(&strictMCPConfig, "strict-mcp-config", false, "Only use specified MCP configs (passthrough to Claude)")
	
	// Bind flags to viper
	viper.BindPFlag("bare", rootCmd.Flags().Lookup("bare"))
	viper.BindPFlag("context", rootCmd.Flags().Lookup("context"))
	viper.BindPFlag("personalities", rootCmd.Flags().Lookup("personality"))
	viper.BindPFlag("model", rootCmd.Flags().Lookup("model"))
	viper.BindPFlag("ollama.enabled", rootCmd.Flags().Lookup("ollama.enabled"))
	viper.BindPFlag("ollama.url", rootCmd.Flags().Lookup("ollama.url"))
	viper.BindPFlag("ollama.embedding_model", rootCmd.Flags().Lookup("ollama.embedding_model"))
}

// initConfig reads in config file and ENV variables if set
func initConfig() {
	if cfgFile != "" {
		// Use config file from the flag
		viper.SetConfigFile(cfgFile)
	} else {
		// Find home directory
		home, err := os.UserHomeDir()
		cobra.CheckErr(err)

		// Search config in ~/.config/dere directory
		viper.AddConfigPath(home + "/.config/dere")
		viper.SetConfigType("toml")
		viper.SetConfigName("config")
	}

	// Environment variables
	viper.SetEnvPrefix("DERE")
	viper.AutomaticEnv() // read in environment variables that match
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// If a config file is found, read it in
	if err := viper.ReadInConfig(); err == nil {
		// Config file loaded successfully
	}
}

// GetConfig builds a configuration struct from flags and viper
func GetConfig() *Config {
	cfg := &Config{
		Bare:            bare,
		Context:         context,
		Continue:        continueFlag,
		Resume:          resume,
		Model:           model,
		FallbackModel:   fallbackModel,
		PermissionMode:  permissionMode,
		AllowedTools:    allowedTools,
		DisallowedTools: disallowedTools,
		AddDirs:         addDirs,
		IDE:             ide,
		MCPServers:      mcpServers,
		MCPConfigPath:   mcpConfigPath,
		OutputStyle:     outputStyle,
		ExtraArgs:       rootCmd.Flags().Args(),
	}
	
	
	
	if bare {
		cfg.Personalities = []string{}
		cfg.CustomPrompts = []string{}
	} else {
		cfg.Personalities = personalities
		cfg.CustomPrompts = prompts
	}

	// Build passthrough args for Claude
	var passthroughArgs []string
	if printMode {
		passthroughArgs = append(passthroughArgs, "-p")
	}
	if debugMode != "" {
		passthroughArgs = append(passthroughArgs, "-d", debugMode)
	}
	if verboseMode {
		passthroughArgs = append(passthroughArgs, "--verbose")
	}
	if outputFormat != "" {
		passthroughArgs = append(passthroughArgs, "--output-format", outputFormat)
	}
	if inputFormat != "" {
		passthroughArgs = append(passthroughArgs, "--input-format", inputFormat)
	}
	if includePartialMessages {
		passthroughArgs = append(passthroughArgs, "--include-partial-messages")
	}
	if replayUserMessages {
		passthroughArgs = append(passthroughArgs, "--replay-user-messages")
	}
	if sessionID != "" {
		passthroughArgs = append(passthroughArgs, "--session-id", sessionID)
	}
	if dangerouslySkipPermissions {
		passthroughArgs = append(passthroughArgs, "--dangerously-skip-permissions")
	}
	if strictMCPConfig {
		passthroughArgs = append(passthroughArgs, "--strict-mcp-config")
	}
	cfg.PassthroughArgs = passthroughArgs

	return cfg
}

// Config represents the parsed configuration
type Config struct {
	Bare            bool
	Personalities   []string
	CustomPrompts   []string
	Context         bool
	Continue        bool
	Resume          string
	Model           string
	FallbackModel   string
	PermissionMode  string
	AllowedTools    []string
	DisallowedTools []string
	AddDirs         []string
	IDE             bool
	MCPServers      []string
	MCPConfigPath   string
	OutputStyle     string
	ExtraArgs       []string
	PassthroughArgs []string
}