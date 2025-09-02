package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// MCPConfig represents the structure for MCP server configuration
type MCPConfig struct {
	MCPServers map[string]ServerConfig `json:"mcpServers"`
}

type ServerConfig struct {
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env,omitempty"`
}

// ClaudeDesktopConfig represents the structure of ~/.claude/claude_desktop_config.json
type ClaudeDesktopConfig struct {
	MCPServers map[string]ServerConfig `json:"mcpServers"`
}

// BuildMCPConfigFromClaudeDesktop reads claude desktop config and filters servers
func BuildMCPConfigFromClaudeDesktop(serverNames []string, configPath string) (string, error) {
	// Use provided config path or default to claude desktop config
	if configPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		configPath = filepath.Join(homeDir, ".claude", "claude_desktop_config.json")
	}
	
	// Read the config file
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", fmt.Errorf("failed to read claude desktop config: %w", err)
	}
	
	// Parse the config
	var desktopConfig ClaudeDesktopConfig
	if err := json.Unmarshal(data, &desktopConfig); err != nil {
		return "", fmt.Errorf("failed to parse claude desktop config: %w", err)
	}
	
	// Build filtered config with only requested servers
	filteredConfig := MCPConfig{
		MCPServers: make(map[string]ServerConfig),
	}
	
	for _, serverName := range serverNames {
		if serverConfig, exists := desktopConfig.MCPServers[serverName]; exists {
			filteredConfig.MCPServers[serverName] = serverConfig
		} else {
			return "", fmt.Errorf("MCP server '%s' not found in claude desktop config", serverName)
		}
	}
	
	// Marshal back to JSON
	jsonData, err := json.Marshal(filteredConfig)
	if err != nil {
		return "", fmt.Errorf("failed to marshal filtered MCP config: %w", err)
	}
	
	return string(jsonData), nil
}