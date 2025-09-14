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
	tsun bool
	kuu  bool
	yan  bool
	dere bool
	ero  bool
	
	// Model flags
	opus   bool
	sonnet bool
	haiku  bool
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
	
	// MCP Configuration
	mcpServers    []string
	mcpConfigPath string
	
	// Config file
	cfgFile string
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "dere [flags] [claude-args...]",
	Short: "Layered AI assistant with composable personalities for Claude CLI",
	Long: `dere wraps Claude CLI with personality layers, context awareness, 
and conversation memory via embeddings.

When run without subcommands, it launches Claude with the specified configuration.
Additional arguments are passed through to Claude.`,
	DisableFlagParsing: false,
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

	// Stop parsing flags after first non-flag argument (for Claude pass-through)
	rootCmd.Flags().SetInterspersed(false)
	
	// Core flags
	rootCmd.Flags().BoolVar(&bare, "bare", false, "Bare mode - no personality or context")
	rootCmd.Flags().BoolVar(&context, "context", false, "Enable contextual information (time, date, etc.)")
	rootCmd.Flags().BoolVarP(&continueFlag, "continue", "c", false, "Continue the most recent conversation")
	rootCmd.Flags().StringVarP(&resume, "resume", "r", "", "Resume a specific session ID")
	
	// Personality flags
	rootCmd.Flags().BoolVar(&tsun, "tsun", false, "Tsundere mode")
	rootCmd.Flags().BoolVar(&kuu, "kuu", false, "Cold analytical mode")
	rootCmd.Flags().BoolVar(&yan, "yan", false, "Overly helpful mode")
	rootCmd.Flags().BoolVar(&dere, "dere", false, "Actually nice mode")
	rootCmd.Flags().BoolVar(&ero, "ero", false, "Playfully teasing mode")
	
	// Model shortcuts
	rootCmd.Flags().BoolVar(&opus, "opus", false, "Use Claude Opus model")
	rootCmd.Flags().BoolVar(&sonnet, "sonnet", false, "Use Claude Sonnet model")
	rootCmd.Flags().BoolVar(&haiku, "haiku", false, "Use Claude Haiku model")
	
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
	
	// MCP Configuration
	rootCmd.Flags().StringSliceVar(&mcpServers, "mcp", nil, "Comma-separated list of MCP servers from config file")
	rootCmd.Flags().StringVar(&mcpConfigPath, "mcp-config-path", "", "Path to MCP config file")
	
	// Config file
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.config/dere/config.toml)")
	
	// Bind flags to viper
	viper.BindPFlag("bare", rootCmd.Flags().Lookup("bare"))
	viper.BindPFlag("context", rootCmd.Flags().Lookup("context"))
	viper.BindPFlag("personalities.tsun", rootCmd.Flags().Lookup("tsun"))
	viper.BindPFlag("personalities.kuu", rootCmd.Flags().Lookup("kuu"))
	viper.BindPFlag("personalities.yan", rootCmd.Flags().Lookup("yan"))
	viper.BindPFlag("personalities.dere", rootCmd.Flags().Lookup("dere"))
	viper.BindPFlag("personalities.ero", rootCmd.Flags().Lookup("ero"))
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
		ExtraArgs:       rootCmd.Flags().Args(),
	}
	
	// Determine personality
	personalities := []string{}
	if tsun {
		personalities = append(personalities, "tsun")
	}
	if kuu {
		personalities = append(personalities, "kuu")
	}
	if yan {
		personalities = append(personalities, "yan")
	}
	if dere {
		personalities = append(personalities, "dere")
	}
	if ero {
		personalities = append(personalities, "ero")
	}
	
	// Model shortcuts override
	if opus {
		cfg.Model = "opus"
	} else if sonnet {
		cfg.Model = "sonnet"
	} else if haiku {
		cfg.Model = "haiku"
	}
	
	if bare {
		cfg.Personalities = []string{}
		cfg.CustomPrompts = []string{}
	} else {
		cfg.Personalities = personalities
		cfg.CustomPrompts = prompts
	}
	
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
	ExtraArgs       []string
}