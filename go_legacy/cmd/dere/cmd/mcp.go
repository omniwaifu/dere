package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"

	dereconfig "dere/src/config"
	
	"github.com/spf13/cobra"
)

type MCPConfig struct {
	MCPServers map[string]ServerConfig `json:"mcpServers"`
	Profiles   map[string]Profile      `json:"profiles,omitempty"`
}

type ServerConfig struct {
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	Env         map[string]string `json:"env,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	Description string            `json:"description,omitempty"`
}

type Profile struct {
	Description string   `json:"description"`
	Servers     []string `json:"servers"`
}

var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Manage MCP (Model Context Protocol) servers",
	Long:  `Manage MCP servers for dere. Configure, list, and organize MCP server connections.`,
}

var mcpListCmd = &cobra.Command{
	Use:   "list [pattern]",
	Short: "List available MCP servers",
	Long:  `List MCP servers, optionally filtered by pattern. Use --profiles to show profiles instead.`,
	RunE:  runMCPList,
}

var mcpProfilesCmd = &cobra.Command{
	Use:   "profiles",
	Short: "List MCP profiles",
	Long:  `List available MCP server profiles and their contents.`,
	RunE:  runMCPProfiles,
}

var mcpAddCmd = &cobra.Command{
	Use:   "add <name> <command> [args...]",
	Short: "Add a new MCP server",
	Long:  `Add a new MCP server configuration.`,
	Args:  cobra.MinimumNArgs(2),
	RunE:  runMCPAdd,
}

var mcpRemoveCmd = &cobra.Command{
	Use:   "remove <name>",
	Short: "Remove an MCP server",
	Long:  `Remove an MCP server configuration.`,
	Args:  cobra.ExactArgs(1),
	RunE:  runMCPRemove,
}

var mcpCopyCmd = &cobra.Command{
	Use:   "copy-from-claude",
	Short: "Copy MCP servers from Claude Desktop config",
	Long:  `Import MCP server configurations from Claude Desktop's config file.`,
	RunE:  runMCPCopy,
}

var (
	mcpTags        []string
	mcpDescription string
	mcpEnvVars     []string
)

func init() {
	rootCmd.AddCommand(mcpCmd)
	
	mcpCmd.AddCommand(mcpListCmd)
	mcpCmd.AddCommand(mcpProfilesCmd)
	mcpCmd.AddCommand(mcpAddCmd)
	mcpCmd.AddCommand(mcpRemoveCmd)
	mcpCmd.AddCommand(mcpCopyCmd)
	
	// Flags for add command
	mcpAddCmd.Flags().StringSliceVar(&mcpTags, "tags", nil, "Tags for the server (comma-separated)")
	mcpAddCmd.Flags().StringVar(&mcpDescription, "description", "", "Description of the server")
	mcpAddCmd.Flags().StringSliceVar(&mcpEnvVars, "env", nil, "Environment variables (KEY=value)")
}

func loadMCPConfig() (*MCPConfig, error) {
	configDir, err := dereconfig.GetConfigDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get config directory: %w", err)
	}
	
	configPath := filepath.Join(configDir, "mcp_config.json")
	
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &MCPConfig{
				MCPServers: make(map[string]ServerConfig),
				Profiles:   make(map[string]Profile),
			}, nil
		}
		return nil, fmt.Errorf("failed to read MCP config: %w", err)
	}
	
	var config MCPConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse MCP config: %w", err)
	}
	
	if config.MCPServers == nil {
		config.MCPServers = make(map[string]ServerConfig)
	}
	if config.Profiles == nil {
		config.Profiles = make(map[string]Profile)
	}
	
	return &config, nil
}

func saveMCPConfig(config *MCPConfig) error {
	configDir, err := dereconfig.GetConfigDir()
	if err != nil {
		return fmt.Errorf("failed to get config directory: %w", err)
	}
	
	configPath := filepath.Join(configDir, "mcp_config.json")
	
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal MCP config: %w", err)
	}
	
	return os.WriteFile(configPath, data, 0644)
}

func runMCPList(cmd *cobra.Command, args []string) error {
	config, err := loadMCPConfig()
	if err != nil {
		return err
	}
	
	var pattern string
	if len(args) > 0 {
		pattern = args[0]
	}
	
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "NAME\tDESCRIPTION\tTAGS\tCOMMAND\n")
	
	var names []string
	for name := range config.MCPServers {
		if pattern == "" || strings.Contains(name, pattern) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	
	for _, name := range names {
		server := config.MCPServers[name]
		tags := strings.Join(server.Tags, ",")
		command := server.Command
		if len(server.Args) > 0 {
			command += " " + strings.Join(server.Args, " ")
		}
		if len(command) > 50 {
			command = command[:47] + "..."
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", name, server.Description, tags, command)
	}
	
	return w.Flush()
}

func runMCPProfiles(cmd *cobra.Command, args []string) error {
	config, err := loadMCPConfig()
	if err != nil {
		return err
	}
	
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "PROFILE\tDESCRIPTION\tSERVERS\n")
	
	var names []string
	for name := range config.Profiles {
		names = append(names, name)
	}
	sort.Strings(names)
	
	for _, name := range names {
		profile := config.Profiles[name]
		servers := strings.Join(profile.Servers, ",")
		fmt.Fprintf(w, "%s\t%s\t%s\n", name, profile.Description, servers)
	}
	
	return w.Flush()
}

func runMCPAdd(cmd *cobra.Command, args []string) error {
	config, err := loadMCPConfig()
	if err != nil {
		return err
	}
	
	name := args[0]
	command := args[1]
	cmdArgs := args[2:]
	
	if _, exists := config.MCPServers[name]; exists {
		return fmt.Errorf("MCP server '%s' already exists", name)
	}
	
	// Parse environment variables
	env := make(map[string]string)
	for _, envVar := range mcpEnvVars {
		parts := strings.SplitN(envVar, "=", 2)
		if len(parts) != 2 {
			return fmt.Errorf("invalid environment variable format: %s (expected KEY=value)", envVar)
		}
		env[parts[0]] = parts[1]
	}
	
	server := ServerConfig{
		Command:     command,
		Args:        cmdArgs,
		Tags:        mcpTags,
		Description: mcpDescription,
	}
	
	if len(env) > 0 {
		server.Env = env
	}
	
	config.MCPServers[name] = server
	
	if err := saveMCPConfig(config); err != nil {
		return err
	}
	
	fmt.Printf("Added MCP server '%s'\n", name)
	return nil
}

func runMCPRemove(cmd *cobra.Command, args []string) error {
	config, err := loadMCPConfig()
	if err != nil {
		return err
	}
	
	name := args[0]
	
	if _, exists := config.MCPServers[name]; !exists {
		return fmt.Errorf("MCP server '%s' not found", name)
	}
	
	delete(config.MCPServers, name)
	
	if err := saveMCPConfig(config); err != nil {
		return err
	}
	
	fmt.Printf("Removed MCP server '%s'\n", name)
	return nil
}

func runMCPCopy(cmd *cobra.Command, args []string) error {
	// Read Claude Desktop config
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	
	claudeConfigPath := filepath.Join(homeDir, ".claude", "claude_desktop_config.json")
	data, err := os.ReadFile(claudeConfigPath)
	if err != nil {
		return fmt.Errorf("failed to read Claude Desktop config: %w", err)
	}
	
	var claudeConfig struct {
		MCPServers map[string]ServerConfig `json:"mcpServers"`
	}
	
	if err := json.Unmarshal(data, &claudeConfig); err != nil {
		return fmt.Errorf("failed to parse Claude Desktop config: %w", err)
	}
	
	// Load current dere config
	dereConfig, err := loadMCPConfig()
	if err != nil {
		return err
	}
	
	// Copy servers, adding basic tags and descriptions
	copied := 0
	for name, server := range claudeConfig.MCPServers {
		if _, exists := dereConfig.MCPServers[name]; !exists {
			// Add basic tags based on server name/command
			tags := []string{}
			if strings.Contains(name, "obsidian") || strings.Contains(server.Command, "obsidian") {
				tags = append(tags, "notes", "knowledge")
			}
			if strings.Contains(name, "linear") {
				tags = append(tags, "productivity", "dev", "issues")
			}
			if strings.Contains(name, "spotify") {
				tags = append(tags, "media", "music")
			}
			if strings.Contains(name, "arr") {
				tags = append(tags, "media", "automation", "homelab")
			}
			
			server.Tags = tags
			server.Description = fmt.Sprintf("Imported from Claude Desktop: %s", name)
			
			dereConfig.MCPServers[name] = server
			copied++
		}
	}
	
	if err := saveMCPConfig(dereConfig); err != nil {
		return err
	}
	
	fmt.Printf("Copied %d MCP servers from Claude Desktop config\n", copied)
	return nil
}