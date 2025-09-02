package composer

import (
	"strings"
	
	"dere/src/personality"
	"dere/src/context"
)

// ComposePrompt builds a layered system prompt from the given configuration
func ComposePrompt(personalities []string, customPrompts []string, includeContext bool) (string, error) {
	var layers []string
	
	// Layer 1: Built-in prompts
	for _, personalityType := range personalities {
		pers, err := personality.CreatePersonality(personalityType)
		if err != nil {
			return "", err
		}
		layers = append(layers, pers.GetPrompt())
	}
	
	// Layer 2: Custom prompts
	for _, customPrompt := range customPrompts {
		pers, err := personality.NewFileBasedPersonality(customPrompt)
		if err != nil {
			return "", err
		}
		layers = append(layers, pers.GetPrompt())
	}
	
	// Layer 3: Context (optional)
	if includeContext {
		layers = append(layers, context.GetContextualPrompt())
	}
	
	// Compose all layers with separators
	if len(layers) == 0 {
		return "", nil // Bare mode - no additional prompts
	}
	
	return strings.Join(layers, "\n\n---\n\n"), nil
}