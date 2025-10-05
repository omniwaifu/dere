package config

import (
	"os"
	"path/filepath"

	"github.com/adrg/xdg"
)

// GetConfigDir returns the OS-appropriate configuration directory for dere
// Linux: $XDG_CONFIG_HOME/dere or ~/.config/dere
// macOS: ~/Library/Application Support/dere
// Windows: %LOCALAPPDATA%/dere
func GetConfigDir() (string, error) {
	configDir := filepath.Join(xdg.ConfigHome, "dere")
	return configDir, nil
}

// GetDataDir returns the OS-appropriate data directory for dere
// Linux: $XDG_DATA_HOME/dere or ~/.local/share/dere
// macOS: ~/Library/Application Support/dere
// Windows: %LOCALAPPDATA%/dere
func GetDataDir() (string, error) {
	dataDir := filepath.Join(xdg.DataHome, "dere")
	return dataDir, nil
}

// GetPromptsDir returns the directory where custom prompt files are stored
func GetPromptsDir() (string, error) {
	configDir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "prompts"), nil
}

// EnsureConfigDirs creates the config and prompts directories if they don't exist
func EnsureConfigDirs() error {
	configDir, err := GetConfigDir()
	if err != nil {
		return err
	}

	promptsDir, err := GetPromptsDir()
	if err != nil {
		return err
	}

	// Create config directory
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}

	// Create prompts directory
	if err := os.MkdirAll(promptsDir, 0755); err != nil {
		return err
	}

	return nil
}