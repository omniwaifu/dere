package personality

import (
	"fmt"
)

// CreatePersonality creates a personality based on the type string
func CreatePersonality(personalityType string) (Personality, error) {
	// First, try built-in personalities
	switch personalityType {
	case "tsun", "tsundere":
		return NewTsun()
	case "kuu", "kuudere":
		return NewKuu()
	case "yan", "yandere":
		return NewYan()
	case "dere", "deredere":
		return NewDere()
	case "ero", "erodere":
		return NewEro()
	default:
		// Try file-based personality
		if personalityType != "" {
			fileBased, err := NewFileBasedPersonality(personalityType)
			if err == nil {
				return fileBased, nil
			}
			// If file-based personality failed, return error for debugging
			return nil, fmt.Errorf("personality '%s' not found: neither built-in nor file-based personality exists (%w)", personalityType, err)
		}
		
		// Default to tsundere
		return NewTsun()
	}
}

// GetAvailablePersonalities returns a list of available personality types
func GetAvailablePersonalities() []string {
	return []string{"tsun", "kuu", "yan", "dere", "ero"}
}

// GetPersonalityDescription returns a description of a personality type
func GetPersonalityDescription(personalityType string) string {
	switch personalityType {
	case "tsun":
		return "Tsundere - Acts harsh but secretly cares"
	case "kuu":
		return "Kuudere - Cold and analytical"
	case "yan":
		return "Yandere - Obsessively helpful"
	case "dere":
		return "Deredere - Genuinely sweet and supportive"
	case "ero":
		return "Erodere - Playfully teasing and flirtatious"
	default:
		return fmt.Sprintf("Unknown personality: %s", personalityType)
	}
}