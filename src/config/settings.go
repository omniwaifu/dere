package config

import (
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type Settings struct {
	ActivityWatch ActivityWatchConfig `toml:"activitywatch"`
	Ollama        OllamaConfig        `toml:"ollama"`
}

type ActivityWatchConfig struct {
	Enabled          bool   `toml:"enabled"`
	URL              string `toml:"url"`
	LookbackMinutes  int    `toml:"lookback_minutes"`
}

type OllamaConfig struct {
	Enabled        bool   `toml:"enabled"`
	URL            string `toml:"url"`
	EmbeddingModel string `toml:"embedding_model"`
}

func LoadSettings() (*Settings, error) {
	settings := &Settings{
		ActivityWatch: ActivityWatchConfig{
			Enabled:         false,
			URL:             "http://localhost:5600",
			LookbackMinutes: 15,
		},
		Ollama: OllamaConfig{
			Enabled:        false,
			URL:            "http://localhost:11434",
			EmbeddingModel: "mxbai-embed-large",
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
			return settings, nil
		}
		return nil, err
	}

	if _, err := toml.Decode(string(data), settings); err != nil {
		return nil, err
	}

	return settings, nil
}