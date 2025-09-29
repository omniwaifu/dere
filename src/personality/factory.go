package personality

import (
	"fmt"
)

// CreatePersonality creates a personality based on the type string
func CreatePersonality(personalityType string) (Personality, error) {
	if personalityType == "" {
		// Default to tsundere
		personalityType = "tsun"
	}

	// Load personality config from TOML
	config, err := LoadPersonality(personalityType)
	if err != nil {
		return nil, fmt.Errorf("personality '%s' not found: %w", personalityType, err)
	}

	return NewTOMLPersonality(config), nil
}

// GetPersonalityDescription returns a description of a personality type
func GetPersonalityDescription(personalityType string) string {
	config, err := LoadPersonality(personalityType)
	if err != nil {
		return fmt.Sprintf("Unknown personality: %s", personalityType)
	}

	// Return a brief description based on the personality name
	return config.Metadata.Name
}