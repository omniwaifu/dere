package personality

import (
	"fmt"
	"os"
	"path/filepath"
	
	"dere/src/config"
)

// FileBasedPersonality - Loads personality from a markdown file
type FileBasedPersonality struct {
	name     string
	content  string
}

// NewFileBasedPersonality creates a new file-based personality
func NewFileBasedPersonality(name string) (*FileBasedPersonality, error) {
	promptsDir, err := config.GetPromptsDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get prompts directory: %w", err)
	}
	
	filePath := filepath.Join(promptsDir, name+".md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read prompt file %s: %w", filePath, err)
	}
	
	return &FileBasedPersonality{
		name:      name,
		content:   string(content),
	}, nil
}

func (f *FileBasedPersonality) GetName() string {
	return f.name
}

func (f *FileBasedPersonality) GetPrompt() string {
	return f.content
}