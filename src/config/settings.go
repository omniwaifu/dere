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