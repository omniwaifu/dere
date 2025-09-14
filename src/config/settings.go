package config

import (
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type Settings struct {
	ActivityWatch ActivityWatchConfig `toml:"activitywatch"`
}

type ActivityWatchConfig struct {
	Enabled          bool   `toml:"enabled"`
	URL              string `toml:"url"`
	LookbackMinutes  int    `toml:"lookback_minutes"`
}

func LoadSettings() (*Settings, error) {
	settings := &Settings{
		ActivityWatch: ActivityWatchConfig{
			Enabled:         false,
			URL:             "http://localhost:5600",
			LookbackMinutes: 15,
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