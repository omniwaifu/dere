package personality

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"dere/src/config"

	"github.com/BurntSushi/toml"
)

//go:embed data/*.toml
var embeddedPersonalities embed.FS

var (
	personalityCache     = make(map[string]*PersonalityConfig)
	personalityCacheLock sync.RWMutex
)

// LoadPersonality loads a personality by name or alias, checking user config first,
// then falling back to embedded personalities
func LoadPersonality(nameOrAlias string) (*PersonalityConfig, error) {
	normalizedName := strings.ToLower(nameOrAlias)

	// Check cache first
	personalityCacheLock.RLock()
	if cached, ok := personalityCache[normalizedName]; ok {
		personalityCacheLock.RUnlock()
		return cached, nil
	}
	personalityCacheLock.RUnlock()

	// Try loading from user config directory first
	config, err := loadFromUserConfig(normalizedName)
	if err == nil {
		cachePersonality(normalizedName, config)
		return config, nil
	}

	// Fall back to embedded personalities
	config, err = loadFromEmbedded(normalizedName)
	if err != nil {
		return nil, fmt.Errorf("personality '%s' not found", nameOrAlias)
	}

	cachePersonality(normalizedName, config)
	return config, nil
}

func loadFromUserConfig(name string) (*PersonalityConfig, error) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		return nil, err
	}

	personalitiesDir := filepath.Join(configDir, "personalities")
	personalityPath := filepath.Join(personalitiesDir, name+".toml")

	data, err := os.ReadFile(personalityPath)
	if err != nil {
		return nil, err
	}

	var pc PersonalityConfig
	if _, err := toml.Decode(string(data), &pc); err != nil {
		return nil, fmt.Errorf("failed to parse personality file: %w", err)
	}

	return &pc, nil
}

func loadFromEmbedded(name string) (*PersonalityConfig, error) {
	// Try direct name match first
	path := fmt.Sprintf("data/%s.toml", name)
	data, err := embeddedPersonalities.ReadFile(path)
	if err == nil {
		return parsePersonalityConfig(data)
	}

	// Try searching all embedded personalities by alias
	entries, err := embeddedPersonalities.ReadDir("data")
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".toml") {
			continue
		}

		filePath := filepath.Join("data", entry.Name())
		data, err := embeddedPersonalities.ReadFile(filePath)
		if err != nil {
			continue
		}

		pc, err := parsePersonalityConfig(data)
		if err != nil {
			continue
		}

		// Check if this personality matches the requested name/alias
		if matchesPersonality(pc, name) {
			return pc, nil
		}
	}

	return nil, fmt.Errorf("personality not found: %s", name)
}

func parsePersonalityConfig(data []byte) (*PersonalityConfig, error) {
	var pc PersonalityConfig
	if _, err := toml.Decode(string(data), &pc); err != nil {
		return nil, fmt.Errorf("failed to parse personality config: %w", err)
	}
	return &pc, nil
}

func matchesPersonality(pc *PersonalityConfig, name string) bool {
	normalizedName := strings.ToLower(name)

	if strings.ToLower(pc.Metadata.Name) == normalizedName {
		return true
	}
	if strings.ToLower(pc.Metadata.ShortName) == normalizedName {
		return true
	}

	for _, alias := range pc.Metadata.Aliases {
		if strings.ToLower(alias) == normalizedName {
			return true
		}
	}

	return false
}

func cachePersonality(key string, config *PersonalityConfig) {
	personalityCacheLock.Lock()
	defer personalityCacheLock.Unlock()
	personalityCache[key] = config
}

// GetAvailablePersonalities returns a list of available personality names
func GetAvailablePersonalities() []string {
	personalities := []string{}

	// Load from embedded FS
	entries, err := embeddedPersonalities.ReadDir("data")
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".toml") {
				name := strings.TrimSuffix(entry.Name(), ".toml")
				personalities = append(personalities, name)
			}
		}
	}

	return personalities
}