package composer

import (
	"strings"
	
	"dere/src/personality"
	"dere/src/context"
)

// ComposePrompt builds a layered system prompt from the given configuration
// Following SillyTavern's architecture with main prompt, personality layers, and auxiliary instructions
func ComposePrompt(personalities []string, customPrompts []string, includeContext bool) (string, error) {
	var layers []string
	
	// Layer 1: Main prompt (primary interaction directive)
	// This sets the fundamental behavior, similar to SillyTavern's main prompt
	if len(personalities) > 0 || len(customPrompts) > 0 || includeContext {
		mainPrompt := `You are engaging in a natural conversation. Respond authentically based on the personality traits and context provided below. Your responses should be conversational, contextually appropriate, and true to the defined character traits.`
		layers = append(layers, mainPrompt)
	}
	
	// Layer 2: Built-in personality prompts
	for _, personalityType := range personalities {
		pers, err := personality.CreatePersonality(personalityType)
		if err != nil {
			return "", err
		}
		layers = append(layers, pers.GetPrompt())
	}
	
	// Layer 3: Custom prompts from files
	for _, customPrompt := range customPrompts {
		pers, err := personality.CreatePersonality(customPrompt)
		if err != nil {
			return "", err
		}
		layers = append(layers, pers.GetPrompt())
	}
	
	// Layer 4: Context (optional) - world info/scenario
	if includeContext {
		layers = append(layers, context.GetContextualPrompt())
	}
	
	// Layer 5: Global communication style instructions (auxiliary layer)
	// Applied after all personality and context layers, similar to SillyTavern's post-instructions
	if len(layers) > 0 {
		globalInstructions := `## Response Guidelines

- Use natural conversational language
- Stay in character as defined by the personality layers
- Maintain consistency with established traits and context
- Respond authentically based on the character's perspective`
		layers = append(layers, globalInstructions)
	}
	
	// Compose all layers with separators
	if len(layers) == 0 {
		return "", nil // Bare mode - no additional prompts
	}
	
	return strings.Join(layers, "\n\n---\n\n"), nil
}