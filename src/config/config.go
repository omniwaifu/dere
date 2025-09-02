package config

import (
	"os"
	"path/filepath"
	"runtime"
)

// GetConfigDir returns the OS-appropriate configuration directory for dere
func GetConfigDir() (string, error) {
	var configDir string

	switch runtime.GOOS {
	case "windows":
		// Use %APPDATA%/dere on Windows
		appData := os.Getenv("APPDATA")
		if appData == "" {
			homeDir, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			configDir = filepath.Join(homeDir, "AppData", "Roaming", "dere")
		} else {
			configDir = filepath.Join(appData, "dere")
		}
	case "darwin":
		// Use ~/Library/Application Support/dere on macOS
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		configDir = filepath.Join(homeDir, "Library", "Application Support", "dere")
	default:
		// Use XDG spec on Linux/Unix: $XDG_CONFIG_HOME/dere or ~/.config/dere
		xdgConfig := os.Getenv("XDG_CONFIG_HOME")
		if xdgConfig != "" {
			configDir = filepath.Join(xdgConfig, "dere")
		} else {
			homeDir, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			configDir = filepath.Join(homeDir, ".config", "dere")
		}
	}

	return configDir, nil
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