package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

// configCmd represents the config command
var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage dere configuration",
	Long: `Manage dere configuration settings.
	
Examples:
  dere config get ollama.url
  dere config set ollama.url http://localhost:11434
  dere config list
  dere config edit`,
}

// configGetCmd represents the config get command
var configGetCmd = &cobra.Command{
	Use:   "get <key>",
	Short: "Get a configuration value",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		key := args[0]
		value := viper.Get(key)
		if value == nil {
			fmt.Printf("Key '%s' not found\n", key)
			os.Exit(1)
		}
		fmt.Println(value)
	},
}

// configSetCmd represents the config set command
var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set a configuration value",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		key := args[0]
		value := args[1]
		
		// Try to parse as bool
		if value == "true" || value == "false" {
			viper.Set(key, value == "true")
		} else {
			viper.Set(key, value)
		}
		
		// Get config file path
		configFile := viper.ConfigFileUsed()
		if configFile == "" {
			// No config file exists yet, create it
			home, err := os.UserHomeDir()
			if err != nil {
				return err
			}
			configDir := filepath.Join(home, ".config", "dere")
			if err := os.MkdirAll(configDir, 0755); err != nil {
				return err
			}
			configFile = filepath.Join(configDir, "config.toml")
		}
		
		// Write config
		if err := viper.WriteConfigAs(configFile); err != nil {
			return fmt.Errorf("failed to write config: %w", err)
		}
		
		fmt.Printf("Set %s = %v\n", key, value)
		fmt.Printf("Config saved to %s\n", configFile)
		return nil
	},
}

// configListCmd represents the config list command
var configListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all configuration values",
	Run: func(cmd *cobra.Command, args []string) {
		settings := viper.AllSettings()
		
		// Flatten nested maps
		flattened := flattenMap("", settings)
		
		// Sort keys
		var keys []string
		for k := range flattened {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		
		// Print settings
		if len(keys) == 0 {
			fmt.Println("No configuration settings found")
			return
		}
		
		fmt.Println("Configuration settings:")
		for _, key := range keys {
			fmt.Printf("  %s = %v\n", key, flattened[key])
		}
		
		if configFile := viper.ConfigFileUsed(); configFile != "" {
			fmt.Printf("\nConfig file: %s\n", configFile)
		}
	},
}

// configEditCmd represents the config edit command
var configEditCmd = &cobra.Command{
	Use:   "edit",
	Short: "Edit configuration file in your default editor",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Get config file path
		configFile := viper.ConfigFileUsed()
		if configFile == "" {
			// Create default config file
			home, err := os.UserHomeDir()
			if err != nil {
				return err
			}
			configDir := filepath.Join(home, ".config", "dere")
			if err := os.MkdirAll(configDir, 0755); err != nil {
				return err
			}
			configFile = filepath.Join(configDir, "config.toml")
			
			// Create empty file if it doesn't exist
			if _, err := os.Stat(configFile); os.IsNotExist(err) {
				if err := os.WriteFile(configFile, []byte("# Dere configuration file\n"), 0644); err != nil {
					return err
				}
			}
		}
		
		// Get editor from environment
		editor := os.Getenv("EDITOR")
		if editor == "" {
			editor = os.Getenv("VISUAL")
		}
		if editor == "" {
			// Try common editors
			for _, e := range []string{"vim", "vi", "nano", "emacs"} {
				if _, err := exec.LookPath(e); err == nil {
					editor = e
					break
				}
			}
		}
		if editor == "" {
			return fmt.Errorf("no editor found; set $EDITOR or $VISUAL")
		}
		
		// Open editor
		editorCmd := exec.Command(editor, configFile)
		editorCmd.Stdin = os.Stdin
		editorCmd.Stdout = os.Stdout
		editorCmd.Stderr = os.Stderr
		
		return editorCmd.Run()
	},
}

// flattenMap flattens a nested map into dot-notation keys
func flattenMap(prefix string, m map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	
	for key, value := range m {
		fullKey := key
		if prefix != "" {
			fullKey = prefix + "." + key
		}
		
		switch v := value.(type) {
		case map[string]interface{}:
			// Recursively flatten nested maps
			nested := flattenMap(fullKey, v)
			for k, val := range nested {
				result[k] = val
			}
		case []interface{}:
			// Convert slice to string representation
			var items []string
			for _, item := range v {
				items = append(items, fmt.Sprintf("%v", item))
			}
			result[fullKey] = strings.Join(items, ", ")
		default:
			result[fullKey] = value
		}
	}
	
	return result
}

func init() {
	rootCmd.AddCommand(configCmd)
	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configListCmd)
	configCmd.AddCommand(configEditCmd)
}