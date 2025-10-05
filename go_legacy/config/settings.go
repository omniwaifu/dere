package config

import (
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type Settings struct {
	ActivityWatch ActivityWatchConfig `toml:"activitywatch"`
	Ollama        OllamaConfig        `toml:"ollama"`
	Weather       WeatherConfig       `toml:"weather"`
	Context       ContextConfig       `toml:"context"`
}

type ActivityWatchConfig struct {
	Enabled          bool   `toml:"enabled"`
	URL              string `toml:"url"`
	LookbackMinutes  int    `toml:"lookback_minutes"`
}

type OllamaConfig struct {
	Enabled                 bool   `toml:"enabled"`
	URL                     string `toml:"url"`
	EmbeddingModel          string `toml:"embedding_model"`
	SummarizationModel      string `toml:"summarization_model"`
	SummarizationThreshold  int    `toml:"summarization_threshold"`
}

type WeatherConfig struct {
	Enabled  bool    `toml:"enabled"`
	Provider string  `toml:"provider"`
	City     string  `toml:"city"`
	Lat      float64 `toml:"lat"`
	Lon      float64 `toml:"lon"`
	Units    string  `toml:"units"`
	Compact  bool    `toml:"compact"`
}

type ContextConfig struct {
	// Source toggles
	Time             bool `toml:"time"`
	Weather          bool `toml:"weather"`
	Activity         bool `toml:"activity"`
	MediaPlayer      bool `toml:"media_player"`

	// Activity settings
	ActivityLookbackMinutes int `toml:"activity_lookback_minutes"`
	ActivityMaxDuration     int `toml:"activity_max_duration_hours"`
	ShowInactiveItems       bool `toml:"show_inactive_items"`

	// Update settings
	UpdateIntervalSeconds   int `toml:"update_interval_seconds"`
	WeatherCacheMinutes     int `toml:"weather_cache_minutes"`

	// Display settings
	Format               string `toml:"format"` // "concise", "verbose", "minimal"
	MaxTitleLength       int    `toml:"max_title_length"`
	ShowDurationForShort bool   `toml:"show_duration_for_short"`
}

func LoadSettings() (*Settings, error) {
	settings := &Settings{
		ActivityWatch: ActivityWatchConfig{
			Enabled:         false,
			URL:             "http://localhost:5600",
			LookbackMinutes: 15,
		},
		Ollama: OllamaConfig{
			Enabled:                false,
			URL:                    "http://localhost:11434",
			EmbeddingModel:         "mxbai-embed-large",
			SummarizationModel:     "gemma3n:latest",
			SummarizationThreshold: 500,
		},
		Weather: WeatherConfig{
			Enabled:  false,
			Provider: "open_meteo",
			City:     "",
			Lat:      0,
			Lon:      0,
			Units:    "metric",
			Compact:  true,
		},
		Context: ContextConfig{
			// Source toggles (all enabled by default when --context is used)
			Time:        true,
			Weather:     true,
			Activity:    true,
			MediaPlayer: true,

			// Activity settings
			ActivityLookbackMinutes: 10,
			ActivityMaxDuration:     6, // 6 hours max lookback
			ShowInactiveItems:       true,

			// Update settings
			UpdateIntervalSeconds: 0,   // Update every message (0 = always)
			WeatherCacheMinutes:   10,  // Cache weather for 10 minutes

			// Display settings
			Format:               "concise", // concise, verbose, minimal
			MaxTitleLength:       50,
			ShowDurationForShort: true, // Show duration even for short activities
		},
	}

	configDir, err := GetConfigDir()
	if err != nil {
		return settings, nil
	}

	configPath := filepath.Join(configDir, "config.toml")
	
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Create default config file
			if err := createDefaultConfig(configPath, settings); err != nil {
				return settings, nil // Fall back to defaults if we can't write
			}
			return settings, nil
		}
		return nil, err
	}

	if _, err := toml.Decode(string(data), settings); err != nil {
		return nil, err
	}

	return settings, nil
}

func createDefaultConfig(configPath string, settings *Settings) error {
	// Create config directory if it doesn't exist
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return err
	}

	// Create default TOML content
	defaultContent := `# dere configuration file
# This file controls various aspects of dere's behavior

[context]
# Context injection settings (used with --context flag)
time = true                          # Include current time and date
weather = true                       # Include weather information (requires city configuration)
activity = true                      # Include ActivityWatch window tracking
media_player = true                  # Include media player status from ActivityWatch

# Activity tracking settings
activity_lookback_minutes = 10       # How far back to look for recent activity
activity_max_duration_hours = 6      # Maximum lookback for continuous activity detection
show_inactive_items = true           # Show items that recently ended
update_interval_seconds = 0          # Context update frequency (0 = every message)
weather_cache_minutes = 10           # Cache weather data for this many minutes
format = "concise"                   # Format style: concise, verbose, minimal
max_title_length = 50                # Truncate long window titles
show_duration_for_short = true       # Show duration even for short activities

[weather]
# Weather configuration (requires rustormy: https://github.com/Tairesh/rustormy)
enabled = false                      # Enable weather context
city = ""                           # City name (e.g., "New York, NY" or "London, UK")
units = "metric"                    # "metric" for Celsius, "imperial" for Fahrenheit

[ollama]
# Ollama integration for embeddings and summarization
enabled = false                      # Enable Ollama integration
url = "http://localhost:11434"       # Ollama server URL
embedding_model = "mxbai-embed-large" # Model for conversation embeddings
summarization_model = "gemma3n:latest" # Model for conversation summarization
summarization_threshold = 500        # Summarize messages longer than this (characters)

[activitywatch]
# ActivityWatch integration settings
enabled = false                      # Enable ActivityWatch integration
url = "http://localhost:5600"        # ActivityWatch server URL
lookback_minutes = 15                # Default lookback for activity queries
`

	return os.WriteFile(configPath, []byte(defaultContent), 0644)
}