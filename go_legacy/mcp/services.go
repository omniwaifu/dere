package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"dere/src/config"
)

// MCPConfig represents the structure for MCP server configuration
type MCPConfig struct {
	MCPServers map[string]ServerConfig `json:"mcpServers"`
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

type DereMCPConfig struct {
	MCPServers map[string]ServerConfig `json:"mcpServers"`
	Profiles   map[string]Profile      `json:"profiles,omitempty"`
}

// LoadDereMCPConfig loads the dere-managed MCP configuration
func LoadDereMCPConfig() (*DereMCPConfig, error) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get config directory: %w", err)
	}
	
	configPath := filepath.Join(configDir, "mcp_config.json")
	
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &DereMCPConfig{
				MCPServers: make(map[string]ServerConfig),
				Profiles:   make(map[string]Profile),
			}, nil
		}
		return nil, fmt.Errorf("failed to read dere MCP config: %w", err)
	}
	
	var dereMCPConfig DereMCPConfig
	if err := json.Unmarshal(data, &dereMCPConfig); err != nil {
		return nil, fmt.Errorf("failed to parse dere MCP config: %w", err)
	}
	
	if dereMCPConfig.MCPServers == nil {
		dereMCPConfig.MCPServers = make(map[string]ServerConfig)
	}
	if dereMCPConfig.Profiles == nil {
		dereMCPConfig.Profiles = make(map[string]Profile)
	}
	
	return &dereMCPConfig, nil
}

// ResolveMCPServers resolves server names, profiles, or patterns to actual server list
func ResolveMCPServers(serverSpecs []string) ([]string, error) {
	if len(serverSpecs) == 0 {
		return nil, nil
	}
	
	dereMCPConfig, err := LoadDereMCPConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load dere MCP config: %w", err)
	}
	
	var resolvedServers []string
	seenServers := make(map[string]bool)
	
	for _, spec := range serverSpecs {
		// Check if it's a profile first
		if profile, exists := dereMCPConfig.Profiles[spec]; exists {
			for _, serverName := range profile.Servers {
				if !seenServers[serverName] {
					resolvedServers = append(resolvedServers, serverName)
					seenServers[serverName] = true
				}
			}
			continue
		}
		
		// Check if it's a direct server name
		if _, exists := dereMCPConfig.MCPServers[spec]; exists {
			if !seenServers[spec] {
				resolvedServers = append(resolvedServers, spec)
				seenServers[spec] = true
			}
			continue
		}
		
		// Handle patterns (simple wildcard matching)
		if strings.Contains(spec, "*") {
			pattern := strings.ReplaceAll(spec, "*", "")
			for serverName := range dereMCPConfig.MCPServers {
				if strings.Contains(serverName, pattern) {
					if !seenServers[serverName] {
						resolvedServers = append(resolvedServers, serverName)
						seenServers[serverName] = true
					}
				}
			}
			continue
		}
		
		// Handle tag-based selection (e.g., "tag:media")
		if strings.HasPrefix(spec, "tag:") {
			tag := strings.TrimPrefix(spec, "tag:")
			for serverName, server := range dereMCPConfig.MCPServers {
				for _, serverTag := range server.Tags {
					if serverTag == tag {
						if !seenServers[serverName] {
							resolvedServers = append(resolvedServers, serverName)
							seenServers[serverName] = true
						}
						break
					}
				}
			}
			continue
		}
		
		return nil, fmt.Errorf("MCP server, profile, or pattern '%s' not found", spec)
	}
	
	return resolvedServers, nil
}

// BuildMCPConfigFromDere creates MCP config from dere's config, filtering servers
func BuildMCPConfigFromDere(serverSpecs []string) (string, error) {
	// Resolve server specifications to actual server names
	serverNames, err := ResolveMCPServers(serverSpecs)
	if err != nil {
		return "", err
	}
	
	if len(serverNames) == 0 {
		return "", nil // No servers requested
	}
	
	// Load dere MCP config
	dereMCPConfig, err := LoadDereMCPConfig()
	if err != nil {
		return "", err
	}
	
	// Build filtered config with only requested servers
	filteredConfig := MCPConfig{
		MCPServers: make(map[string]ServerConfig),
	}
	
	for _, serverName := range serverNames {
		if serverConfig, exists := dereMCPConfig.MCPServers[serverName]; exists {
			// Convert to simple ServerConfig (without tags/description for Claude)
			claudeConfig := ServerConfig{
				Command: serverConfig.Command,
				Args:    serverConfig.Args,
				Env:     serverConfig.Env,
			}
			filteredConfig.MCPServers[serverName] = claudeConfig
		} else {
			return "", fmt.Errorf("MCP server '%s' not found in dere config", serverName)
		}
	}
	
	// Marshal back to JSON
	jsonData, err := json.Marshal(filteredConfig)
	if err != nil {
		return "", fmt.Errorf("failed to marshal filtered MCP config: %w", err)
	}
	
	// Write to a temporary file
	tmpFile, err := os.CreateTemp("", "mcp_config_*.json")
	if err != nil {
		return "", fmt.Errorf("failed to create temporary MCP config file: %w", err)
	}
	
	if _, err := tmpFile.Write(jsonData); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to write MCP config to temporary file: %w", err)
	}
	
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to close temporary MCP config file: %w", err)
	}
	
	return tmpFile.Name(), nil
}

// Legacy function - kept for backwards compatibility
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
	type ClaudeDesktopConfig struct {
		MCPServers map[string]ServerConfig `json:"mcpServers"`
	}
	
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
	
	// Write to a temporary file
	tmpFile, err := os.CreateTemp("", "mcp_config_*.json")
	if err != nil {
		return "", fmt.Errorf("failed to create temporary MCP config file: %w", err)
	}
	
	if _, err := tmpFile.Write(jsonData); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to write MCP config to temporary file: %w", err)
	}
	
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to close temporary MCP config file: %w", err)
	}
	
	return tmpFile.Name(), nil
}